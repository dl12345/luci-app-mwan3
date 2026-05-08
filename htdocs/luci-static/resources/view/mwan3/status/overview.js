'use strict';
'require poll';
'require view';
'require rpc';
'require uci';

const callMwan3Status = rpc.declare({
	object: 'mwan3',
	method: 'status',
	params: ['section'],
	expect: {},
});

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
};

function formatDuration(secs) {
	var d = Math.floor(secs / 86400);
	var h = Math.floor((secs % 86400) / 3600);
	var m = Math.floor((secs % 3600) / 60);
	var parts = [];
	if (d > 0) parts.push(d + 'd');
	if (d > 0 || h > 0) parts.push(h + 'h');
	parts.push(m + 'm');
	return parts.join(' ');
}

function renderInterfaces(interfaces) {
	if (!interfaces)
		return [ E('em', {}, _('No interfaces found')) ];

	return Object.keys(interfaces).map(function(iface) {
		var d = interfaces[iface];
		var status, color, time, tname;

		switch (d.status) {
			case 'online':
				status = _('Online');
				color = COLORS.success;
				time = formatDuration(d.online);
				tname = _('Online');
				break;
			case 'offline':
				status = _('Offline');
				color = COLORS.danger;
				time = formatDuration(d.offline);
				tname = _('Offline');
				break;
			case 'notracking':
				status = _('No Tracking');
				color = d.uptime > 0 ? COLORS.success : COLORS.warning;
				time = d.uptime > 0 ? formatDuration(d.uptime) : null;
				tname = _('Uptime');
				break;
			default:
				status = _('Disabled');
				color = COLORS.muted;
				time = null;
				tname = null;
		}

		var children = [
			E('div', {}, [ E('strong', {}, _('Interface') + ': '), iface ]),
			E('div', {}, [ E('strong', {}, _('Status') + ': '), E('span', { 'style': 'color:' + color }, status) ]),
		];

		if (time)
			children.push(E('div', {}, [ E('strong', {}, tname + ': '), time ]));

		return E('div', {
			'style': 'border:2px solid ' + color + '; border-radius:4px; padding:0.5em 0.8em',
		}, children);
	});
}

function renderPolicies(policies) {
	if (!policies)
		return [ E('em', {}, _('No policy data available')) ];

	var cards = [];
	var shown = {};

	[ 'ipv4', 'ipv6' ].forEach(function(family) {
		var fam = (policies[family] || {});
		Object.keys(fam).forEach(function(pname) {
			if (shown[pname]) return;
			shown[pname] = true;

			var members = fam[pname].map(function(m) {
				var color;
				if (m.percent > 0)
					color = COLORS.success;
				else if (m.status === 'online')
					color = COLORS.warning;
				else
					color = COLORS.muted;

				return E('div', { 'style': 'white-space:nowrap; color:' + color }, [
					m.interface + ' (' + m.percent + '%)',
				]);
			});

			cards.push(E('div', {
				'style': 'border:2px solid #999; border-radius:4px; padding:0.5em 0.8em',
			}, [
				E('div', { 'style': 'font-weight:bold; margin-bottom:0.3em' },
					_('Policy') + ': ' + pname),
				...members,
			]));
		});
	});

	return cards.length ? cards : [ E('em', {}, _('No policies configured')) ];
}

function fmtAddr(addr, port) {
	var a = (addr && addr.length > 0) ? addr : null;
	var p = (port && port.length > 0) ? port : null;
	if (a && p) return a + ':' + p;
	if (a) return a;
	if (p) return '*:' + p;
	return null;
}

function renderRules(rules) {
	if (!rules || !rules.length)
		return E('em', {}, _('No rules configured'));

	var rows = [
		E('tr', { 'class': 'tr cbi-section-table-titles' }, [
			E('th', { 'class': 'th', 'style': 'width:20%' }, _('Rule')),
			E('th', { 'class': 'th', 'style': 'width:55%; text-align:center' }, _('Match')),
			E('th', { 'class': 'th', 'style': 'width:25%; text-align:right' }, _('Policy')),
		])
	];

	rules.forEach(function(r) {
		if (r.enabled === '0') return;
		var match = [];
		var src = fmtAddr(r.src_ip || r.ipset_src, r.src_port);
		var dst = fmtAddr(r.dest_ip || r.ipset, r.dest_port);
		if (r.proto && r.proto !== 'all') match.push('proto: ' + r.proto);
		if (src) match.push('src: ' + src);
		if (dst) match.push('dst: ' + dst);
		if (r.fwmark && r.fwmask) match.push('mark: ' + r.fwmark + '/' + r.fwmask);
		if (r.sticky === '1') match.push(_('sticky'));

		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, r['.name']),
			E('td', { 'class': 'td', 'style': 'text-align:center' }, match.join(', ') || _('(all traffic)')),
			E('td', { 'class': 'td', 'style': 'text-align:right' }, r.use_policy || '-'),
		]));
	});

	return E('table', { 'class': 'table cbi-section-table',
		'style': 'width:100%; table-layout:fixed' }, rows);
}

const IFACE_GRID_STYLE = 'display:grid; grid-template-columns:repeat(auto-fill, 13em); gap:0.5em';

const POLICY_GRID_STYLE = 'display:grid; grid-template-columns:repeat(auto-fill, 13em); gap:0.5em';

function updateLiveStatus(result) {
	var ifaceEl  = document.getElementById('mwan3-overview-ifaces');
	var policyEl = document.getElementById('mwan3-overview-policies');

	if (ifaceEl) {
		while (ifaceEl.firstChild) ifaceEl.removeChild(ifaceEl.firstChild);
		renderInterfaces(result.interfaces).forEach(function(el) { ifaceEl.appendChild(el); });
	}

	if (policyEl) {
		while (policyEl.firstChild) policyEl.removeChild(policyEl.firstChild);
		renderPolicies(result.policies).forEach(function(el) { policyEl.appendChild(el); });
	}
}

return view.extend({
	load: function() {
		return Promise.all([
			callMwan3Status(),
			uci.load('mwan3'),
		]);
	},

	render: function(data) {
		var result = data[0] || {};
		var rules  = uci.sections('mwan3', 'rule');

		poll.add(function() {
			return callMwan3Status().then(updateLiveStatus);
		});

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('MultiWAN Manager - Overview')),

			E('div', { 'class': 'cbi-section', 'style': 'margin-top:1em' }, [
				E('h3', {}, _('Interfaces')),
				E('div', { 'id': 'mwan3-overview-ifaces', 'style': IFACE_GRID_STYLE }, renderInterfaces(result.interfaces)),
			]),

			E('div', { 'class': 'cbi-section', 'style': 'margin-top:1em' }, [
				E('h3', {}, _('Policies')),
				E('div', { 'id': 'mwan3-overview-policies', 'style': POLICY_GRID_STYLE }, renderPolicies(result.policies)),
			]),

			E('div', { 'class': 'cbi-section', 'style': 'margin-top:1em' }, [
				E('h3', {}, _('Rules')),
				renderRules(rules),
			]),
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
