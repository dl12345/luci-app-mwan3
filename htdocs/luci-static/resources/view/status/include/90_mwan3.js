'use strict';
'require baseclass';
'require rpc';
'require mwan3.components as components';

const callMwan3Status = rpc.declare({
	object: 'mwan3',
	method: 'status',
	params: ['section'],
	expect: {  },
});

return baseclass.extend({
	title: _('MultiWAN Manager'),

	load: function() {
		return Promise.all([
			callMwan3Status("interfaces"),
		]);
	},

	render: function (result) {
		if (!result[0].interfaces)
			return null;

		components.loadStyle();

		var container = E('div', { 'class': 'mwan3-flexwrap' });

		for (var iface in result[0].interfaces) {
			var d = result[0].interfaces[iface];
			var si = components.statusInfo(d);

			var children = [
				E('div', {}, [ E('strong', {}, _('Interface') + ':\u00a0'), iface ]),
				E('div', {}, [ E('strong', {}, _('Status') + ':\u00a0'), components.statusText(si.label, si.severity) ]),
			];

			if (si.duration != null)
				children.push(E('div', {}, [ E('strong', {}, si.durationLabel + ':\u00a0'), '%t'.format(si.duration) ]));

			container.appendChild(components.card(si.severity, children, 'mwan3-card--sm mwan3-card--grow'));
		}

		return container;
	}
});
