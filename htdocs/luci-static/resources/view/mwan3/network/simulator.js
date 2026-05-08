'use strict';
'require rpc';
'require uci';
'require view';
'require dom';
'require ui';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet',
	'type': 'text/css',
	'href': L.resource('view/mwan3/mwan3.css')
}));

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

const COLORS = {
	success: '#5cb85c',
	danger:  '#d9534f',
	warning: '#f0ad4e',
	muted:   '#888888',
	info:    '#5bc0de',
};

/* ---- IPv4 CIDR helpers ---- */

function ipv4ToUint(ip) {
	var parts = ip.split('.');
	return ((parseInt(parts[0], 10) << 24) |
	        (parseInt(parts[1], 10) << 16) |
	        (parseInt(parts[2], 10) << 8)  |
	         parseInt(parts[3], 10)) >>> 0;
}

function ipv4InCidr(ip, cidr) {
	var slash = cidr.indexOf('/');
	if (slash < 0) return ip === cidr;
	var prefix  = parseInt(cidr.substring(slash + 1), 10);
	var mask    = prefix === 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
	var network = ipv4ToUint(cidr.substring(0, slash)) & mask;
	return (ipv4ToUint(ip) & mask) === network;
}

/* ---- IPv6 CIDR helpers ---- */

function expandIPv6(ip) {
	var halves = ip.split('::');
	if (halves.length === 2) {
		var left  = halves[0] ? halves[0].split(':') : [];
		var right = halves[1] ? halves[1].split(':') : [];
		var fill  = 8 - left.length - right.length;
		for (var i = 0; i < fill; i++) left.push('0');
		return left.concat(right);
	}
	return ip.split(':');
}

function ipv6ToBigInt(ip) {
	var groups = expandIPv6(ip);
	var result = BigInt(0);
	for (var i = 0; i < 8; i++)
		result = (result << BigInt(16)) | BigInt(parseInt(groups[i] || '0', 16));
	return result;
}

function ipv6InCidr(ip, cidr) {
	var slash = cidr.indexOf('/');
	if (slash < 0) return ip.toLowerCase() === cidr.toLowerCase();
	var prefix  = parseInt(cidr.substring(slash + 1), 10);
	var allOnes = (BigInt(1) << BigInt(128)) - BigInt(1);
	var mask    = prefix === 0 ? BigInt(0)
	            : allOnes ^ ((BigInt(1) << BigInt(128 - prefix)) - BigInt(1));
	var ipInt   = ipv6ToBigInt(ip);
	var netInt  = ipv6ToBigInt(cidr.substring(0, slash));
	return (ipInt & mask) === (netInt & mask);
}

function isIPv6(ip) {
	return ip.indexOf(':') >= 0;
}

function ipInCidr(ip, cidr) {
	if (!ip || !cidr) return false;
	return isIPv6(ip) ? ipv6InCidr(ip, cidr) : ipv4InCidr(ip, cidr);
}

/* ---- FQDN helpers ---- */

function looksLikeFqdn(str) {
	if (!str) return false;
	if (str.indexOf(':') >= 0) return false;   /* IPv6 */
	var parts = str.split('.');
	if (parts.length === 4) {
		var allOctet = true;
		for (var i = 0; i < 4; i++) {
			var n = parseInt(parts[i], 10);
			if (isNaN(n) || String(n) !== parts[i] || n < 0 || n > 255) { allOctet = false; break; }
		}
		if (allOctet) return false;  /* plain IPv4 */
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
	if (addrs.length > 1) s += ' (+' + (addrs.length - 1) + ' ' + _('more') + ')';
	return s;
}

/* ---- NFT set membership ---- */

function ipInSet(ip, members) {
	for (var i = 0; i < members.length; i++) {
		var m = members[i];
		if (m.indexOf('-') > 0 && !isIPv6(m)) {
			/* IPv4 range: a.b.c.d-a.b.c.e */
			var ends  = m.split('-');
			var start = ipv4ToUint(ends[0]);
			var end   = ipv4ToUint(ends[1]);
			var addr  = ipv4ToUint(ip);
			if (addr >= start && addr <= end) return true;
		} else if (m.indexOf('/') >= 0) {
			if (ipInCidr(ip, m)) return true;
		} else if (m === ip) {
			return true;
		}
	}
	return false;
}

/* ---- Port matching ---- */

function portMatches(port, spec) {
	/* port: user input string or ''; spec: UCI rule value or undefined */
	if (!spec) return true;   /* rule has no port constraint */
	if (!port) return true;   /* no port entered -- treat as wildcard */
	var p = parseInt(port, 10);
	if (isNaN(p)) return false;
	var parts = spec.split(',');
	for (var i = 0; i < parts.length; i++) {
		var part = parts[i].trim();
		if (part.indexOf(':') >= 0) {
			var range = part.split(':');
			if (p >= parseInt(range[0], 10) && p <= parseInt(range[1], 10)) return true;
		} else if (parseInt(part, 10) === p) {
			return true;
		}
	}
	return false;
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
		if (!ipInCidr(sim.src_ip, rule.src_ip)) return false;
	}

	/* Destination IP: same */
	if (rule.dest_ip) {
		if (!sim.dst_ip) return false;
		if (!ipInCidr(sim.dst_ip, rule.dest_ip)) return false;
	}

	/* Source port: blank means rule must have no src_port constraint.
	 * Multiple ports may be entered; the rule matches if any one of them
	 * falls within the rule's port spec. */
	if (rule.src_port) {
		if (!sim.src_port) return false;
		var srcPorts = sim.src_port.split(/[\s,]+/).filter(Boolean);
		if (!srcPorts.some(function(p) { return portMatches(p, rule.src_port); })) return false;
	}

	/* Destination port: same */
	if (rule.dest_port) {
		if (!sim.dst_port) return false;
		var dstPorts = sim.dst_port.split(/[\s,]+/).filter(Boolean);
		if (!dstPorts.some(function(p) { return portMatches(p, rule.dest_port); })) return false;
	}

	/* Source NFT set: requires a src IP to check membership */
	if (rule.ipset_src) {
		if (!sim.src_ip) return false;
		var srcMembers = nftsetCache[rule.ipset_src] || [];
		if (!ipInSet(sim.src_ip, srcMembers)) return false;
	}

	/* Destination NFT set: requires a dst IP to check membership */
	if (rule.ipset) {
		if (!sim.dst_ip) return false;
		var members = nftsetCache[rule.ipset] || [];
		if (!ipInSet(sim.dst_ip, members)) return false;
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
		return E('div', { 'style': 'margin-top:0.4em; color:' + COLORS.muted },
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
			return E('div', { 'style': 'color:' + COLORS.danger }, _('Policy not found in configuration'));
		return E('div', { 'style': 'color:' + COLORS.muted + '; margin-top:0.4em' },
			_('mwan3 not running - cannot show live member state'));
	}

	var memberEls = liveMembers.map(function(m) {
		var color = m.percent > 0 ? COLORS.success
		          : m.status === 'online' ? COLORS.warning
		          : COLORS.muted;
		var label = m.interface
			+ ' (' + _('metric') + '\u00a0' + m.metric + ', ' + _('weight') + '\u00a0' + m.weight + ')'
			+ ' \u2014 ' + (m.percent > 0 ? m.percent + '%' : m.status);
		return E('div', { 'style': 'padding-left:1em; color:' + color }, label);
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
			? E('div', { 'style': 'margin-top:0.3em; color:' + COLORS.success },
				_('Traffic will use') + ': ' + active[0].interface)
			: E('div', { 'style': 'margin-top:0.3em; color:' + COLORS.success },
				_('Traffic will be load-balanced across ') + active.length + _(' members'));
	} else {
		outcome = E('div', { 'style': 'margin-top:0.3em; color:' + COLORS.danger },
			_('All members offline - last resort') + ': ' + lastResort);
	}

	return E('div', {}, [
		E('div', { 'style': 'margin-top:0.4em; font-style:italic; color:' + COLORS.muted },
			_('Live member state') + ':'),
		...memberEls,
		outcome,
	]);
}

function renderConnectedBypass(dstIp, matchedCidr) {
	return E('div', {
		'style': 'border:2px solid ' + COLORS.info + '; border-radius:4px; padding:0.7em 1em; margin-top:1em',
	}, [
		E('div', { 'style': 'font-weight:bold; color:' + COLORS.info },
			_('mwan3 rules bypassed - directly connected network')),
		E('div', { 'style': 'margin-top:0.4em' },
			_('Destination') + ' ' + dstIp + ' ' + _('is in the connected set') +
			(matchedCidr ? ' (' + matchedCidr + ')' : '') + '.'),
		E('div', { 'style': 'margin-top:0.3em; color:' + COLORS.muted },
			_('mwan3 exempts directly connected networks from policy routing before any rule is evaluated. ' +
			  'Traffic is forwarded via the main routing table regardless of configured rules. ' +
			  'Use firewall rules, not mwan3 policies, to control access to these networks.')),
	]);
}

function renderSimResult(rules, matchedIdx, allMatched, sim, policiesData, uciPolicies) {
	if (matchedIdx < 0) {
		return E('div', {
			'style': 'border:2px solid ' + COLORS.muted + '; border-radius:4px; padding:0.7em 1em; margin-top:1em',
		}, [
			E('div', { 'style': 'font-weight:bold; color:' + COLORS.muted }, _('No rule matched')),
			E('div', { 'style': 'margin-top:0.3em' },
				_('Traffic will be routed using the main routing table.')),
		]);
	}

	var matched = rules[matchedIdx];
	var pName   = matched.use_policy || '-';
	var liveMembers = (policiesData && (
		(policiesData.ipv4 && policiesData.ipv4[pName]) ||
		(policiesData.ipv6 && policiesData.ipv6[pName])
	)) || [];
	var anyActive = liveMembers.some(function(m) { return m.percent > 0; });
	var borderColor = pName === 'blackhole' || pName === 'unreachable' ? COLORS.warning
	                : anyActive ? COLORS.success
	                : COLORS.danger;

	var cards = [];

	/* Primary match card */
	cards.push(E('div', {
		'style': 'border:2px solid ' + borderColor + '; border-radius:4px; padding:0.7em 1em; margin-top:1em',
	}, [
		E('div', { 'style': 'font-weight:bold; font-size:1.05em; margin-bottom:0.3em' },
			_('First matching rule') + ': ' + matched['.name']),
		E('div', {}, [ E('strong', {}, _('Match') + ':\u00a0'), matchSummary(matched) ]),
		E('div', {}, [ E('strong', {}, _('Policy') + ':\u00a0'), pName ]),
		renderPolicyDetail(pName, policiesData, uciPolicies),
	]));

	/* Shadowed rules */
	var shadowed = [];
	for (var i = 0; i < allMatched.length; i++) {
		if (allMatched[i] !== matchedIdx) shadowed.push(rules[allMatched[i]]);
	}

	if (shadowed.length) {
		var rows = [
			E('tr', { 'class': 'tr cbi-section-table-titles' }, [
				E('th', { 'class': 'th' }, _('Shadowed rule')),
				E('th', { 'class': 'th' }, _('Match')),
				E('th', { 'class': 'th', 'style': 'text-align:right' }, _('Policy')),
			])
		];
		shadowed.forEach(function(r) {
			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, r['.name']),
				E('td', { 'class': 'td' }, matchSummary(r)),
				E('td', { 'class': 'td', 'style': 'text-align:right; color:' + COLORS.muted },
					r.use_policy || '-'),
			]));
		});
		cards.push(E('div', { 'style': 'margin-top:1em' }, [
			E('h4', { 'style': 'margin-bottom:0.4em; color:' + COLORS.muted },
				_('Also matched (shadowed by first rule)')),
			E('table', { 'class': 'table cbi-section-table', 'style': 'width:100%' }, rows),
		]));
	}

	return E('div', {}, cards);
}

return view.extend({
	load: function() {
		return uci.load('mwan3');
	},

	render: function() {
		/* Build protocol dropdown */
		var protoOpts = ['all', 'tcp', 'udp', 'icmp', 'esp'].map(function(p) {
			return E('option', { 'value': p }, p);
		});

		/* Build family dropdown */
		var famOpts = [
			E('option', { 'value': '' },     _('IPv4 and IPv6')),
			E('option', { 'value': 'ipv4' }, _('IPv4 only')),
			E('option', { 'value': 'ipv6' }, _('IPv6 only')),
		];

		var resultArea = E('div', { 'id': 'sim-result' });

		var portRow = function(id, label) {
			return E('div', { 'class': 'cbi-value', 'id': id + '-row', 'style': 'display:none' }, [
				E('label', { 'class': 'cbi-value-title' }, label),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', { 'class': 'cbi-input-text', 'id': id, 'type': 'text',
						'placeholder': _('e.g. 80 or 443 1024:2048 or 80,443'), 'style': 'width:16em' }),
				]),
			]);
		};

		var protoSel = E('select', { 'class': 'cbi-input-select', 'id': 'sim-proto' }, protoOpts);

		/* Show/hide port fields when proto changes */
		protoSel.addEventListener('change', function() {
			var show = (protoSel.value === 'tcp' || protoSel.value === 'udp');
			document.getElementById('sim-sport-row').style.display = show ? '' : 'none';
			document.getElementById('sim-dport-row').style.display = show ? '' : 'none';
		});

		var handleSimulate = function() {
			var srcRaw  = (document.getElementById('sim-src-ip').value  || '').trim();
			var dstRaw  = (document.getElementById('sim-dst-ip').value  || '').trim();
			var proto   = document.getElementById('sim-proto').value;
			var srcPort = (document.getElementById('sim-sport').value   || '').trim();
			var dstPort = (document.getElementById('sim-dport').value   || '').trim();
			var family  = document.getElementById('sim-family').value;
			var mark    = (document.getElementById('sim-mark').value    || '').trim();

			var srcHint = document.getElementById('sim-src-ip-hint');
			var dstHint = document.getElementById('sim-dst-ip-hint');
			if (srcHint) srcHint.textContent = '';
			if (dstHint) dstHint.textContent = '';

			dom.content(resultArea, E('em', {}, _('Loading...')));

			/* Resolve any FQDNs before running the simulation. */
			var resolveSrc = looksLikeFqdn(srcRaw) ? callResolveHost(srcRaw, family) : Promise.resolve(null);
			var resolveDst = looksLikeFqdn(dstRaw) ? callResolveHost(dstRaw, family) : Promise.resolve(null);

			return Promise.all([resolveSrc, resolveDst]).then(function(resolved) {
				var srcIp = srcRaw;
				var dstIp = dstRaw;

				if (resolved[0] !== null) {
					var srcAddrs = pickFamilyAddrs(resolved[0], family);
					if (!srcAddrs.length) {
						dom.content(resultArea, E('p', { 'style': 'color:' + COLORS.danger },
							_('Could not resolve source hostname') + ': ' + srcRaw));
						return;
					}
					srcIp = srcAddrs[0];
					if (srcHint) srcHint.textContent = fmtResolutionHint(srcAddrs);
				}

				if (resolved[1] !== null) {
					var dstAddrs = pickFamilyAddrs(resolved[1], family);
					if (!dstAddrs.length) {
						dom.content(resultArea, E('p', { 'style': 'color:' + COLORS.danger },
							_('Could not resolve destination hostname') + ': ' + dstRaw));
						return;
					}
					dstIp = dstAddrs[0];
					if (dstHint) dstHint.textContent = fmtResolutionHint(dstAddrs);
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
						var connectedSet = isIPv6(sim.dst_ip) ? connected6 : connected4;
						var matchedCidr  = null;
						for (var ci = 0; ci < connectedSet.length; ci++) {
							if (ipInCidr(sim.dst_ip, connectedSet[ci])) {
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
				dom.content(resultArea, E('p', { 'style': 'color:' + COLORS.danger }, String(err)));
			});
		};

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('MultiWAN Manager - Traffic Path Simulator')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', { 'style': 'color:' + COLORS.muted },
					_('Enter traffic parameters to simulate which mwan3 rule matches and which policy would handle the traffic. IP fields accept addresses or hostnames - hostnames are resolved via the local DNS server. Rules with a constraint on a field you leave blank will not match.')),

				(function() {
					var formSection = E('div', { 'class': 'cbi-section-node' }, [
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Source IP/Name')),
							E('div', { 'class': 'cbi-value-field' }, [
								E('input', {
									'class': 'cbi-input-text', 'id': 'sim-src-ip', 'type': 'text',
									'placeholder': _('e.g. 192.168.1.5 or hostname'), 'style': 'width:20em',
									'input': function() { var h = document.getElementById('sim-src-ip-hint'); if (h) h.textContent = ''; },
								}),
								E('span', { 'id': 'sim-src-ip-hint', 'style': 'color:' + COLORS.muted + '; margin-left:0.5em; font-size:0.9em' }),
							]),
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Destination IP/Name')),
							E('div', { 'class': 'cbi-value-field' }, [
								E('input', {
									'class': 'cbi-input-text', 'id': 'sim-dst-ip', 'type': 'text',
									'placeholder': _('e.g. 8.8.4.4 or hostname'), 'style': 'width:20em',
									'input': function() { var h = document.getElementById('sim-dst-ip-hint'); if (h) h.textContent = ''; },
								}),
								E('span', { 'id': 'sim-dst-ip-hint', 'style': 'color:' + COLORS.muted + '; margin-left:0.5em; font-size:0.9em' }),
							]),
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Fwmark')),
							E('div', { 'class': 'cbi-value-field' }, [
								E('input', { 'class': 'cbi-input-text', 'id': 'sim-mark', 'type': 'text',
									'placeholder': '0x80000', 'style': 'width:12em' }),
							]),
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Protocol')),
							E('div', { 'class': 'cbi-value-field' }, [ protoSel ]),
						]),
						portRow('sim-sport', _('Source port')),
						portRow('sim-dport', _('Destination port')),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Address family')),
							E('div', { 'class': 'cbi-value-field' }, [
								E('select', { 'class': 'cbi-input-select', 'id': 'sim-family' }, famOpts),
							]),
						]),
					]);
					formSection.addEventListener('keydown', function(ev) {
						if (ev.key === 'Enter' && ev.target.tagName === 'INPUT')
							handleSimulate();
					});
					return formSection;
				})(),
				E('div', { 'class': 'right', 'style': 'margin-top:0.5em' }, [
					E('button', {
						'class': 'cbi-button cbi-button-apply',
						'click': ui.createHandlerFn(this, handleSimulate),
					}, _('Simulate')),
				]),
			]),
			resultArea,
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
