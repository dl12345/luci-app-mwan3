'use strict';
'require baseclass';
'require rpc';

const callMwan3Status = rpc.declare({
	object: 'mwan3',
	method: 'status',
	params: ['section'],
	expect: {  },
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

		var container = E('div', { 'style': 'display:flex; flex-wrap:wrap; gap:0.5em' });

		for (var iface in result[0].interfaces) {
			var d = result[0].interfaces[iface];
			var state, color, time, tname;

			switch (d.status) {
				case 'online':
					state  = _('Online');
					color  = COLORS.success;
					time   = '%t'.format(d.online);
					tname  = _('Online');
					break;
				case 'offline':
					state  = _('Offline');
					color  = COLORS.danger;
					time   = '%t'.format(d.offline);
					tname  = _('Offline');
					break;
				case 'notracking':
					state  = _('No Tracking');
					color  = d.uptime > 0 ? COLORS.success : COLORS.warning;
					time   = d.uptime > 0 ? '%t'.format(d.uptime) : null;
					tname  = _('Uptime');
					break;
				default:
					state  = _('Disabled');
					color  = COLORS.muted;
					time   = null;
					tname  = null;
			}

			var children = [
				E('div', {}, [ E('strong', {}, _('Interface') + ':\u00a0'), iface ]),
				E('div', {}, [ E('strong', {}, _('Status') + ':\u00a0'), E('span', { 'style': 'color:' + color }, state) ]),
			];

			if (time)
				children.push(E('div', {}, [ E('strong', {}, tname + ':\u00a0'), time ]));

			container.appendChild(E('div', {
				'style': 'flex:1 1 auto; border:2px solid ' + color + '; border-radius:4px; padding:0.5em 0.8em',
			}, children));
		}

		return container;
	}
});
