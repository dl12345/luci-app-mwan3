'use strict';
'require form';
'require view';
'require uci';
'require rpc';
'require ui';
'require mwan3.constants as constants';

var callRcInit = rpc.declare({
	object: 'rc',
	method: 'init',
	params: ['name', 'action'],
	expect: { result: false }
});

function countBits(n) {
	var bits = 0;
	while (n) { bits += n & 1; n >>>= 1; }
	return bits;
}

function interfaceMax(map, section_id) {
	var entry = map.lookupOption('mmx_mask', section_id);
	var str   = entry ? entry[0].formvalue(section_id) : null;
	var mask  = parseInt(str || constants.MMX_MASK_DEFAULT, 16);
	if (isNaN(mask) || mask === 0) mask = parseInt(constants.MMX_MASK_DEFAULT, 16);
	return (1 << countBits(mask)) - 4;
}

function liveInt(map, name, section_id, fallback) {
	var entry = map.lookupOption(name, section_id);
	if (!entry) return fallback;
	var n = parseInt(entry[0].formvalue(section_id), 10);
	return isNaN(n) ? fallback : n;
}

return view.extend({

	render: function () {
		let m, s, o;

		m = new form.Map('mwan3', _('MultiWAN Manager - Globals'));

		s = m.section(form.NamedSection, 'globals', 'globals');

		o = s.option(form.Value, 'mmx_mask', _('Firewall mask'),
			_('Enter value in hex, starting with <code>0x</code>'));
		o.datatype = 'hex(4)';
		o.default = constants.MMX_MASK_DEFAULT;

		o = s.option(form.Value, 'iif_rule_base', _('IIF rule base'),
			_('Base priority for per-interface incoming interface ip rules. Default preserves historical behaviour.'));
		o.datatype = 'range(1, 32766)';
		o.default = String(constants.RULE_BASE_DEFAULTS.iif);
		o.placeholder = String(constants.RULE_BASE_DEFAULTS.iif);
		o.validate = function(section_id, value) {
			if (!value || value.length === 0) return true;
			var iif    = parseInt(value, 10);
			var max    = interfaceMax(this.map, section_id);
			var fwmark = liveInt(this.map, 'fwmark_rule_base', section_id, constants.RULE_BASE_DEFAULTS.fwmark);
			if (iif + max >= fwmark)
				return _('IIF rule base (%d) + %d max interfaces = %d, must be less than Fwmark rule base (%d)').format(iif, max, iif + max, fwmark);
			return true;
		};

		o = s.option(form.Value, 'fwmark_rule_base', _('Fwmark rule base'));
		o.datatype = 'range(1, 32766)';
		o.default = String(constants.RULE_BASE_DEFAULTS.fwmark);
		o.placeholder = String(constants.RULE_BASE_DEFAULTS.fwmark);
		o.render = function(config_name, section_id, in_table) {
			var ifmax = interfaceMax(this.map, section_id);
			this.description = _('Base priority for per-interface fwmark lookup ip rules. Must be at least %d above IIF rule base.').format(ifmax + 1);
			return form.Value.prototype.render.apply(this, arguments);
		};
		o.validate = function(section_id, value) {
			if (!value || value.length === 0) return true;
			var fwmark  = parseInt(value, 10);
			var max     = interfaceMax(this.map, section_id);
			var iif     = liveInt(this.map, 'iif_rule_base', section_id, constants.RULE_BASE_DEFAULTS.iif);
			var unreach = liveInt(this.map, 'unreachable_rule_base', section_id, constants.RULE_BASE_DEFAULTS.unreachable);
			if (iif + max >= fwmark)
				return _('Fwmark rule base (%d) must exceed IIF rule base (%d) + %d max interfaces = %d').format(fwmark, iif, max, iif + max);
			if (fwmark + max + 1 >= unreach)
				return _('Fwmark rule base (%d) + %d max interfaces + 1 = %d, must be less than Unreachable rule base (%d)').format(fwmark, max, fwmark + max + 1, unreach);
			return true;
		};

		o = s.option(form.Value, 'unreachable_rule_base', _('Unreachable rule base'));
		o.datatype = 'range(1, 32766)';
		o.default = String(constants.RULE_BASE_DEFAULTS.unreachable);
		o.placeholder = String(constants.RULE_BASE_DEFAULTS.unreachable);
		o.render = function(config_name, section_id, in_table) {
			var ifmax = interfaceMax(this.map, section_id);
			this.description = _('Base priority for per-interface fwmark unreachable ip rules. Must be at least %d above Fwmark rule base.').format(ifmax + 2);
			return form.Value.prototype.render.apply(this, arguments);
		};
		o.validate = function(section_id, value) {
			if (!value || value.length === 0) return true;
			var unreach = parseInt(value, 10);
			var max     = interfaceMax(this.map, section_id);
			var fwmark  = liveInt(this.map, 'fwmark_rule_base', section_id, constants.RULE_BASE_DEFAULTS.fwmark);
			if (fwmark + max + 1 >= unreach)
				return _('Unreachable rule base (%d) must exceed Fwmark rule base (%d) + %d max interfaces + 1 = %d').format(unreach, fwmark, max, fwmark + max + 1);
			return true;
		};

		o = s.option(form.Flag, 'logging', _('Logging'),
			_('Enables global firewall logging'));

		o = s.option(form.Flag, 'verbose_logging', _('Verbose logging'),
			_('Enables debug level logging for mwan3'));

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

		return m.render();
	},

	handleSaveApply: function(ev, mode) {
		var oldIif    = uci.get('mwan3', 'globals', 'iif_rule_base');
		var oldFwmark = uci.get('mwan3', 'globals', 'fwmark_rule_base');
		var oldUnreach = uci.get('mwan3', 'globals', 'unreachable_rule_base');

		return this.handleSave(ev).then(L.bind(function() {
			var newIif    = uci.get('mwan3', 'globals', 'iif_rule_base');
			var newFwmark = uci.get('mwan3', 'globals', 'fwmark_rule_base');
			var newUnreach = uci.get('mwan3', 'globals', 'unreachable_rule_base');

			if (newIif !== oldIif || newFwmark !== oldFwmark || newUnreach !== oldUnreach) {
				var Fn = function() {
					callRcInit('mwan3', 'restart');
					document.removeEventListener('uci-applied', Fn);
				};
				document.addEventListener('uci-applied', Fn);
			}

			return ui.changes.apply(mode);
		}, this));
	},
})
