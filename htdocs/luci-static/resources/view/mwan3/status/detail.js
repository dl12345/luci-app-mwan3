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
			trackColor = COLORS.muted;
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

	var header = E('div', { 'style': 'display:flex; align-items:center; gap:0.8em; margin-bottom:0.5em; border:2px solid ' + statusColor + '; border-radius:4px; padding:0.4em 0.7em; font-size:1.1em' }, [
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
				E('th', { 'class': 'th', 'style': 'text-align:right' }, _('Latency')),
				E('th', { 'class': 'th', 'style': 'text-align:right' }, _('Packet Loss')),
			]),
		];

		var statusOrder = { 'up': 0, 'down': 1, 'skipped': 2 };
		trackIps = trackIps.slice().sort(function(a, b) {
			var oa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 3;
			var ob = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 3;
			return oa - ob;
		});

		trackIps.forEach(function(t) {
			var isDisabled = d.status !== 'online' && d.status !== 'offline' && d.status !== 'notracking';
			var statusEl;
			if (isDisabled) {
				statusEl = colorText(_('Disabled'), COLORS.muted);
			} else {
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
			}
			var latencyEl, lossEl;
			if (isDisabled) {
				latencyEl = E('em', { 'style': 'color:' + COLORS.muted }, '-');
				lossEl    = E('em', { 'style': 'color:' + COLORS.muted }, '-');
			} else if (!d.check_quality) {
				latencyEl = E('em', { 'style': 'color:' + COLORS.muted }, _('Not enabled'));
				lossEl    = E('em', { 'style': 'color:' + COLORS.muted }, _('Not enabled'));
			} else if (t.status === 'down') {
				latencyEl = E('span', { 'style': 'color:' + COLORS.muted + '; display:inline-block; transform:scale(1.4)' }, '\u221e');
				lossEl    = E('span', {}, t.packetloss + '%');
			} else if (t.status === 'skipped') {
				latencyEl = E('em', { 'style': 'color:' + COLORS.muted }, '-');
				lossEl    = E('em', { 'style': 'color:' + COLORS.muted }, '-');
			} else {
				latencyEl = E('span', {}, t.latency + ' ms');
				lossEl    = E('span', {}, t.packetloss + '%');
			}
			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, t.ip),
				E('td', { 'class': 'td', 'style': 'text-align:right' }, statusEl),
				E('td', { 'class': 'td', 'style': 'text-align:right' }, latencyEl),
				E('td', { 'class': 'td', 'style': 'text-align:right' }, lossEl),
			]));
		});

		body = E('table', { 'class': 'table cbi-section-table', 'style': 'width:100%; table-layout:fixed' }, [
			E('colgroup', {}, [
				E('col', { 'style': 'width:40%' }),
				E('col', { 'style': 'width:20%' }),
				E('col', { 'style': 'width:20%' }),
				E('col', { 'style': 'width:20%' }),
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
