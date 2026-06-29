'use strict';
'require rpc';
'require uci';
'require view';
'require dom';
'require ui';
'require form';
'require validation';
'require mwan3.components as components';
'require mwan3.ipmath as ipmath';

const callMwan3Status = rpc.declare({
	object: 'mwan3',
	method: 'status',
	params: ['section'],
	expect: {},
});

const callNftsetMembers = rpc.declare({
	object: 'mwan3',
	method: 'nftset_members',
	params: ['set'],
	expect: {},
});

const callResolveHost = rpc.declare({
	object: 'mwan3',
	method: 'resolve_host',
	params: ['host', 'family'],
	expect: {},
});

/* ---- FQDN helpers ---- */

function looksLikeFqdn(str) {
	if (!str) return false;
	if (str.indexOf(':') >= 0) return false;   /* IPv6 */
	var parts = str.split('.');
	if (parts.length === 4) {
		var firstThreeDigits = true;
		for (var i = 0; i < 3; i++) {
			if (!/^\d+$/.test(parts[i])) { firstThreeDigits = false; break; }
		}
		if (firstThreeDigits) return false;  /* IPv4 or malformed IPv4 attempt */
	}
	return true;
}

/* Return the most-appropriate address list from a resolve_host response. */
function pickFamilyAddrs(res, family) {
	var v4 = (res && res.v4) || [];
	var v6 = (res && res.v6) || [];
	if (family === 'ipv6') return v6;
	if (family === 'ipv4') return v4;
	return v4.length ? v4 : v6;  /* prefer v4 when family is unspecified */
}

function fmtResolutionHint(addrs) {
	var s = _('Resolved') + ': ' + addrs[0];
	if (addrs.length > 1) s += ' (+' + (addrs.length - 1) + ' ' + _('more') + ')';
	return s;
}

/* ---- Rule matching ---- */

/*
 * Returns true if the rule matches the simulation input.
 *
 * Semantics for blank user fields: a blank field means "not specified".
 * If a rule has a constraint on a field the user left blank, the rule does
 * NOT match -- we can only confirm a match for what the user actually told
 * us.  Protocol is the exception: the dropdown always has a value and "all"
 * explicitly means any protocol (wildcard).
 *
 * Example: entering only a dst IP shows rules that catch that destination
 * regardless of source (i.e. rules with no src_ip constraint that also
 * match the given dst IP, plus unconstrained catch-all rules).
 */
function ruleMatches(rule, sim, nftsetCache) {
	/* Family */
	var ruleFam = rule.family || '';
	if (ruleFam && sim.family) {
		if (sim.family === 'ipv4' && ruleFam === 'ipv6') return false;
		if (sim.family === 'ipv6' && ruleFam === 'ipv4') return false;
	}

	/* Protocol: sim.proto='all' is a wildcard (dropdown default) */
	var ruleProto = rule.proto || 'all';
	if (ruleProto !== 'all' && sim.proto !== 'all' && ruleProto !== sim.proto)
		return false;

	/* Source IP: if rule constrains it but user left it blank -> no match */
	if (rule.src_ip) {
		if (!sim.src_ip) return false;
		var srcAddrs = rule.src_ip.split(',').map(function(s) { return s.trim(); });
		if (!srcAddrs.some(function(a) { return ipmath.ipInCidr(sim.src_ip, a); })) return false;
	}

	/* Destination IP: same */
	if (rule.dest_ip) {
		if (!sim.dst_ip) return false;
		var dstAddrs = rule.dest_ip.split(',').map(function(s) { return s.trim(); });
		if (!dstAddrs.some(function(a) { return ipmath.ipInCidr(sim.dst_ip, a); })) return false;
	}

	/* Source port: blank means rule must have no src_port constraint.
	 * Multiple ports may be entered; the rule matches if any one of them
	 * falls within the rule's port spec. */
	if (rule.src_port) {
		if (!sim.src_port) return false;
		var srcPorts = sim.src_port.split(/[\s,]+/).filter(Boolean);
		if (!srcPorts.some(function(p) { return ipmath.portMatches(p, rule.src_port); })) return false;
	}

	/* Destination port: same */
	if (rule.dest_port) {
		if (!sim.dst_port) return false;
		var dstPorts = sim.dst_port.split(/[\s,]+/).filter(Boolean);
		if (!dstPorts.some(function(p) { return ipmath.portMatches(p, rule.dest_port); })) return false;
	}

	/* Source NFT set: requires a src IP to check membership */
	if (rule.ipset_src) {
		if (!sim.src_ip) return false;
		var srcMembers = nftsetCache[rule.ipset_src] || [];
		if (!ipmath.ipInSet(sim.src_ip, srcMembers)) return false;
	}

	/* Destination NFT set: requires a dst IP to check membership */
	if (rule.ipset) {
		if (!sim.dst_ip) return false;
		var members = nftsetCache[rule.ipset] || [];
		if (!ipmath.ipInSet(sim.dst_ip, members)) return false;
	}

	/* Fwmark: empty sim.mark is treated as 0 (unmarked packet) */
	if (rule.fwmark && rule.fwmask) {
		var simMark = parseInt(sim.mark || '0', 16) | 0;
		var rMark   = parseInt(rule.fwmark, 16) | 0;
		var rMask   = parseInt(rule.fwmask, 16) | 0;
		if ((simMark & rMask) !== rMark) return false;
	}

	return true;
}

/* ---- Rendering helpers ---- */

function matchSummary(rule) {
	var parts = [];
	if (rule.family === 'ipv4') parts.push('IPv4');
	else if (rule.family === 'ipv6') parts.push('IPv6');
	if (rule.src_ip)    parts.push(_('src') + ' ' + rule.src_ip);
	if (rule.ipset_src) parts.push(_('src nftset') + ' ' + rule.ipset_src);
	if (rule.dest_ip)   parts.push(_('dst') + ' ' + rule.dest_ip);
	if (rule.proto && rule.proto !== 'all') parts.push(_('proto') + ' ' + rule.proto);
	if (rule.src_port)  parts.push(_('sport') + ' ' + rule.src_port);
	if (rule.dest_port) parts.push(_('dport') + ' ' + rule.dest_port);
	if (rule.ipset)     parts.push(_('nftset') + ' ' + rule.ipset);
	if (rule.fwmark && rule.fwmask) parts.push(_('mark') + ' ' + rule.fwmark + '/' + rule.fwmask);
	if (rule.sticky === '1') parts.push(_('sticky'));
	return parts.length ? parts.join(' | ') : _('all traffic');
}

function renderPolicyDetail(policyName, policiesData, uciPolicies) {
	/* Built-in terminal policies */
	var builtins = {
		'unreachable': _('unreachable (reject)'),
		'blackhole':   _('blackhole (drop)'),
		'default':     _('use main routing table'),
	};
	if (builtins[policyName]) {
		return E('div', { 'class': 'mwan3-sim-detail ' + components.textClass('muted') },
			_('Terminal policy') + ': ' + builtins[policyName]);
	}

	/* Try live data first */
	var liveMembers = (policiesData && (
		(policiesData.ipv4 && policiesData.ipv4[policyName]) ||
		(policiesData.ipv6 && policiesData.ipv6[policyName])
	)) || null;

	if (!liveMembers || !liveMembers.length) {
		/* Fall back to UCI - policy exists but no live data (mwan3 not running?) */
		var uciPol = null;
		for (var i = 0; i < uciPolicies.length; i++) {
			if (uciPolicies[i]['.name'] === policyName) { uciPol = uciPolicies[i]; break; }
		}
		if (!uciPol)
			return E('div', { 'class': components.textClass('danger') }, _('Policy not found in configuration'));
		return E('div', { 'class': 'mwan3-sim-detail ' + components.textClass('muted') },
			_('mwan3 not running - cannot show live member state'));
	}

	var memberEls = liveMembers.map(function(m) {
		var sev = m.percent > 0 ? 'success'
		        : m.status === 'online' ? 'warning'
		        : 'muted';
		var label = m.interface
			+ ' (' + _('metric') + '\u00a0' + m.metric + ', ' + _('weight') + '\u00a0' + m.weight + ')'
			+ ' \u2014 ' + (m.percent > 0 ? m.percent + '%' : m.status);
		return E('div', { 'class': 'mwan3-sim-member ' + components.textClass(sev) }, label);
	});

	/* Determine overall policy outcome */
	var anyActive = liveMembers.some(function(m) { return m.percent > 0; });
	var uciEntry  = null;
	for (var j = 0; j < uciPolicies.length; j++) {
		if (uciPolicies[j]['.name'] === policyName) { uciEntry = uciPolicies[j]; break; }
	}
	var lastResort = uciEntry ? (uciEntry.last_resort || 'unreachable') : 'unreachable';
	var outcome;
	if (anyActive) {
		var active = liveMembers.filter(function(m) { return m.percent > 0; });
		outcome = active.length === 1
			? E('div', { 'class': 'mwan3-sim-detail-sm ' + components.textClass('success') },
				_('Traffic will use') + ': ' + active[0].interface)
			: E('div', { 'class': 'mwan3-sim-detail-sm ' + components.textClass('success') },
				_('Traffic will be load-balanced across ') + active.length + _(' members'));
	} else {
		outcome = E('div', { 'class': 'mwan3-sim-detail-sm ' + components.textClass('danger') },
			_('All members offline - last resort') + ': ' + lastResort);
	}

	return E('div', {}, [
		E('div', { 'class': 'mwan3-sim-livehdr ' + components.textClass('muted') },
			_('Live member state') + ':'),
		...memberEls,
		outcome,
	]);
}

function renderConnectedBypass(dstIp, matchedCidr) {
	return components.card('info', [
		E('div', { 'class': components.textClass('info') + ' mwan3-strong' },
			_('mwan3 rules bypassed - directly connected network')),
		E('div', { 'class': 'mwan3-sim-detail' },
			_('Destination') + ' ' + dstIp + ' ' + _('is in the connected set') +
			(matchedCidr ? ' (' + matchedCidr + ')' : '') + '.'),
		E('div', { 'class': 'mwan3-sim-detail-sm ' + components.textClass('muted') },
			_('mwan3 exempts directly connected networks from policy routing before any rule is evaluated. ' +
			  'Traffic is forwarded via the main routing table regardless of configured rules. ' +
			  'Use firewall rules, not mwan3 policies, to control access to these networks.')),
	], 'mwan3-sim-card');
}

function renderSimResult(rules, matchedIdx, allMatched, sim, policiesData, uciPolicies) {
	if (matchedIdx < 0) {
		return components.card('muted', [
			E('div', { 'class': 'mwan3-strong ' + components.textClass('muted') }, _('No rule matched')),
			E('div', { 'class': 'mwan3-sim-detail-sm' },
				_('Traffic will be routed using the main routing table.')),
		], 'mwan3-sim-card');
	}

	var matched = rules[matchedIdx];
	var pName   = matched.use_policy || '-';
	var liveMembers = (policiesData && (
		(policiesData.ipv4 && policiesData.ipv4[pName]) ||
		(policiesData.ipv6 && policiesData.ipv6[pName])
	)) || [];
	var anyActive = liveMembers.some(function(m) { return m.percent > 0; });
	var severity = pName === 'blackhole' || pName === 'unreachable' ? 'warning'
	             : anyActive ? 'success'
	             : 'danger';

	var cards = [];

	/* Primary match card */
	cards.push(components.card(severity, [
		E('div', { 'class': 'mwan3-sim-title' },
			_('First matching rule') + ': ' + matched['.name']),
		E('div', {}, [ E('strong', {}, _('Match') + ':\u00a0'), matchSummary(matched) ]),
		E('div', {}, [ E('strong', {}, _('Policy') + ':\u00a0'), pName ]),
		renderPolicyDetail(pName, policiesData, uciPolicies),
	], 'mwan3-sim-card'));

	/* Shadowed rules */
	var shadowed = [];
	for (var i = 0; i < allMatched.length; i++) {
		if (allMatched[i] !== matchedIdx) shadowed.push(rules[allMatched[i]]);
	}

	if (shadowed.length) {
		var table = new ui.Table(
			[ _('Shadowed rule'), _('Match'), _('Policy') ],
			{
				id: 'mwan3-sim-shadowed',
				sortable: false,
				classes: 'mwan3-sim-shadow-table',
				captionClasses: [ null, null, 'mwan3-sim-col-policy' ],
			},
			components.emptyHint(_('None'))
		);
		table.update(shadowed.map(function(r) {
			return [
				r['.name'],
				matchSummary(r),
				components.statusText(r.use_policy || '-', 'muted'),
			];
		}));
		cards.push(E('div', { 'class': 'mwan3-sim-shadow' }, [
			E('h4', { 'class': 'mwan3-sim-shadow-h4 ' + components.textClass('muted') },
				_('Also matched (shadowed by first rule)')),
			table.render(),
		]));
	}

	return E('div', {}, cards);
}

return view.extend({
	load: function() {
		return uci.load('mwan3');
	},

	render: function() {
		components.loadStyle();

		var self = this;

		var simData = { sim: {} };
		var m = new form.JSONMap(simData,
			_('MultiWAN Manager - Traffic Path Simulator'),
			_('Enter traffic parameters to simulate which mwan3 rule matches and which policy would handle the traffic. IP fields accept addresses or hostnames - hostnames are resolved via the local DNS server. Rules with a constraint on a field you leave blank will not match.'));

		var s = m.section(form.NamedSection, 'sim', 'sim');

		var oSrc = s.option(form.Value, 'src_ip', _('Source IP/Name'));
		oSrc.placeholder = _('e.g. 192.168.1.5 or hostname');

		var oDst = s.option(form.Value, 'dst_ip', _('Destination IP/Name'));
		oDst.placeholder = _('e.g. 8.8.4.4 or hostname');

		var oMark = s.option(form.Value, 'mark', _('Fwmark'));
		oMark.placeholder = '0x80000';

		var oProto = s.option(form.ListValue, 'proto', _('Protocol'));
		['all', 'tcp', 'udp', 'icmp', 'esp'].forEach(function(p) { oProto.value(p, p); });
		oProto.default = 'all';

		var oSport = s.option(form.Value, 'src_port', _('Source port'));
		oSport.placeholder = _('e.g. 80 or 443 1024:2048 or 80,443');
		oSport.depends('proto', 'tcp');
		oSport.depends('proto', 'udp');

		var oDport = s.option(form.Value, 'dst_port', _('Destination port'));
		oDport.placeholder = _('e.g. 80 or 443 1024:2048 or 80,443');
		oDport.depends('proto', 'tcp');
		oDport.depends('proto', 'udp');

		var oFam = s.option(form.ListValue, 'family', _('Address family'));
		oFam.value('',     _('IPv4 and IPv6'));
		oFam.value('ipv4', _('IPv4 only'));
		oFam.value('ipv6', _('IPv6 only'));
		oFam.default = '';

		var resultArea = E('div', {});
		var srcHint = E('span', { 'class': 'mwan3-sim-hint ' + components.textClass('muted') });
		var dstHint = E('span', { 'class': 'mwan3-sim-hint ' + components.textClass('muted') });

		var handleSimulate = function() {
			var srcRaw  = (oSrc.formvalue('sim')  || '').trim();
			var dstRaw  = (oDst.formvalue('sim')  || '').trim();
			var proto   = oProto.formvalue('sim') || 'all';
			var srcPort = (oSport.formvalue('sim') || '').trim();
			var dstPort = (oDport.formvalue('sim') || '').trim();
			var family  = oFam.formvalue('sim')   || '';
			var mark    = (oMark.formvalue('sim')  || '').trim();

			srcHint.textContent = '';
			dstHint.textContent = '';

			if (srcRaw && !looksLikeFqdn(srcRaw) &&
			    !validation.parseIPv4(srcRaw) && !validation.parseIPv6(srcRaw)) {
				dom.content(resultArea, E('p', { 'class': components.textClass('danger') },
					_('Invalid source IP address') + ': ' + srcRaw));
				return;
			}

			if (dstRaw && !looksLikeFqdn(dstRaw) &&
			    !validation.parseIPv4(dstRaw) && !validation.parseIPv6(dstRaw)) {
				dom.content(resultArea, E('p', { 'class': components.textClass('danger') },
					_('Invalid destination IP address') + ': ' + dstRaw));
				return;
			}

			dom.content(resultArea, components.emptyHint(_('Loading...')));

			/* Resolve any FQDNs before running the simulation. */
			var resolveSrc = looksLikeFqdn(srcRaw) ? callResolveHost(srcRaw, family) : Promise.resolve(null);
			var resolveDst = looksLikeFqdn(dstRaw) ? callResolveHost(dstRaw, family) : Promise.resolve(null);

			return Promise.all([resolveSrc, resolveDst]).then(function(resolved) {
				var srcIp = srcRaw;
				var dstIp = dstRaw;

				if (resolved[0] !== null) {
					var srcAddrs = pickFamilyAddrs(resolved[0], family);
					if (!srcAddrs.length) {
						dom.content(resultArea, E('p', { 'class': components.textClass('danger') },
							_('Could not resolve source hostname') + ': ' + srcRaw));
						return;
					}
					srcIp = srcAddrs[0];
					srcHint.textContent = fmtResolutionHint(srcAddrs);
				}

				if (resolved[1] !== null) {
					var dstAddrs = pickFamilyAddrs(resolved[1], family);
					if (!dstAddrs.length) {
						dom.content(resultArea, E('p', { 'class': components.textClass('danger') },
							_('Could not resolve destination hostname') + ': ' + dstRaw));
						return;
					}
					dstIp = dstAddrs[0];
					dstHint.textContent = fmtResolutionHint(dstAddrs);
				}

				var sim = {
					src_ip:   srcIp,
					dst_ip:   dstIp,
					proto:    proto,
					src_port: srcPort,
					dst_port: dstPort,
					family:   family,
					mark:     mark,
				};

				/* Reload UCI, live policy state, and connected sets fresh on every simulate press */
				uci.unload('mwan3');
				return Promise.all([
					uci.load('mwan3'),
					callMwan3Status(),
					callNftsetMembers('mwan3_connected_v4'),
					callNftsetMembers('mwan3_connected_v6'),
				]).then(function(refreshed) {
					var freshPoliciesData = (refreshed[1] || {}).policies || {};
					var freshUciPolicies  = uci.sections('mwan3', 'policy');
					var freshUciRules     = uci.sections('mwan3', 'rule');
					var connected4        = (refreshed[2] || {}).members || [];
					var connected6        = (refreshed[3] || {}).members || [];

					/* Check if destination is in a directly connected network.
					 * mwan3 exempts these before any rule is evaluated. */
					if (sim.dst_ip) {
						var connectedSet = ipmath.isIPv6(sim.dst_ip) ? connected6 : connected4;
						var matchedCidr  = null;
						for (var ci = 0; ci < connectedSet.length; ci++) {
							if (ipmath.ipInCidr(sim.dst_ip, connectedSet[ci])) {
								matchedCidr = connectedSet[ci];
								break;
							}
						}
						if (matchedCidr !== null) {
							dom.content(resultArea, renderConnectedBypass(sim.dst_ip, matchedCidr));
							return;
						}
					}

					/* Collect nftset names referenced by the current rule set */
					var nftsets = [];
					freshUciRules.forEach(function(r) {
						if (r.enabled === '0') return;
						if (r.ipset     && nftsets.indexOf(r.ipset)     < 0) nftsets.push(r.ipset);
						if (r.ipset_src && nftsets.indexOf(r.ipset_src) < 0) nftsets.push(r.ipset_src);
					});

					var setFetches = nftsets.map(function(name) {
						return callNftsetMembers(name).then(function(res) {
							return [name, (res && res.members) || []];
						});
					});

					return Promise.all(setFetches).then(function(results) {
						var nftsetCache = {};
						results.forEach(function(pair) { nftsetCache[pair[0]] = pair[1]; });

						var allMatched = [];
						for (var i = 0; i < freshUciRules.length; i++) {
							if (freshUciRules[i].enabled === '0') continue;
							if (ruleMatches(freshUciRules[i], sim, nftsetCache))
								allMatched.push(i);
						}

						var firstMatch = allMatched.length ? allMatched[0] : -1;
						dom.content(resultArea,
							renderSimResult(freshUciRules, firstMatch, allMatched, sim,
								freshPoliciesData, freshUciPolicies));
					});
				});
			}).catch(function(err) {
				dom.content(resultArea, E('p', { 'class': components.textClass('danger') }, String(err)));
			});
		};

		return m.render().then(function(mapNode) {
			/* Give every input and select a uniform width so the fields align. */
			[ oSrc, oDst, oMark, oProto, oSport, oDport, oFam ].forEach(function(o) {
				var w = o.getUIElement('sim');
				var c = (w && w.node) ? w.node.querySelector('input, select') : null;
				if (c) c.classList.add('mwan3-sim-field');
			});

			/* Attach the resolution hint beside each IP field and clear it when
			   the field is edited. The hint sits inside the widget node so it
			   stays inline with the input. */
			[ [oSrc, srcHint], [oDst, dstHint] ].forEach(function(pair) {
				var widget = pair[0].getUIElement('sim');
				if (!widget || !widget.node) return;
				var input = widget.node.querySelector('input');
				if (input)
					input.addEventListener('input', function() { pair[1].textContent = ''; });
				widget.node.appendChild(pair[1]);
			});

			/* Enter in any input runs the simulation. */
			mapNode.addEventListener('keydown', function(ev) {
				if (ev.key === 'Enter' && ev.target.tagName === 'INPUT')
					handleSimulate();
			});

			var actions = E('div', { 'class': 'right mwan3-sim-actions' }, [
				E('button', {
					'class': 'cbi-button cbi-button-apply',
					'click': ui.createHandlerFn(self, handleSimulate),
				}, _('Simulate')),
			]);

			return E('div', {}, [ mapNode, actions, resultArea ]);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
