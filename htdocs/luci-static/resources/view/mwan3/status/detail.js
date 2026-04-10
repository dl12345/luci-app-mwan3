'use strict';
'require view';
'require rpc';
'require poll';

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

function colorText(text, color) {
	return E('span', { 'style': 'color:' + color + '; font-weight:bold' }, text);
}

function renderInterfacePanel(iface, d) {
	var statusText, statusColor;
	switch (d.status) {
		case 'online':
			statusText  = _('Online');
			statusColor = COLORS.success;
			break;
		case 'offline':
			statusText  = _('Offline');
			statusColor = COLORS.danger;
			break;
		case 'notracking':
			statusText  = _('No Tracking');
			statusColor = d.uptime > 0 ? COLORS.success : COLORS.warning;
			break;
		default:
			statusText  = _('Disabled');
			statusColor = COLORS.muted;
	}

	var trackText, trackColor;
	switch (d.tracking) {
		case 'active':
			trackText  = _('Active');
			trackColor = COLORS.success;
			break;
		case 'paused':
			trackText  = _('Paused');
			trackColor = COLORS.warning;
			break;
		case 'down':
			trackText  = _('Down');
			trackColor = COLORS.danger;
			break;
		case 'disabled':
			trackText  = _('Disabled');
			trackColor = COLORS.muted;
			break;
		default:
			trackText  = d.tracking || _('Unknown');
			trackColor = COLORS.muted;
	}

	var header = E('div', { 'style': 'display:flex; align-items:center; gap:0.8em; margin-bottom:0.5em; border:2px solid #999; border-radius:4px; padding:0.4em 0.7em; font-size:1.1em' }, [
		E('strong', { 'style': 'font-size:1.05em' }, iface),
		colorText(statusText, statusColor),
		E('strong', { 'style': 'font-size:1.05em' }, _('Tracking') + ':'),
		colorText(trackText, trackColor),
		E('strong', { 'style': 'font-size:1.05em' }, _('Score') + ':'),
		E('strong', { 'style': 'font-size:1.05em' }, String(d.score || 0)),
	]);

	var trackIps = d.track_ip;
	var body;

	if (!trackIps || !trackIps.length) {
		body = E('em', {}, _('No tracking IPs configured'));
	} else {
		var rows = [
			E('tr', { 'class': 'tr cbi-section-table-titles' }, [
				E('th', { 'class': 'th' }, _('Target IP')),
				E('th', { 'class': 'th', 'style': 'text-align:right' }, _('Status')),
			]),
		];

		trackIps.forEach(function(t) {
			var statusEl;
			switch (t.status) {
				case 'up':
					statusEl = colorText(_('Up'), COLORS.success);
					break;
				case 'down':
					statusEl = colorText(_('Down'), COLORS.danger);
					break;
				case 'skipped':
					statusEl = colorText(_('Ignored'), COLORS.muted);
					break;
				default:
					statusEl = colorText(t.status || _('Unknown'), COLORS.muted);
			}
			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, t.ip),
				E('td', { 'class': 'td', 'style': 'text-align:right' }, statusEl),
			]));
		});

		body = E('table', { 'class': 'table cbi-section-table', 'style': 'width:100%; table-layout:fixed' }, [
			E('colgroup', {}, [
				E('col', { 'style': 'width:70%' }),
				E('col', { 'style': 'width:30%' }),
			]),
			...rows,
		]);
	}

	return E('div', { 'class': 'cbi-section', 'style': 'margin-top:1em' }, [ header, body ]);
}

function renderStatus(interfaces) {
	if (!interfaces)
		return [ E('em', {}, _('No interfaces found')) ];

	return Object.keys(interfaces).map(function(iface) {
		return renderInterfacePanel(iface, interfaces[iface]);
	});
}

function updateLiveStatus(result) {
	var el = document.getElementById('mwan3-detail-status');
	if (!el) return;
	while (el.firstChild) el.removeChild(el.firstChild);
	renderStatus(result.interfaces).forEach(function(section) {
		el.appendChild(section);
	});
}

return view.extend({
	load: function() {
		return callMwan3Status('interfaces');
	},

	render: function(result) {
		result = result || {};

		poll.add(function() {
			return callMwan3Status('interfaces').then(updateLiveStatus);
		});

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'style': 'margin-bottom:1em' }, _('MultiWAN Manager - Status')),
			E('div', { 'id': 'mwan3-detail-status' }, renderStatus(result.interfaces)),
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
