'use strict';
'require rpc';
'require view';
'require uci';

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

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet',
	'type': 'text/css',
	'href': L.resource('view/mwan3/mwan3.css')
}));

function fmtBytes(n) {
	if (n == null || n < 0) return '-';
	if (n < 1024)        return n + ' B';
	if (n < 1048576)     return (n / 1024).toFixed(1) + ' KiB';
	if (n < 1073741824)  return (n / 1048576).toFixed(1) + ' MiB';
	return (n / 1073741824).toFixed(2) + ' GiB';
}

function makeBtn(label, clickFn) {
	return E('button', {
		'class': 'btn btn-default',
		'type': 'button',
		'click': clickFn,
	}, label);
}

function renderMembers(result, countSpan, container) {
	while (container.firstChild)
		container.removeChild(container.firstChild);

	if (!result || result.error) {
		container.appendChild(E('em', {},
			_('Failed to load members') + (result && result.error ? ': ' + result.error : '')));
		return;
	}

	const elems = result.elements || [];

	if (elems.length === 0) {
		countSpan.textContent = '(0)';
		container.appendChild(E('em', {}, _('Set is empty')));
		return;
	}

	const n = elems.length;
	countSpan.textContent = result.truncated ? '(' + n + '+)' : '(' + n + ')';

	const tbl = E('table', { 'class': 'table' });
	tbl.appendChild(E('thead', {}, E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th', style: 'width:50%' }, _('Address')),
		E('th', { 'class': 'th', style: 'width:25%; text-align:right' }, _('Packets')),
		E('th', { 'class': 'th', style: 'width:25%; text-align:right' }, _('Bytes')),
	])));
	const tbody = E('tbody', {});
	for (let i = 0; i < elems.length; i++) {
		const e = elems[i];
		tbody.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', style: 'width:50%; font-family:monospace' }, e.value),
			E('td', { 'class': 'td', style: 'width:25%; text-align:right; font-family:monospace' },
				e.packets != null ? String(e.packets) : ''),
			E('td', { 'class': 'td', style: 'width:25%; text-align:right; font-family:monospace' },
				e.packets != null ? fmtBytes(e.bytes) : ''),
		]));
	}
	tbl.appendChild(tbody);
	container.appendChild(tbl);

	if (result.truncated) {
		container.appendChild(E('p', { style: 'opacity:0.7; margin:6px 0 0' },
			_('Showing first %d entries. The set may contain more elements.').format(n)));
	}
}

function renderSetPanel(name, meta, uciMeta) {
	const hasCounters = meta.counters === true;
	const family = (meta.type === 'ipv6_addr') ? 'IPv6' : 'IPv4';

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

	const countSpan  = E('span', { style: 'opacity:0.6; margin-left:0.3em' },
		meta.count != null ? '(' + meta.count + ')' : '');
	const membersArea = E('div', { style: 'margin-top:0.6em; display:none' });
	const nftDiv     = E('div', {});
	let loaded = false;
	let expanded = false;

	function doLoad(maxEntries) {
		while (nftDiv.firstChild) nftDiv.removeChild(nftDiv.firstChild);
		nftDiv.appendChild(E('span', { style: 'opacity:0.6' }, _('Loading...')));
		callNftsetElements(name, maxEntries || 200).then(function(result) {
			renderMembers(result, countSpan, nftDiv);
			if (!result || !result.truncated) return;
			nftDiv.appendChild(E('div', { style: 'margin-top:6px' }, [
				makeBtn(_('Load more (1000)'), function() { doLoad(1000); }),
				' ',
				makeBtn(_('Load all (5000)'), function() { doLoad(5000); }),
			]));
		}).catch(function() {
			renderMembers(null, countSpan, nftDiv);
		});
	}

	function doRefresh() {
		callNftsetElements(name, 200).then(function(result) {
			const elems = result ? (result.elements || []) : [];
			const n = elems.length;
			countSpan.textContent = (result && result.truncated) ? '(' + n + '+)' : '(' + n + ')';
			if (expanded)
				renderMembers(result, countSpan, nftDiv);
		}).catch(function() {});
	}

	function makeActionBtn(label, fn) {
		const btn = E('button', {
			'class': 'btn btn-default',
			'type': 'button',
			'click': function() {
				btn.disabled = true;
				fn().then(function() {
					doRefresh();
					btn.disabled = false;
				}).catch(function() {
					btn.disabled = false;
				});
			},
		}, label);
		return btn;
	}

	const toggleBtn = makeBtn(_('Expand'), function() {
		if (!loaded) {
			loaded = true;
			expanded = true;

			if (domainList.length > 0) {
				membersArea.appendChild(
					E('div', { style: 'font-weight:bold; opacity:0.7; margin-bottom:0.2em' },
						_('Domains')));
				const dl = E('div', { style: 'font-family:monospace; margin-bottom:0.6em' });
				for (let i = 0; i < domainList.length; i++)
					dl.appendChild(E('div', {}, domainList[i]));
				membersArea.appendChild(dl);
			}

			if (domainList.length > 0)
				membersArea.appendChild(
					E('div', { style: 'font-weight:bold; opacity:0.7; margin-bottom:0.2em' },
						_('Members')));
			membersArea.appendChild(nftDiv);

			membersArea.style.display = '';
			toggleBtn.textContent = _('Collapse');
			doLoad(200);
		} else {
			expanded = !expanded;
			membersArea.style.display = expanded ? '' : 'none';
			toggleBtn.textContent = expanded ? _('Collapse') : _('Expand');
		}
	});

	const flushBtn   = makeActionBtn(_('Flush'),   function() { return callNftsetFlush(name); });
	const reloadBtn  = makeActionBtn(_('Reload'),  function() { return callNftsetReload(name); });
	const resolveBtn = domainList.length > 0
		? makeActionBtn(_('Resolve'), function() { return callNftsetResolve(name); })
		: null;

	const badgeStyle = 'padding:1px 5px; border:1px solid currentColor; border-radius:3px; opacity:0.8';

	const headerChildren = [
		E('strong', { style: 'font-size:1.05em' }, name),
		E('span', { style: badgeStyle }, family),
	];
	if (hasCounters)
		headerChildren.push(E('span', { style: badgeStyle }, _('counters')));
	headerChildren.push(countSpan);
	headerChildren.push(E('span', { style: 'display:flex; gap:0.3em; margin-left:auto; align-items:center' },
		[...(resolveBtn ? [resolveBtn] : []), reloadBtn, flushBtn, toggleBtn]));

	const panelChildren = [
		E('div', { style: 'display:flex; align-items:baseline; flex-wrap:wrap; gap:0.5em; margin-bottom:0.3em' },
			headerChildren),
	];
	if (metaParts.length > 0)
		panelChildren.push(E('div', { style: 'opacity:0.6; margin-bottom:0.2em' },
			metaParts.join(' | ')));
	panelChildren.push(membersArea);

	return E('div', {
		style: 'margin-bottom:1em; padding:0.6em 1em; border:1px solid rgba(128,128,128,0.4); border-radius:4px',
	}, panelChildren);
}

return view.extend({
	load: function() {
		return Promise.all([callNftsetInfo(), uci.load('mwan3')]);
	},

	render: function(data) {
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
