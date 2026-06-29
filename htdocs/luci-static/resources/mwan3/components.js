'use strict';
'require baseclass';

/* Custom render helpers: stateless functions that take data and return E()
   nodes for the status and analysis views. The matching styles live in
   view/mwan3/mwan3.css. */

/* ---- Severity to CSS class maps ---- */

var CARD_CLASS = {
	success: 'mwan3-card--ok',
	warning: 'mwan3-card--warn',
	danger:  'mwan3-card--bad',
	muted:   'mwan3-card--muted',
	info:    'mwan3-card--info',
};

var TEXT_CLASS = {
	success: 'mwan3-ok',
	warning: 'mwan3-warn',
	danger:  'mwan3-bad',
	muted:   'mwan3-muted',
	info:    'mwan3-info',
};

function cardClass(severity) {
	return CARD_CLASS[severity] || CARD_CLASS.muted;
}

function textClass(severity) {
	return TEXT_CLASS[severity] || TEXT_CLASS.muted;
}

/* ---- Stylesheet loader ---- */

/* Append the mwan3 stylesheet to the document head once. Safe to call from
   every view's render(). */

function loadStyle() {
	var href = L.resource('view/mwan3/mwan3.css');
	var head = document.querySelector('head');
	if (head.querySelector('link[href="' + href + '"]'))
		return;
	head.appendChild(E('link', {
		'rel': 'stylesheet',
		'type': 'text/css',
		'href': href
	}));
}

/* ---- Status cards and bars ---- */

/* A bordered, severity-coloured status card. extraClass adds further classes
   for per-view padding or text colour. */

function card(severity, children, extraClass) {
	var cls = 'mwan3-card';
	if (severity)
		cls += ' ' + cardClass(severity);
	if (extraClass)
		cls += ' ' + extraClass;
	return E('div', { 'class': cls }, children);
}

/* A full-width summary banner whose border and text take the severity colour. */

function summaryBar(severity, text) {
	return E('div', {
		'class': 'mwan3-summary ' + cardClass(severity) + ' ' + textClass(severity)
	}, text);
}

/* ---- Inline primitives ---- */

/* Severity-coloured inline text, optionally bold. */

function statusText(text, severity, bold) {
	var cls = textClass(severity);
	if (bold)
		cls += ' mwan3-strong';
	return E('span', { 'class': cls }, text);
}

function badge(text) {
	return E('span', { 'class': 'mwan3-badge' }, text);
}

function familyBadge(setType) {
	return badge(setType === 'ipv6_addr' ? 'IPv6' : 'IPv4');
}

function mono(text) {
	return E('span', { 'class': 'mwan3-mono' }, text);
}

function emptyHint(text) {
	return E('em', {}, text);
}

/* ---- Presence badge ---- */

/* expectation: true means the item is expected present (present is good,
   absent is bad); false means expected absent (present is a warning); null
   means report presence without judgement. */

function presenceBadge(present, expectation) {
	if (expectation === true)
		return present ? statusText(_('Present'), 'success', true)
		               : statusText(_('Missing'), 'danger', true);
	if (expectation === false)
		return present ? statusText(_('Present (unexpected)'), 'warning', true)
		               : statusText(_('Absent'), 'muted', true);
	return present ? statusText(_('Present'), 'muted', true)
	               : statusText(_('Absent'), 'muted', true);
}

/* ---- Tracked interface status ---- */

/* Map a tracked interface's status to a display label, a severity colour, and
   its duration as raw seconds plus the duration's label. Callers format the
   duration themselves; duration is null when there is nothing to show. */

function statusInfo(d) {
	switch (d.status) {
		case 'online':
			return { label: _('Online'), severity: 'success',
			         duration: d.online, durationLabel: _('Online') };
		case 'offline':
			return { label: _('Offline'), severity: 'danger',
			         duration: d.offline, durationLabel: _('Offline') };
		case 'notracking':
			return { label: _('No Tracking'),
			         severity: d.uptime > 0 ? 'success' : 'warning',
			         duration: d.uptime > 0 ? d.uptime : null,
			         durationLabel: _('Uptime') };
		default:
			return { label: _('Disabled'), severity: 'muted',
			         duration: null, durationLabel: null };
	}
}

/* ---- Key/value block ---- */

/* A two-column table of label/value rows: label left, value right-aligned. */

function kvRow(label, value) {
	return E('tr', { 'class': 'mwan3-kv-row' }, [
		E('td', { 'class': 'mwan3-kv-label' }, label),
		E('td', { 'class': 'mwan3-kv-value' }, value),
	]);
}

function kvBlock(pairs) {
	return E('table', { 'class': 'mwan3-kv' },
		pairs.map(function(p) { return kvRow(p[0], p[1]); }));
}

return baseclass.extend({
	loadStyle: loadStyle,
	textClass: textClass,
	card: card,
	summaryBar: summaryBar,
	statusText: statusText,
	statusInfo: statusInfo,
	badge: badge,
	familyBadge: familyBadge,
	mono: mono,
	emptyHint: emptyHint,
	presenceBadge: presenceBadge,
	kvRow: kvRow,
	kvBlock: kvBlock,
});
