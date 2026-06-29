'use strict';
'require rpc';
'require poll';
'require view';
'require dom';
'require ui';
'require mwan3.components as components';
'require mwan3.constants as constants';

const callRoutingHealth = rpc.declare({
	object: 'mwan3',
	method: 'routing_health',
	params: [],
	expect: {},
});

/*
 * Determine the health colour for one interface entry.
 *
 * Rules about expected state:
 *   online  -> ip rules MUST be present; table MUST have a default route.
 *   offline / disconnecting -> a soft tracker failure does NOT remove the
 *              interface's ip rules. mwan3 keeps iif/fwmark/unreachable in
 *              place and steers traffic away in the nft policy, so the rules
 *              - and, while the link is up, the default route - are expected
 *              to stay present. 'disconnecting' is the transient on the way
 *              to 'offline'; both are anomalies on an interface whose rules
 *              are still in place, so both warrant a warning. Only a hard
 *              ifdown tears the rules down, after which the tracker reports
 *              the interface as 'disabled' (the branch below).
 *   disabled/unknown -> report what is present without pass/fail judgement.
 */
function ifaceHealth(d) {
	var online = d.status === 'online';
	var down = d.status === 'offline' || d.status === 'disconnecting';
	var unreach = d.unreach_rule || {};

	if (online) {
		var ok = d.iif_rule.present && d.fwmark_rule.present && unreach.present && d.table.has_default;
		var partial = (d.iif_rule.present || d.fwmark_rule.present || unreach.present) && !ok;
		return ok ? 'success' : partial ? 'warning' : 'danger';
	}
	if (down) {
		// Soft failure, or the disconnecting transition into it: mwan3 retains
		// the interface's rules (see above), so their presence is expected,
		// not a fault. Flag the interface as down without judging the
		// retained rules.
		return 'warning';
	}
	/* unknown / disabled */
	return 'muted';
}

function ruleRow(label, priority, present, expectPresent) {
	return [
		[
			E('strong', {}, label + '\u00a0'),
			E('span', { 'class': 'mwan3-kv-note' }, _('priority') + '\u00a0' + priority),
		],
		components.presenceBadge(present, expectPresent),
	];
}

function renderIfaceCard(ifname, d) {
	var online  = d.status === 'online';
	var offline = d.status === 'offline';
	var health  = ifaceHealth(d);

	var statusSeverity = online  ? 'success'
	                   : offline ? 'danger'
	                   :           'muted';
	var statusLabel = online  ? _('Online')
	                : offline ? _('Offline')
	                :           (d.status || _('Unknown'));

	var unreach = d.unreach_rule || {};
	var expect  = online ? true : null;

	/* Default routes summary */
	var routeLines;
	if (d.table.has_default) {
		routeLines = d.table.default_routes.map(function(r) {
			var via = r.gateway ? ' via ' + r.gateway : '';
			var dev = r.dev     ? ' dev ' + r.dev     : '';
			return E('div', { 'class': 'mwan3-route' }, r.dst + via + dev);
		});
	} else {
		routeLines = [ E('div', { 'class': 'mwan3-route-none' },
			online ? components.statusText(_('No default route'), 'danger', true)
			       : components.emptyHint(_('(none - interface offline)'))) ];
	}

	var kv = components.kvBlock([
		ruleRow(_('IP rule (iif)'), d.iif_rule.priority, d.iif_rule.present, expect),
		ruleRow(_('IP rule (fwmark)'), d.fwmark_rule.priority, d.fwmark_rule.present, expect),
		ruleRow(_('IP rule (unreachable)'), unreach.priority, unreach.present, expect),
		[
			[
				E('strong', {}, _('Routing table') + '\u00a0'),
				E('span', { 'class': 'mwan3-kv-note' },
					_('table') + '\u00a0' + d.table.id + ' \u2014 ' + _('default route')),
			],
			components.presenceBadge(d.table.has_default, expect),
		],
	]);

	var header = E('div', { 'class': 'mwan3-iface-header' }, [
		E('strong', { 'class': 'mwan3-detail-label' }, ifname),
		E('span', { 'class': 'mwan3-muted' }, _('index') + '\u00a0' + d.index),
		components.statusText(statusLabel, statusSeverity, true),
	]);

	return components.card(health, [ header, kv ].concat(routeLines), 'mwan3-iface-card');
}

function renderSummaryCard(data) {
	var ifaces = data.interfaces || {};
	var names  = Object.keys(ifaces);

	if (!data.mwan3_active) {
		return components.card('muted',
			_('mwan3 does not appear to be running. No routing state to check.'),
			'mwan3-summary-gap mwan3-muted');
	}

	var healthy  = names.filter(function(n) { return ifaceHealth(ifaces[n]) === 'success'; }).length;
	var degraded = names.filter(function(n) { return ifaceHealth(ifaces[n]) === 'warning'; }).length;
	var failing  = names.filter(function(n) { return ifaceHealth(ifaces[n]) === 'danger';  }).length;
	var stale    = (data.stale_rules || []).length;

	var severity = failing ? 'danger' : (degraded || stale) ? 'warning' : 'success';
	var parts = [
		healthy  + ' ' + (healthy  === 1 ? _('interface healthy')  : _('interfaces healthy')),
		degraded + ' ' + (degraded === 1 ? _('degraded')           : _('degraded')),
		failing  + ' ' + (failing  === 1 ? _('failing')            : _('failing')),
	];
	if (stale) parts.push(stale + ' ' + (stale === 1 ? _('stale rule') : _('stale rules')));

	return components.summaryBar(severity, parts.join(' \u00b7 '));
}

function renderStaleRules(staleRules) {
	if (!staleRules || !staleRules.length) return null;

	var table = new ui.Table(
		[ _('Priority'), _('Note') ],
		{ id: 'mwan3-stale-rules', sortable: true, classes: 'mwan3-stale-table' },
		components.emptyHint(_('No stale rules'))
	);
	table.update(staleRules.map(function(sr) {
		return [
			String(sr.priority),
			E('span', { 'class': 'mwan3-warn' },
				_('IP rule present but no mwan3 UCI interface with this index')),
		];
	}));

	return E('div', { 'class': 'mwan3-stale' }, [
		E('h3', { 'class': 'mwan3-stale-title' }, _('Stale IP rules')),
		E('p', { 'class': 'mwan3-stale-note' },
			_('These ip rules are in mwan3\u2019s priority range but do not correspond to any currently configured interface. They may remain from a previous configuration.')),
		table.render(),
	]);
}

function guideField(title, body) {
	return E('div', { 'class': 'mwan3-guide-field' }, [
		E('div', { 'class': 'mwan3-guide-field-title' }, title),
		E('div', { 'class': 'mwan3-guide-body' }, body),
	]);
}

function renderFieldGuide(bases) {
	var iif_base     = (bases && bases.iif)     || constants.RULE_BASE_DEFAULTS.iif;
	var fwmark_base  = (bases && bases.fwmark)  || constants.RULE_BASE_DEFAULTS.fwmark;
	var unreach_base = (bases && bases.unreach) || constants.RULE_BASE_DEFAULTS.unreachable;

	return E('div', { 'class': 'mwan3-guide' }, [
		E('div', { 'class': 'mwan3-guide-title' }, _('Field reference')),
		guideField(_('Index (N)'),
			_('The 1-based position of the interface in UCI section order. This single number drives everything else: it is the routing table number, determines all three ip rule priorities, and is encoded in the fwmark value. If you reorder interfaces in UCI their indices change and mwan3 must rebuild all rules and tables.')),
		guideField(_('IP rule (iif)') + ' \u2014 ' + _('priority') + ' ' + iif_base + '+N',
			_('iif stands for input interface. This rule says: any packet that arrived on this WAN device, look it up in routing table N. Its purpose is return-path routing - when a reply comes back from the internet on this WAN, it must go back to the LAN client via the same WAN, not whatever the main routing table would choose. Without this rule, asymmetric routing breaks TCP sessions. mwan3 removes it only on a hard ifdown; a soft tracker failure leaves it in place, so seeing it present for an interface shown offline is the normal, expected state.')),
		guideField(_('IP rule (fwmark)') + ' \u2014 ' + _('priority') + ' ' + fwmark_base + '+N',
			_("This rule says: any packet carrying fwmark value N, stamped by mwan3's prerouting chain, look it up in routing table N. This is the forward-path rule. mwan3's nftables prerouting chain marks outbound packets according to your policy rules, and this ip rule translates that mark into a routing table lookup, sending the packet out through the correct WAN. Without this rule, policy routing decisions made in nftables have no effect on actual packet routing.")),
		guideField(_('IP rule (unreachable)') + ' \u2014 ' + _('priority') + ' ' + unreach_base + '+N',
			_('This rule matches the same fwmark as the fwmark lookup rule but returns ICMP unreachable instead of performing a table lookup. Because it runs at a lower priority than the fwmark lookup rule, it only fires when the lookup rule has been removed (interface down) or when the routing table has no matching route. It prevents packets marked for a down interface from falling through to the main routing table and being silently misrouted out a different WAN. Unlike the iif and fwmark rules, it is installed for every configured interface at service start and removed only at service stop, so it stays present whether the interface is currently online, offline, or disabled.')),
		E('div', { 'class': 'mwan3-guide-body' },
			_('All three rules must be present when an interface is online. The iif rule handles traffic coming back in from the WAN (return path). The fwmark rule handles traffic going out to the WAN (forward path). The unreachable rule is a safety net that catches packets marked for this interface when the fwmark lookup cannot route them. A missing iif rule means return traffic may route incorrectly or be dropped. A missing fwmark rule means policy routing is completely non-functional for that interface. A missing unreachable rule means packets for a down interface may be silently misrouted. An interface shown offline after a soft tracker failure keeps all of these rules; mwan3 steers traffic away from it in the firewall policy. A hard ifdown then removes the iif and fwmark rules and flushes its routing table, but the unreachable rule is a service-lifetime backstop and stays until mwan3 is stopped.')),
	]);
}

function renderHealth(data) {
	if (!data) {
		return [ components.emptyHint(_('No data available')) ];
	}

	var ifaces = data.interfaces || {};
	var names  = Object.keys(ifaces);
	var stale  = data.stale_rules || [];

	var ifaceCards = names.map(function(n) { return renderIfaceCard(n, ifaces[n]); });
	var staleSection = renderStaleRules(stale);

	var els = [ renderSummaryCard(data) ];
	if (ifaceCards.length) {
		els = els.concat(ifaceCards);
	} else {
		els.push(components.emptyHint(_('No mwan3 interfaces configured')));
	}
	els.push(renderFieldGuide(data.rule_bases));
	if (staleSection) els.push(staleSection);
	return els;
}

return view.extend({
	load: function() {
		return callRoutingHealth();
	},

	render: function(data) {
		components.loadStyle();

		var healthRegion = E('div', {}, renderHealth(data));

		poll.add(function() {
			return callRoutingHealth().then(function(d) {
				dom.content(healthRegion, renderHealth(d));
			});
		}, 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('MultiWAN Manager - Routing Health')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', { 'class': 'mwan3-muted' },
					_('Live comparison of ip rules and routing tables against the mwan3 UCI configuration. Refreshes automatically.')),
				healthRegion,
			]),
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
