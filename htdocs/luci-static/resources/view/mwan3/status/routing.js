'use strict';
'require rpc';
'require poll';
'require view';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet',
	'type': 'text/css',
	'href': L.resource('view/mwan3/mwan3.css')
}));

const callRoutingHealth = rpc.declare({
	object: 'mwan3',
	method: 'routing_health',
	params: [],
	expect: {},
});

const COLORS = {
	success: '#5cb85c',
	danger:  '#d9534f',
	warning: '#f0ad4e',
	muted:   '#888888',
};

function colorText(text, color) {
	return E('span', { 'style': 'font-weight:bold; color:' + color }, text);
}

/*
 * Determine the health colour for one interface entry.
 *
 * Rules about expected state:
 *   online  -> ip rules MUST be present; table MUST have a default route.
 *   offline -> ip rules may or may not be present (mwan3 removes them on
 *              ifdown); table default route should be absent.
 *   unknown -> report what is present without pass/fail judgement.
 */
function ifaceHealth(d) {
	var online = d.status === 'online';
	var offline = d.status === 'offline';

	if (online) {
		var ok = d.iif_rule.present && d.fwmark_rule.present && d.table.has_default;
		var partial = (d.iif_rule.present || d.fwmark_rule.present) && !ok;
		return ok ? 'success' : partial ? 'warning' : 'danger';
	}
	if (offline) {
		/* Rules present for an offline interface is unusual but not critical */
		return (d.iif_rule.present || d.fwmark_rule.present) ? 'warning' : 'muted';
	}
	/* unknown / disabled */
	return 'muted';
}

/*
 * expectedPresent: true  = expected present (green/red judgement)
 *                  false = expected absent  (unexpected warning if present)
 *                  null  = no expectation   (report presence neutrally, no judgement)
 */
function renderStatusBadge(present, expectedPresent) {
	if (expectedPresent === true)
		return present ? colorText(_('Present'), COLORS.success)
		               : colorText(_('Missing'), COLORS.danger);
	if (expectedPresent === false)
		return present ? colorText(_('Present (unexpected)'), COLORS.warning)
		               : colorText(_('Absent'), COLORS.muted);
	/* null: neutral - just report state, card border already signals health */
	return present ? colorText(_('Present'), COLORS.muted)
	               : colorText(_('Absent'),  COLORS.muted);
}

function renderIfaceCard(ifname, d) {
	var online  = d.status === 'online';
	var offline = d.status === 'offline';
	var health  = ifaceHealth(d);
	var border  = COLORS[health];

	var statusColor = online  ? COLORS.success
	                : offline ? COLORS.danger
	                :           COLORS.muted;
	var statusLabel = online  ? _('Online')
	                : offline ? _('Offline')
	                :           (d.status || _('Unknown'));

	/* Default routes summary */
	var routeLines;
	if (d.table.has_default) {
		routeLines = d.table.default_routes.map(function(r) {
			var via = r.gateway ? ' via ' + r.gateway : '';
			var dev = r.dev     ? ' dev ' + r.dev     : '';
			return E('div', { 'style': 'padding-left:1em; font-family:monospace; font-size:0.9em' },
				r.dst + via + dev);
		});
	} else {
		routeLines = [E('div', { 'style': 'padding-left:1em; color:' + COLORS.muted },
			online ? colorText(_('No default route'), COLORS.danger) : E('em', {}, _('(none - interface offline)')))];
	}

	return E('div', {
		'style': 'border:2px solid ' + border + '; border-radius:4px; padding:0.6em 1em; margin-bottom:0.75em',
	}, [
		/* Header row */
		E('div', { 'style': 'display:flex; align-items:center; gap:0.8em; margin-bottom:0.5em' }, [
			E('strong', { 'style': 'font-size:1.05em' }, ifname),
			E('span', { 'style': 'color:' + COLORS.muted }, _('index') + '\u00a0' + d.index),
			colorText(statusLabel, statusColor),
		]),

		/* IP rule rows */
		E('table', { 'style': 'width:100%; border-collapse:collapse' }, [
			E('tr', {}, [
				E('td', { 'style': 'width:55%; padding:0.15em 0' }, [
					E('strong', {}, _('IP rule (iif)') + '\u00a0'),
					E('span', { 'style': 'color:' + COLORS.muted + '; font-size:0.9em' },
						_('priority') + '\u00a0' + d.iif_rule.priority),
				]),
				E('td', { 'style': 'text-align:right' },
					renderStatusBadge(d.iif_rule.present, online ? true : null)),
			]),
			E('tr', {}, [
				E('td', { 'style': 'padding:0.15em 0' }, [
					E('strong', {}, _('IP rule (fwmark)') + '\u00a0'),
					E('span', { 'style': 'color:' + COLORS.muted + '; font-size:0.9em' },
						_('priority') + '\u00a0' + d.fwmark_rule.priority),
				]),
				E('td', { 'style': 'text-align:right' },
					renderStatusBadge(d.fwmark_rule.present, online ? true : null)),
			]),
			E('tr', {}, [
				E('td', { 'style': 'padding:0.15em 0' }, [
					E('strong', {}, _('Routing table') + '\u00a0'),
					E('span', { 'style': 'color:' + COLORS.muted + '; font-size:0.9em' },
						_('table') + '\u00a0' + d.table.id + ' \u2014 ' + _('default route')),
				]),
				E('td', { 'style': 'text-align:right' },
					renderStatusBadge(d.table.has_default, online ? true : null)),
			]),
		]),
		...routeLines,
	]);
}

function renderSummaryCard(data) {
	var ifaces = data.interfaces || {};
	var names  = Object.keys(ifaces);

	if (!data.mwan3_active) {
		return E('div', {
			'style': 'border:2px solid ' + COLORS.muted + '; border-radius:4px; padding:0.6em 1em; margin-bottom:1em; color:' + COLORS.muted,
		}, _('mwan3 does not appear to be running. No routing state to check.'));
	}

	var healthy  = names.filter(function(n) { return ifaceHealth(ifaces[n]) === 'success'; }).length;
	var degraded = names.filter(function(n) { return ifaceHealth(ifaces[n]) === 'warning'; }).length;
	var failing  = names.filter(function(n) { return ifaceHealth(ifaces[n]) === 'danger';  }).length;
	var stale    = (data.stale_rules || []).length;

	var color = failing ? COLORS.danger : (degraded || stale) ? COLORS.warning : COLORS.success;
	var parts = [
		healthy  + ' ' + (healthy  === 1 ? _('interface healthy')  : _('interfaces healthy')),
		degraded + ' ' + (degraded === 1 ? _('degraded')           : _('degraded')),
		failing  + ' ' + (failing  === 1 ? _('failing')            : _('failing')),
	];
	if (stale) parts.push(stale + ' ' + (stale === 1 ? _('stale rule') : _('stale rules')));

	return E('div', {
		'style': 'border:2px solid ' + color + '; border-radius:4px; padding:0.6em 1em; margin-bottom:1em; font-weight:bold; color:' + color,
	}, parts.join(' \u00b7 '));
}

function renderStaleRules(staleRules) {
	if (!staleRules || !staleRules.length) return null;

	var rows = [
		E('tr', { 'class': 'tr cbi-section-table-titles' }, [
			E('th', { 'class': 'th' }, _('Priority')),
			E('th', { 'class': 'th' }, _('Note')),
		])
	];
	staleRules.forEach(function(sr) {
		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, String(sr.priority)),
			E('td', { 'class': 'td', 'style': 'color:' + COLORS.warning },
				_('IP rule present but no mwan3 UCI interface with this index')),
		]));
	});

	return E('div', { 'style': 'margin-top:1.5em' }, [
		E('h3', { 'style': 'margin-bottom:0.5em' }, _('Stale IP rules')),
		E('p', { 'style': 'color:' + COLORS.muted + '; margin-bottom:0.5em' },
			_('These ip rules are in mwan3\u2019s priority range but do not correspond to any currently configured interface. They may remain from a previous configuration.')),
		E('table', { 'class': 'table cbi-section-table', 'style': 'width:100%' }, rows),
	]);
}

function renderFieldGuide() {
	var s = 'color:' + COLORS.muted + '; font-size:0.92em';
	var hs = 'font-weight:bold; margin-bottom:0.1em';
	function field(title, body) {
		return E('div', { 'style': 'margin-bottom:0.7em' }, [
			E('div', { 'style': hs }, title),
			E('div', { 'style': s }, body),
		]);
	}
	return E('div', {
		'style': 'border:1px solid ' + COLORS.muted + '; border-radius:4px; padding:0.8em 1em; margin-top:0.5em; margin-bottom:0.75em',
	}, [
		E('div', { 'style': 'font-weight:bold; margin-bottom:0.6em' }, _('Field reference')),
		field(_('Index (N)'),
			_('The 1-based position of the interface in UCI section order. This single number drives everything else: it is the routing table number, determines both ip rule priorities, and is encoded in the fwmark value. If you reorder interfaces in UCI their indices change and mwan3 must rebuild all rules and tables.')),
		field(_('IP rule (iif) \u2014 priority 1000+N'),
			_('iif stands for input interface. This rule says: any packet that arrived on this WAN device, look it up in routing table N. Its purpose is return-path routing - when a reply comes back from the internet on this WAN, it must go back to the LAN client via the same WAN, not whatever the main routing table would choose. Without this rule, asymmetric routing breaks TCP sessions. mwan3 removes it when the interface goes offline; if it appears present for an offline interface, something cleaned up incorrectly.')),
		field(_('IP rule (fwmark) \u2014 priority 2000+N'),
			_('This rule says: any packet carrying fwmark value N, stamped by mwan3\'s prerouting chain, look it up in routing table N. This is the forward-path rule. mwan3\'s nftables prerouting chain marks outbound packets according to your policy rules, and this ip rule translates that mark into a routing table lookup, sending the packet out through the correct WAN. Without this rule, policy routing decisions made in nftables have no effect on actual packet routing.')),
		E('div', { 'style': s },
			_('Both rules must be present when an interface is online. The iif rule handles traffic coming back in from the WAN (return path). The fwmark rule handles traffic going out to the WAN (forward path). A missing iif rule means return traffic may route incorrectly or be dropped. A missing fwmark rule means policy routing is completely non-functional for that interface - packets marked for it fall through to the main routing table.')),
	]);
}

function renderHealth(data) {
	if (!data) {
		return [E('em', {}, _('No data available'))];
	}

	var ifaces  = data.interfaces || {};
	var names   = Object.keys(ifaces);
	var stale   = data.stale_rules || [];

	var ifaceCards = names.map(function(n) { return renderIfaceCard(n, ifaces[n]); });
	var staleSection = renderStaleRules(stale);

	var els = [renderSummaryCard(data)];
	if (ifaceCards.length) {
		els = els.concat(ifaceCards);
	} else {
		els.push(E('em', {}, _('No mwan3 interfaces configured')));
	}
	els.push(renderFieldGuide());
	if (staleSection) els.push(staleSection);
	return els;
}

function updateLive(data) {
	var el = document.getElementById('mwan3-routing-health');
	if (!el) return;
	while (el.firstChild) el.removeChild(el.firstChild);
	renderHealth(data).forEach(function(c) { el.appendChild(c); });
}

return view.extend({
	load: function() {
		return callRoutingHealth();
	},

	render: function(data) {
		poll.add(function() {
			return callRoutingHealth().then(updateLive);
		});

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('MultiWAN Manager - Routing Health')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', { 'style': 'color:#888' },
					_('Live comparison of ip rules and routing tables against the mwan3 UCI configuration. Refreshes automatically.')),
				E('div', { 'id': 'mwan3-routing-health' }, renderHealth(data)),
			]),
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
