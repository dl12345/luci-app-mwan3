'use strict';
'require fs';
'require view';
'require mwan3.components as components';

function parseSections(text) {
	var sections = [];
	var lines = text.split('\n');
	var i = 0;
	while (i < lines.length) {
		if (i + 1 < lines.length && /^-{10,}/.test(lines[i + 1])) {
			var title = lines[i].trim();
			i += 2;
			var contentStart = i;
			while (i < lines.length) {
				if (i + 1 < lines.length && /^-{10,}/.test(lines[i + 1])) break;
				i++;
			}
			var contentLines = lines.slice(contentStart, i);
			while (contentLines.length && !contentLines[contentLines.length - 1].trim())
				contentLines.pop();
			sections.push({ title: title, content: contentLines.join('\n') });
		} else {
			i++;
		}
	}
	return sections;
}

function filterVmapChains(content) {
	var lines = content.split('\n');
	var out = [];
	var skip = false;
	var count = 0;
	for (var i = 0; i < lines.length; i++) {
		if (/chain mwan3_or_(meta|ct)_/.test(lines[i])) {
			skip = true;
			count++;
		}
		if (!skip) {
			out.push(lines[i]);
		} else if (lines[i].trim() === '}') {
			skip = false;
		}
	}
	if (count > 0) {
		var braceIdx = -1;
		for (var j = 0; j < out.length; j++) {
			if (out[j].trim() === '{') { braceIdx = j; break; }
		}
		if (braceIdx >= 0)
			out.splice(braceIdx + 1, 0, '\t# [' + count + ' vmap-dispatch chains omitted]');
	}
	return out.join('\n');
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.exec_direct('/usr/sbin/mwan3', [ 'internal', 'ipv4' ]), ''),
			L.resolveDefault(fs.exec_direct('/usr/sbin/mwan3', [ 'internal', 'ipv6' ]), ''),
		]);
	},

	render: function(data) {
		components.loadStyle();

		var v4sections = parseSections(data[0]);
		var v6sections = parseSections(data[1]);

		// IPv6 output duplicates Software-Version and the nftables section - drop them
		v6sections = v6sections.filter(function(s) {
			return s.title !== 'Software-Version' && s.title.indexOf('nft') < 0;
		});

		var sections = v4sections.concat(v6sections);

		var panels = sections.map(function(s) {
			var content = s.content;
			if (s.title.indexOf('nft') >= 0)
				content = filterVmapChains(content);

			return E('details', { 'class': 'mwan3-ts' }, [
				E('summary', { 'class': 'mwan3-ts-summary' }, components.text(s.title)),
				E('pre', { 'class': 'mwan3-ts-pre' }, components.text(content)),
			]);
		});

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'class': 'mwan3-title' }, _('MultiWAN Manager - Troubleshooting')),
			E('div', { 'class': 'cbi-section' }, panels),
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
