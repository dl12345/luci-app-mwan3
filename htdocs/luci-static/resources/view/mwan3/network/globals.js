'use strict';
'require form';
'require view';

/* Suppress keyup validation for a DynamicList option, keeping blur-only
 * validation. Uses capture-phase event delegation on the container so that
 * dynamically added item inputs are covered without needing a MutationObserver. */
function makeBlurOnly(opt) {
	opt.render = function(config_name, section_id, in_table) {
		return Promise.resolve(form.DynamicList.prototype.render.apply(this, arguments)).then(function(node) {
			node.addEventListener('keyup', function(ev) {
				if (ev.target.tagName === 'INPUT')
					ev.stopImmediatePropagation();
			}, true);
			return node;
		});
	};
}

return view.extend({

	render: function () {
		let m, s, o;

		m = new form.Map('mwan3', _('MultiWAN Manager - Globals'));

		s = m.section(form.NamedSection, 'globals', 'globals');

		o = s.option(form.Value, 'mmx_mask', _('Firewall mask'),
			_('Enter value in hex, starting with <code>0x</code>'));
		o.datatype = 'hex(4)';
		o.default = '0x3F00';

		o = s.option(form.Flag, 'logging', _('Logging'),
			_('Enables global firewall logging'));

		o = s.option(form.ListValue, 'loglevel', _('Loglevel'),
			_('Firewall loglevel'));
		o.default = 'notice';
		o.value('emerg', _('Emergency'));
		o.value('alert', _('Alert'));
		o.value('crit', _('Critical'));
		o.value('error', _('Error'));
		o.value('warning', _('Warning'));
		o.value('notice', _('Notice'));
		o.value('info', _('Info'));
		o.value('debug', _('Debug'));
		o.depends('logging', '1');

		o = s.option(form.DynamicList, 'rt_table_lookup',
			_('Routing table bypass'),
			_('Networks from these routing tables bypass mwan3 policy routing and use the default route. Enter routing table number or name (see /etc/iproute2/rt_tables).'));
		o.value('220', _('Routing table 220'));

		o = s.option(form.DynamicList, 'bypass_network',
			_('Bypass networks'),
			_('Traffic to these networks bypasses mwan3 policy routing and uses the default route. Enter IPv4 or IPv6 CIDR.'));
		o.datatype = 'cidr';
		makeBlurOnly(o);

		return m.render();
	}
})
