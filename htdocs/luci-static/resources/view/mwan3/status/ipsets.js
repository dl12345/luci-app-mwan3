'use strict';
'require rpc';
'require view';
'require uci';
'require dom';
'require ui';
'require mwan3.components as components';
'require mwan3.format as format';

const callNftsetInfo = rpc.declare({
	object: 'mwan3',
	method: 'nftset_info',
	params: [],
	expect: { sets: {} },
});

const callNftsetElements = rpc.declare({
	object: 'mwan3',
	method: 'nftset_elements',
	params: ['set', 'max'],
	expect: {},
});

const callNftsetFlush = rpc.declare({
	object: 'mwan3',
	method: 'nftset_flush',
	params: ['set'],
	expect: {},
});

const callNftsetReload = rpc.declare({
	object: 'mwan3',
	method: 'nftset_reload',
	params: ['set'],
	expect: {},
});

const callNftsetResolve = rpc.declare({
	object: 'mwan3',
	method: 'nftset_resolve',
	params: ['set'],
	expect: {},
});

/* A button whose click runs an async unit of work with the standard spinner
   and disabled-while-working state. */

function actionBtn(label, workFn) {
	return E('button', {
		'class': 'btn btn-default',
		'type': 'button',
		'click': ui.createHandlerFn(null, workFn),
	}, label);
}

/* One row per set element. The address cell carries a data-value so the column
   sorts as an address; the packet and byte cells pair a numeric raw value with
   an E() display so they sort numerically. */

function buildMemberRows(elems) {
	return elems.map(function(e) {
		var hasCount = (e.packets != null);
		return [
			E('span', { 'class': 'mwan3-mono', 'data-value': e.value }, components.text(e.value)),
			hasCount ? [ Number(e.packets) || 0, components.mono(String(e.packets)) ] : '',
			hasCount ? [ Number(e.bytes) || 0, components.mono(format.fmtBytes(e.bytes)) ] : '',
		];
	});
}

function renderSetPanel(name, meta, uciMeta) {
	const hasCounters = meta.counters === true;

	const entries = Array.isArray(uciMeta.entry) ? uciMeta.entry.length
	              : (uciMeta.entry ? 1 : 0);
	const domainList = Array.isArray(uciMeta.domain) ? uciMeta.domain
	                 : (uciMeta.domain ? [uciMeta.domain] : []);
	const loadfile = uciMeta.loadfile || null;
	const maxelem  = uciMeta.maxelem  || null;
	const timeout  = uciMeta.timeout  || null;

	const metaParts = [];
	if (entries > 0)          metaParts.push(entries + ' static ' + (entries === 1 ? 'entry' : 'entries'));
	if (domainList.length > 0) metaParts.push(domainList.length + ' ' + (domainList.length === 1 ? 'domain' : 'domains'));
	if (loadfile)             metaParts.push('loadfile: ' + loadfile.split('/').pop());
	if (maxelem)              metaParts.push('max: ' + maxelem);
	if (timeout)              metaParts.push('timeout: ' + timeout + 's');

	const countSpan = E('span', { 'class': 'mwan3-ipset-count' },
		meta.count != null ? '(' + meta.count + ')' : '');

	const membersTable = new ui.Table(
		[ _('Address'), _('Packets'), _('Bytes') ],
		{
			id: 'mwan3-ipset-' + name,
			sortable: true,
			classes: 'mwan3-ipset-table',
			captionClasses: [ 'mwan3-col-addr', 'mwan3-col-count', 'mwan3-col-count' ],
		},
		components.emptyHint(_('Set is empty'))
	);

	const membersBody = E('div', {});
	const moreDiv = E('div', {});
	let loaded = false;
	let expanded = false;

	/* Repaint the member table and truncation note from a result. The table's
	   own placeholder covers the empty and error cases. */

	function showMembers(result) {
		if (!result || result.error) {
			membersTable.update([], components.emptyHint(
				_('Failed to load members') + (result && result.error ? ': ' + result.error : '')));
			dom.content(moreDiv, []);
			return;
		}

		const elems = result.elements || [];
		countSpan.textContent = result.truncated ? '(' + elems.length + '+)' : '(' + elems.length + ')';
		membersTable.update(buildMemberRows(elems));

		if (result.truncated)
			dom.content(moreDiv, E('p', { 'class': 'mwan3-ipset-trunc' },
				_('Showing first %d entries. The set may contain more elements.').format(elems.length)));
		else
			dom.content(moreDiv, []);
	}

	/* Fetch a slice of the set and show it, offering the load-more buttons when
	   the slice is truncated. */

	function doLoad(maxEntries) {
		dom.content(membersBody, E('span', { 'class': 'mwan3-ipset-loading' }, _('Loading...')));
		return callNftsetElements(name, maxEntries || 200).then(function(result) {
			showMembers(result);
			if (result && result.truncated)
				dom.append(moreDiv, E('div', { 'class': 'mwan3-ipset-more' }, [
					actionBtn(_('Load more (1000)'), function() { return doLoad(1000); }),
					' ',
					actionBtn(_('Load all (5000)'), function() { return doLoad(5000); }),
				]));
			dom.content(membersBody, [ membersTable.render(), moreDiv ]);
		}).catch(function() {
			showMembers(null);
			dom.content(membersBody, [ membersTable.render(), moreDiv ]);
		});
	}

	/* Refresh the count after an action, repainting the members if the panel is
	   currently expanded. */

	function doRefresh() {
		return callNftsetElements(name, 200).then(function(result) {
			const elems = result ? (result.elements || []) : [];
			countSpan.textContent = (result && result.truncated) ? '(' + elems.length + '+)' : '(' + elems.length + ')';
			if (expanded)
				showMembers(result);
		}).catch(function() {});
	}

	const toggleBtn = actionBtn(_('Expand'), function() {
		if (!loaded) {
			loaded = true;
			expanded = true;
			membersArea.classList.remove('mwan3-hidden');
			toggleBtn.textContent = _('Collapse');
			return doLoad(200);
		}
		expanded = !expanded;
		membersArea.classList.toggle('mwan3-hidden', !expanded);
		toggleBtn.textContent = expanded ? _('Collapse') : _('Expand');
	});

	const flushBtn   = actionBtn(_('Flush'),  function() { return callNftsetFlush(name).then(doRefresh); });
	const reloadBtn  = actionBtn(_('Reload'), function() { return callNftsetReload(name).then(doRefresh); });
	const resolveBtn = domainList.length > 0
		? actionBtn(_('Resolve'), function() { return callNftsetResolve(name).then(doRefresh); })
		: null;

	const headerChildren = [
		E('strong', { 'class': 'mwan3-ipset-name' }, components.text(name)),
		components.familyBadge(meta.type),
	];
	if (hasCounters)
		headerChildren.push(components.badge(_('counters')));
	headerChildren.push(countSpan);
	headerChildren.push(E('span', { 'class': 'mwan3-ipset-actions' },
		[...(resolveBtn ? [resolveBtn] : []), reloadBtn, flushBtn, toggleBtn]));

	const membersChildren = [];
	if (domainList.length > 0) {
		membersChildren.push(E('div', { 'class': 'mwan3-ipset-grouptitle' }, _('Domains')));
		membersChildren.push(E('div', { 'class': 'mwan3-ipset-domains' },
			domainList.map(function(d) { return E('div', {}, components.text(d)); })));
		membersChildren.push(E('div', { 'class': 'mwan3-ipset-grouptitle' }, _('Members')));
	}
	membersChildren.push(membersBody);

	const membersArea = E('div', { 'class': 'mwan3-ipset-members mwan3-hidden' }, membersChildren);

	const panelChildren = [
		E('div', { 'class': 'mwan3-ipset-header' }, headerChildren),
	];
	if (metaParts.length > 0)
		panelChildren.push(E('div', { 'class': 'mwan3-ipset-meta' }, components.text(metaParts.join(' | '))));
	panelChildren.push(membersArea);

	return E('div', { 'class': 'mwan3-ipset-panel' }, panelChildren);
}

return view.extend({
	load: function() {
		return Promise.all([callNftsetInfo(), uci.load('mwan3')]);
	},

	render: function(data) {
		components.loadStyle();

		const info  = data[0] || {};
		const names = Object.keys(info).sort();

		const uciSets = {};
		uci.sections('mwan3', 'ipset').forEach(function(s) {
			if (s.name) uciSets[s.name] = s;
		});

		const panels = names.length > 0
			? names.map(function(n) { return renderSetPanel(n, info[n], uciSets[n] || {}); })
			: [ E('p', {}, _('No user-defined IP sets configured.')) ];

		return E('div', {}, [
			E('h2', {}, _('MultiWAN Manager - IP Sets')),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Flush: flush the nft set of all elements.'), E('br'),
				_('Reload: reload the set with static entries defined in the config and from the loadfile.'), E('br'),
				_('Resolve: flush dnsmasq\'s cache and explicitly resolve every defined domain using dnsmasq to populate the set.'),
			]),
			...panels,
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
