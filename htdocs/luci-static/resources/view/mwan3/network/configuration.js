'use strict';
'require uci';
'require view';
'require mwan3.ipmath as ipmath';
'require mwan3.components as components';
'require mwan3.validators as validators';

/* Static analysis of the mwan3 UCI configuration. No live system state is
   consulted. */

/* Port spec containment: A contains B if every port in B is also in A */
function portSpecContains(a, b) {
	if (!a) return true;  /* A has no restriction, contains everything */
	if (!b) return false; /* A is restricted, B is unrestricted, not contained */
	/* Both non-empty: conservative, only flag exact string match */
	return a === b;
}

/*
 * Returns true if rule A (earlier) is a superset of rule B (later),
 * i.e., every packet matching B also matches A so B is shadowed.
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
		if (a.src_ip !== b.src_ip && !ipmath.cidrContains(a.src_ip, b.src_ip)) return false;
	}

	/* Source MAC (conservative: only equal lists contain each other) */
	if (a.src_mac) {
		if (!b.src_mac) return false;
		if (validators.parseMacList(a.src_mac).join(',') !== validators.parseMacList(b.src_mac).join(',')) return false;
	}

	/* Destination IP */
	if (a.dest_ip) {
		if (!b.dest_ip)               return false;
		if (a.dest_ip !== b.dest_ip && !ipmath.cidrContains(a.dest_ip, b.dest_ip)) return false;
	}

	/* Ports (conservative: only flag identical specs or no restriction on A) */
	if (!portSpecContains(a.src_port,  b.src_port))  return false;
	if (!portSpecContains(a.dest_port, b.dest_port)) return false;

	/* Fwmark */
	if (a.fwmark) {
		if (!b.fwmark)             return false;
		if (a.fwmark !== b.fwmark || (a.fwmask || '') !== (b.fwmask || '')) return false;
	}

	/* NFT sets: if A restricts by set, B must use the same set */
	if (a.ipset) {
		if (a.ipset !== b.ipset) return false;
	}
	if (a.ipset_src) {
		if (a.ipset_src !== b.ipset_src) return false;
	}

	return true;
}

/* ---- Issue collection ---- */

function collectIssues(uciData) {
	var interfaces = uciData.interfaces; /* map name to true */
	var members    = uciData.members;    /* map name to {interface, metric, weight} */
	var policies   = uciData.policies;   /* map name to {use_member:[...]} */
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

		/* All members reference the same interface so no real redundancy */
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

function issueSeverity(s) {
	return s === 'error' ? 'danger' : s === 'warning' ? 'warning' : 'info';
}

function severityLabel(s) {
	return s === 'error' ? _('Error') : s === 'warning' ? _('Warning') : _('Note');
}

function renderSummary(issues) {
	var errors   = issues.filter(function(i) { return i.severity === 'error';   }).length;
	var warnings = issues.filter(function(i) { return i.severity === 'warning'; }).length;

	var severity = errors ? 'danger' : warnings ? 'warning' : 'success';
	var label  = errors   ? errors   + ' ' + (errors   === 1 ? _('error')   : _('errors'))   + ', '
	                       + warnings + ' ' + (warnings === 1 ? _('warning') : _('warnings'))
	           : warnings ? warnings + ' ' + (warnings === 1 ? _('warning') : _('warnings'))
	           : _('No issues found');

	return components.summaryBar(severity, label);
}

function renderIssues(issues) {
	if (!issues.length)
		return components.card('success',
			_('Configuration looks consistent. No issues detected.'), 'mwan3-ok');

	return E('div', { 'class': 'mwan3-issues' }, issues.map(function(iss) {
		var severity = issueSeverity(iss.severity);
		return components.card(severity, [
			E('div', { 'class': 'mwan3-issue-head' }, [
				E('span', { 'class': 'mwan3-issue-label ' + components.textClass(severity) },
					severityLabel(iss.severity)),
				E('span', { 'class': 'mwan3-strong' }, iss.subject),
			]),
			E('div', { 'class': 'mwan3-muted mwan3-issue-detail' }, iss.detail),
		]);
	}));
}

return view.extend({
	load: function() {
		return uci.load('mwan3');
	},

	render: function() {
		components.loadStyle();

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
				E('p', { 'class': 'mwan3-muted' },
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
