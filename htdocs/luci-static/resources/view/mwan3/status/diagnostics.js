'use strict';
'require fs';
'require uci';
'require dom';
'require ui';
'require view';

return view.extend({
	handleCommand: function(exec, args) {
		var self = this;

		return fs.exec(exec, args).then(function(res) {
			self.outputEl.style.display = '';

			dom.content(self.outputEl, [ res.stdout || '', res.stderr || '' ]);
		}).catch(function(err) {
			ui.addNotification(null, E('p', [ err ]));
		});
	},

	handleAction: function(ev) {
		var iface = this.ifaceSel.getValue();
		var task = this.taskSel.getValue();

		switch (task) {
			case 'gateway':
				return this.handleCommand('/usr/libexec/luci-mwan3',
					[ 'diag', 'gateway', iface ]);
			case 'tracking':
				return this.handleCommand('/usr/libexec/luci-mwan3',
					[ 'diag', 'tracking', iface ]);
			case 'rules':
				return this.handleCommand('/usr/libexec/luci-mwan3',
					[ 'diag', 'rules', iface ]);
			case 'routes':
				return this.handleCommand('/usr/libexec/luci-mwan3',
					[ 'diag', 'routes', iface ]);
			case 'ifup':
				return this.handleCommand('/usr/sbin/mwan3',
					[ 'ifup', iface ]);
			case 'ifdown':
				return this.handleCommand('/usr/sbin/mwan3',
					[ 'ifdown', iface ]);
		}
	},

	load: function() {
		return Promise.all([
			uci.load('mwan3')
		]);
	},

	render: function () {
		var ifaceChoices = { '': _('-- Interface Selection --') };
		uci.sections('mwan3', 'interface').forEach(function(s) {
			ifaceChoices[s['.name']] = s['.name'];
		});
		this.ifaceSel = new ui.Select('', ifaceChoices, { widget: 'select' });

		this.taskSel = new ui.Select('gateway', {
			gateway:  _('Ping default gateway'),
			tracking: _('Ping tracking IP'),
			rules:    _('Check IP rules'),
			routes:   _('Check routing table'),
			ifup:     _('Hotplug ifup'),
			ifdown:   _('Hotplug ifdown')
		}, { widget: 'select' });

		this.outputEl = E('pre', { 'class': 'command-output', 'style': 'display:none' });

		return E('div', { 'class': 'cbi-map', 'id': 'map' }, [
				E('h2', {}, [ _('MultiWAN Manager - Diagnostics') ]),
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'class': 'cbi-section-node' }, [
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, [ _('Interface') ]),
							E('div', { 'class': 'cbi-value-field' }, [ this.ifaceSel.render() ])
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, [ _('Task') ]),
							E('div', { 'class': 'cbi-value-field' }, [ this.taskSel.render() ])
						])
					])
				]),
				'\xa0',
				this.outputEl,
				'\xa0',
				E('div', { 'class': 'right' }, [
					E('button', {
						'class': 'cbi-button cbi-button-apply',
						'id': 'execute',
						'click': ui.createHandlerFn(this, 'handleAction')
					}, [ _('Execute') ]),
				]),
			]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
})
