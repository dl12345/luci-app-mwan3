'use strict';
'require uci';
'require view';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet',
	'type': 'text/css',
	'href': L.resource('view/mwan3/mwan3.css')
}));

const COLORS = {
	success: '#5cb85c',
	danger:  '#d9534f',
	warning: '#f0ad4e',
	muted:   '#888888',
	info:    '#5bc0de',
};

/*
 * CIDR containment for the rule-shadowing check.
 * A is a superset of B if every IP in B's range is also in A's range.
 * Supports both IPv4 (uint32) and IPv6 (BigInt).
 */

/* ---- IPv4 ---- */
function ipv4ToUint(ip) {
	var parts = ip.split('.');
	return ((parseInt(parts[0], 10) << 24) |
	        (parseInt(parts[1], 10) << 16) |
	        (parseInt(parts[2], 10) << 8)  |
	         parseInt(parts[3], 10)) >>> 0;
}

function ipv4CidrContains(a, b) {
	var slashA = a.indexOf('/'), slashB = b.indexOf('/');
	var prefA  = slashA < 0 ? 32 : parseInt(a.substring(slashA + 1), 10);
	var prefB  = slashB < 0 ? 32 : parseInt(b.substring(slashB + 1), 10);
	if (prefA > prefB) return false; /* A is more specific than B */
	var maskA   = prefA === 0 ? 0 : ((0xFFFFFFFF << (32 - prefA)) >>> 0);
	var netA    = (ipv4ToUint(slashA < 0 ? a : a.substring(0, slashA)) & maskA) >>> 0;
	var netB    = (ipv4ToUint(slashB < 0 ? b : b.substring(0, slashB)) & maskA) >>> 0;
	return netA === netB;
}

/* ---- IPv6 ---- */
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

function ipv6CidrContains(a, b) {
	var slashA = a.indexOf('/'), slashB = b.indexOf('/');
	var prefA  = slashA < 0 ? 128 : parseInt(a.substring(slashA + 1), 10);
	var prefB  = slashB < 0 ? 128 : parseInt(b.substring(slashB + 1), 10);
	if (prefA > prefB) return false; /* A is more specific than B */
	var allOnes = (BigInt(1) << BigInt(128)) - BigInt(1);
	var maskA   = prefA === 0 ? BigInt(0) : allOnes ^ ((BigInt(1) << BigInt(128 - prefA)) - BigInt(1));
	var netA    = ipv6ToBigInt(slashA < 0 ? a : a.substring(0, slashA)) & maskA;
	var netB    = ipv6ToBigInt(slashB < 0 ? b : b.substring(0, slashB)) & maskA;
	return netA === netB;
}

/* True if CIDR A contains CIDR B (A is a superset of B) */
function cidrContains(a, b) {
	if (a.indexOf(':') >= 0 && b.indexOf(':') >= 0) return ipv6CidrContains(a, b);
	if (a.indexOf(':') < 0  && b.indexOf(':') < 0)  return ipv4CidrContains(a, b);
	return false; /* mixed families cannot contain each other */
}

/* Port spec containment: A contains B if every port in B is also in A */
function portSpecContains(a, b) {
	if (!a) return true;  /* A has no restriction -> contains everything */
	if (!b) return false; /* A is restricted, B is unrestricted -> not contained */
	/* Both non-empty: conservative - only flag exact string match */
	return a === b;
}

/*
 * Returns true if rule A (earlier) is a superset of rule B (later),
 * i.e., every packet matching B also matches A -> B is shadowed.
 * We are deliberately conservative: we only flag clear cases.
 */
function ruleAContainsB(a, b) {
	/* Family: A must not be more restrictive than B */
	var famA = a.family || '';
	var famB = b.family || '';
	if (famA && famA !== famB) return false;

	/* Protocol */
	var protoA = a.proto || 'all';
	var protoB = b.proto || 'all';
	if (protoA !== 'all' && protoA !== protoB) return false;

	/* Source IP */
	if (a.src_ip) {
		if (!b.src_ip)             return false; /* A restricts, B does not */
		if (a.src_ip !== b.src_ip && !cidrContains(a.src_ip, b.src_ip)) return false;
	}

	/* Destination IP */
	if (a.dest_ip) {
		if (!b.dest_ip)               return false;
		if (a.dest_ip !== b.dest_ip && !cidrContains(a.dest_ip, b.dest_ip)) return false;
	}

	/* Ports (conservative: only flag identical specs or no restriction on A) */
	if (!portSpecContains(a.src_port,  b.src_port))  return false;
	if (!portSpecContains(a.dest_port, b.dest_port)) return false;

	/* Fwmark */
	if (a.fwmark) {
		if (!b.fwmark)             return false;
		if (a.fwmark !== b.fwmark || (a.fwmask || '') !== (b.fwmask || '')) return false;
	}

	/* NFT set: if A uses a set, we cannot easily determine containment */
	if (a.ipset) return false;

	return true;
}

/* ---- Issue collection ---- */

function collectIssues(uciData) {
	var interfaces = uciData.interfaces; /* map name -> true */
	var members    = uciData.members;    /* map name -> {interface, metric, weight} */
	var policies   = uciData.policies;   /* map name -> {use_member:[...]} */
	var rules      = uciData.rules;      /* ordered array */

	var issues = [];

	function issue(severity, subject, detail) {
		issues.push({ severity: severity, subject: subject, detail: detail });
	}

	/* ---- Member checks ---- */
	Object.keys(members).forEach(function(mname) {
		var m = members[mname];
		if (!interfaces[m.interface])
			issue('error',
				_('Member') + ' \u201c' + mname + '\u201d ' + _('references undefined interface') + ' \u201c' + m.interface + '\u201d',
				_('Traffic assigned to any policy using this member will not be routed correctly.'));
	});

	/* Orphaned members (not used by any policy) */
	var membersInUse = {};
	Object.keys(policies).forEach(function(pname) {
		(policies[pname].use_member || []).forEach(function(m) { membersInUse[m] = true; });
	});
	Object.keys(members).forEach(function(mname) {
		if (!membersInUse[mname])
			issue('warning',
				_('Member') + ' \u201c' + mname + '\u201d ' + _('is not used by any policy'),
				_('This member is defined but has no effect.'));
	});

	/* ---- Policy checks ---- */
	Object.keys(policies).forEach(function(pname) {
		var useMembers = policies[pname].use_member || [];

		if (!useMembers.length)
			issue('error',
				_('Policy') + ' \u201c' + pname + '\u201d ' + _('has no members'),
				_('All traffic assigned to this policy will use the last-resort behaviour.'));

		useMembers.forEach(function(mname) {
			if (!members[mname])
				issue('error',
					_('Policy') + ' \u201c' + pname + '\u201d ' + _('references undefined member') + ' \u201c' + mname + '\u201d',
					_('This member will be ignored; the policy may have fewer active members than expected.'));
		});

		/* All members reference the same interface -> no real redundancy */
		var usedIfaces = {};
		useMembers.forEach(function(mname) {
			if (members[mname]) usedIfaces[members[mname].interface] = true;
		});
		var ifaceCount = Object.keys(usedIfaces).length;
		if (ifaceCount === 1 && useMembers.length > 1)
			issue('warning',
				_('Policy') + ' \u201c' + pname + '\u201d ' + _('has multiple members but all reference the same interface') + ' \u201c' + Object.keys(usedIfaces)[0] + '\u201d',
				_('This provides no redundancy; failover will not occur if that interface goes down.'));
	});

	/* Orphaned policies (not used by any rule) */
	var policiesInUse = {};
	rules.forEach(function(r) { if (r.use_policy) policiesInUse[r.use_policy] = true; });
	var builtins = { unreachable: true, blackhole: true, 'default': true };
	Object.keys(policies).forEach(function(pname) {
		if (!policiesInUse[pname])
			issue('warning',
				_('Policy') + ' \u201c' + pname + '\u201d ' + _('is not used by any rule'),
				_('This policy is defined but has no effect.'));
	});

	/* ---- Rule checks ---- */
	rules.forEach(function(r) {
		var p = r.use_policy;
		if (p && !builtins[p] && !policies[p])
			issue('error',
				_('Rule') + ' \u201c' + r['.name'] + '\u201d ' + _('references undefined policy') + ' \u201c' + p + '\u201d',
				_('Traffic matching this rule will be blackholed silently.'));
	});

	/* Rule shadowing: rule[i] shadows rule[j] if i < j and A contains B */
	for (var i = 0; i < rules.length; i++) {
		for (var j = i + 1; j < rules.length; j++) {
			if (ruleAContainsB(rules[i], rules[j]))
				issue('warning',
					_('Rule') + ' \u201c' + rules[j]['.name'] + '\u201d ' + _('is unreachable'),
					_('Rule') + ' \u201c' + rules[i]['.name'] + '\u201d ' + _('appears earlier and matches a superset of its traffic. The later rule will never be evaluated.'));
		}
	}

	/* Orphaned interfaces */
	var ifacesInUse = {};
	Object.keys(members).forEach(function(mname) {
		if (members[mname].interface) ifacesInUse[members[mname].interface] = true;
	});
	Object.keys(interfaces).forEach(function(iname) {
		if (!ifacesInUse[iname])
			issue('warning',
				_('Interface') + ' \u201c' + iname + '\u201d ' + _('is not referenced by any member'),
				_('This interface will not be used for load balancing or failover.'));
	});

	return issues;
}

/* ---- Rendering ---- */

function severityColor(s) {
	return s === 'error' ? COLORS.danger : s === 'warning' ? COLORS.warning : COLORS.info;
}

function severityLabel(s) {
	return s === 'error' ? _('Error') : s === 'warning' ? _('Warning') : _('Note');
}

function renderSummary(issues) {
	var errors   = issues.filter(function(i) { return i.severity === 'error';   }).length;
	var warnings = issues.filter(function(i) { return i.severity === 'warning'; }).length;

	var color  = errors ? COLORS.danger : warnings ? COLORS.warning : COLORS.success;
	var label  = errors   ? errors   + ' ' + (errors   === 1 ? _('error')   : _('errors'))   + ', '
	                       + warnings + ' ' + (warnings === 1 ? _('warning') : _('warnings'))
	           : warnings ? warnings + ' ' + (warnings === 1 ? _('warning') : _('warnings'))
	           : _('No issues found');

	return E('div', {
		'style': 'border:2px solid ' + color + '; border-radius:4px; padding:0.6em 1em; margin-bottom:1em; font-weight:bold; color:' + color,
	}, label);
}

function renderIssues(issues) {
	if (!issues.length)
		return E('div', {
			'style': 'border:2px solid ' + COLORS.success + '; border-radius:4px; padding:0.6em 1em; color:' + COLORS.success,
		}, _('Configuration looks consistent. No issues detected.'));

	return E('div', {
		'style': 'display:flex; flex-direction:column; gap:0.5em',
	}, issues.map(function(iss) {
		var color = severityColor(iss.severity);
		return E('div', {
			'style': 'border:2px solid ' + color + '; border-radius:4px; padding:0.6em 1em',
		}, [
			E('div', { 'style': 'display:flex; align-items:baseline; gap:0.6em; margin-bottom:0.2em' }, [
				E('span', {
					'style': 'font-size:0.78em; font-weight:bold; text-transform:uppercase; color:' + color,
				}, severityLabel(iss.severity)),
				E('span', { 'style': 'font-weight:bold' }, iss.subject),
			]),
			E('div', { 'style': 'color:' + COLORS.muted + '; font-size:0.92em' }, iss.detail),
		]);
	}));
}

return view.extend({
	load: function() {
		return uci.load('mwan3');
	},

	render: function() {
		/* Build lookup structures from UCI */
		var interfaces = {};
		uci.sections('mwan3', 'interface').forEach(function(s) {
			interfaces[s['.name']] = true;
		});

		var members = {};
		uci.sections('mwan3', 'member').forEach(function(s) {
			members[s['.name']] = {
				interface: s.interface || '',
				metric:    parseInt(s.metric  || '1', 10),
				weight:    parseInt(s.weight  || '1', 10),
			};
		});

		var policies = {};
		uci.sections('mwan3', 'policy').forEach(function(s) {
			var um = s.use_member || [];
			policies[s['.name']] = {
				use_member:  Array.isArray(um) ? um : [um],
				last_resort: s.last_resort || 'unreachable',
			};
		});

		var rules = uci.sections('mwan3', 'rule').filter(function(s) {
			return s.enabled !== '0';
		});

		var issues = collectIssues({ interfaces: interfaces, members: members, policies: policies, rules: rules });

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('MultiWAN Manager - Configuration')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', { 'style': 'color:' + COLORS.muted },
					_('Static analysis of the mwan3 UCI configuration. No live system state is consulted.')),
				renderSummary(issues),
				renderIssues(issues),
			]),
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
