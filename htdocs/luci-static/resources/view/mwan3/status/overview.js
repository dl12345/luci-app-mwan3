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

function renderInterfaces(interfaces) {
	if (!interfaces)
		return [ E('em', {}, _('No interfaces found')) ];

	return Object.keys(interfaces).map(function(iface) {
		var d = interfaces[iface];
		var status, css, time, tname;

		switch (d.status) {
			case 'online':
				status = _('Online');
				css = 'success';
				time = '%t'.format(d.online);
				tname = _('Online');
				break;
			case 'offline':
				status = _('Offline');
				css = 'danger';
				time = '%t'.format(d.offline);
				tname = _('Offline');
				break;
			case 'notracking':
				status = _('No Tracking');
				css = d.uptime > 0 ? 'success' : 'warning';
				time = d.uptime > 0 ? '%t'.format(d.uptime) : null;
				tname = _('Uptime');
				break;
			default:
				status = _('Disabled');
				css = 'warning';
				time = null;
				tname = null;
		}

		var children = [
			E('div', {}, [ E('strong', {}, _('Interface') + ':\u00a0'), iface ]),
			E('div', {}, [ E('strong', {}, _('Status') + ':\u00a0'), status ]),
		];

		if (time)
			children.push(E('div', {}, [ E('strong', {}, tname + ':\u00a0'), time ]));

		return E('div', { 'class': 'alert-message ' + css, 'style': 'flex:1 1 auto' }, children);
	});
}

function renderPolicies(policies) {
	if (!policies)
		return E('em', {}, _('No policy data available'));

	var rows = [];

	var shown = {};
	[ 'ipv4', 'ipv6' ].forEach(function(family) {
		var fam = (policies[family] || {});
		Object.keys(fam).forEach(function(pname) {
			if (shown[pname]) return;
			shown[pname] = true;
			rows.push(E('tr', { 'class': 'tr cbi-section-table-titles' }, [
				E('th', { 'class': 'th', 'colspan': '2' }, pname),
			]));
			fam[pname].forEach(function(m) {
				rows.push(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'style': 'padding-left:1.5em' }, m.interface),
					E('td', { 'class': 'td', 'style': 'text-align:right' }, m.percent + '%'),
				]));
			});
		});
	});

	return E('table', { 'class': 'table cbi-section-table',
		'style': 'width:100%; table-layout:fixed' }, [
		E('colgroup', {}, [
			E('col', { 'style': 'width:70%' }),
			E('col', { 'style': 'width:30%' }),
		]),
		...rows,
	]);
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
		var match = [];
		if (r.src_ip)    match.push('src: '   + r.src_ip);
		if (r.dest_ip)   match.push('dst: '   + r.dest_ip);
		if (r.proto && r.proto !== 'all') match.push('proto: ' + r.proto);
		if (r.src_port)  match.push('sport: ' + r.src_port);
		if (r.dest_port) match.push('dport: ' + r.dest_port);
		if (r.ipset)     match.push('ipset: ' + r.ipset);
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

function updateLiveStatus(result) {
	var ifaceEl  = document.getElementById('mwan3-overview-ifaces');
	var policyEl = document.getElementById('mwan3-overview-policies');

	if (ifaceEl) {
		while (ifaceEl.firstChild) ifaceEl.removeChild(ifaceEl.firstChild);
		renderInterfaces(result.interfaces).forEach(function(el) {
			el.style.flex = '1 1 auto';
			ifaceEl.appendChild(el);
		});
	}

	if (policyEl) {
		while (policyEl.firstChild) policyEl.removeChild(policyEl.firstChild);
		policyEl.appendChild(renderPolicies(result.policies));
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
				E('div', { 'id': 'mwan3-overview-ifaces', 'style': 'display:flex; flex-wrap:wrap; gap:0.5em' }, [
					...renderInterfaces(result.interfaces)
				]),
			]),

			E('div', { 'class': 'cbi-section', 'style': 'margin-top:1em' }, [
				E('div', { 'style': 'display:flex; justify-content:space-between; align-items:baseline' }, [
					E('h3', { 'style': 'margin:0' }, _('Policies')),
					E('h3', { 'style': 'margin:0' }, _('Share')),
				]),
				E('div', { 'id': 'mwan3-overview-policies' }, [
					renderPolicies(result.policies),
				]),
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
