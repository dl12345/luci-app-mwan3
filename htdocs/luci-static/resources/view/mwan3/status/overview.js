'use strict';
'require poll';
'require view';
'require rpc';
'require uci';
'require dom';
'require ui';
'require mwan3.components as components';
'require mwan3.format as format';

const callMwan3Status = rpc.declare({
	object: 'mwan3',
	method: 'status',
	params: ['section'],
	expect: {},
});

function renderInterfaces(interfaces) {
	if (!interfaces)
		return [ components.emptyHint(_('No interfaces found')) ];

	return Object.keys(interfaces).map(function(iface) {
		var d = interfaces[iface];
		var si = components.statusInfo(d);

		var children = [
			E('div', {}, [ E('strong', {}, _('Interface') + ': '), iface ]),
			E('div', {}, [ E('strong', {}, _('Status') + ': '), components.statusText(si.label, si.severity) ]),
		];

		if (si.duration != null)
			children.push(E('div', {}, [ E('strong', {}, si.durationLabel + ': '), format.formatDuration(si.duration) ]));

		return components.card(si.severity, children, 'mwan3-card--sm');
	});
}

function renderPolicies(policies) {
	if (!policies)
		return [ components.emptyHint(_('No policy data available')) ];

	var cards = [];
	var shown = {};

	[ 'ipv4', 'ipv6' ].forEach(function(family) {
		var fam = (policies[family] || {});
		Object.keys(fam).forEach(function(pname) {
			if (shown[pname]) return;
			shown[pname] = true;

			var members = fam[pname].map(function(m) {
				var severity;
				if (m.percent > 0)
					severity = 'success';
				else if (m.status === 'online')
					severity = 'warning';
				else
					severity = 'muted';

				return E('div', { 'class': 'mwan3-nowrap ' + components.textClass(severity) },
					components.text(m.interface + ' (' + m.percent + '%)'));
			});

			cards.push(components.card(null, [
				E('div', { 'class': 'mwan3-policy-title' }, components.text(_('Policy') + ': ' + pname)),
				...members,
			], 'mwan3-card--sm mwan3-card--policy'));
		});
	});

	return cards.length ? cards : [ components.emptyHint(_('No policies configured')) ];
}

function renderRuleRows(rules) {
	var rows = [];

	(rules || []).forEach(function(r) {
		if (r.enabled === '0') return;
		var match = [];
		var src = format.fmtAddr(r.src_ip || r.ipset_src, r.src_port);
		var dst = format.fmtAddr(r.dest_ip || r.ipset, r.dest_port);
		if (r.proto && r.proto !== 'all') match.push('proto: ' + r.proto);
		if (src) match.push('src: ' + src);
		if (dst) match.push('dst: ' + dst);
		if (r.fwmark && r.fwmask) match.push('mark: ' + r.fwmark + '/' + r.fwmask);
		if (r.sticky === '1') match.push(_('sticky'));

		rows.push([
			components.text(r['.name']),
			components.text(match.join(', ') || _('(all traffic)')),
			components.text(r.use_policy || '-'),
		]);
	});

	return rows;
}

return view.extend({
	load: function() {
		return Promise.all([
			callMwan3Status(),
			uci.load('mwan3'),
		]);
	},

	render: function(data) {
		components.loadStyle();

		var result = data[0] || {};
		var rules  = uci.sections('mwan3', 'rule');

		var ifaceRegion  = E('div', { 'class': 'mwan3-grid' }, renderInterfaces(result.interfaces));
		var policyRegion = E('div', { 'class': 'mwan3-grid' }, renderPolicies(result.policies));

		var rulesTable = new ui.Table(
			[ _('Rule'), _('Match'), _('Policy') ],
			{
				id: 'mwan3-overview-rules',
				sortable: false,
				classes: 'mwan3-rules-table',
				captionClasses: [ 'mwan3-col-rule', 'mwan3-col-match', 'mwan3-col-policy' ],
			},
			components.emptyHint(_('No rules configured'))
		);
		rulesTable.update(renderRuleRows(rules));

		poll.add(function() {
			return callMwan3Status().then(function(result) {
				dom.content(ifaceRegion, renderInterfaces(result.interfaces));
				dom.content(policyRegion, renderPolicies(result.policies));
			});
		}, 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('MultiWAN Manager - Overview')),

			E('div', { 'class': 'cbi-section mwan3-section-gap' }, [
				E('h3', {}, _('Interfaces')),
				ifaceRegion,
			]),

			E('div', { 'class': 'cbi-section mwan3-section-gap' }, [
				E('h3', {}, _('Policies')),
				policyRegion,
			]),

			E('div', { 'class': 'cbi-section mwan3-section-gap' }, [
				E('h3', {}, _('Rules')),
				rulesTable.render(),
			]),
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
