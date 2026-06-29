'use strict';
'require form';
'require view';
'require uci';
'require ui';
'require validation';
'require rpc';
'require mwan3.validators as validators';
'require mwan3.constants as constants';

const callNftsetInfo = rpc.declare({
	object: 'mwan3',
	method: 'nftset_info',
	expect: { sets: {} }
});

const stubValidator = validators.stub();

return view.extend({
	load: function() {
		return Promise.all([
			callNftsetInfo(),
			uci.load('mwan3')
		]);
	},

	render: function (data) {
		let m, s, o;

		m = new form.Map('mwan3', _('MultiWAN Manager - Rules'),
			_('Rules specify which traffic will use a particular MWAN policy.') + '<br />' +
			_('Rules are based on IP address, port or protocol.') + '<br />' +
			_('Rules are matched from top to bottom.') + '<br />' +
			_('Rules below a matching rule are ignored.') + '<br />' +
			_('Traffic not matching any rule is routed using the main routing table.') + '<br />' +
			_('Traffic destined for known (other than default) networks is handled by the main routing table.') + '<br />' +
			_('Traffic matching a rule, but all WAN interfaces for that policy are down will be blackholed.') + '<br />' +
			_('Names may contain characters A-Z, a-z, 0-9, _ and no spaces.') + '<br />' +
			_('Rules may not share the same name as configured interfaces, members or policies.') + '<br />' +
			_('The Enable checkbox is greyed if the rule references a currently disabled IP set.'));

		s = m.section(form.GridSection, 'rule');
		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;
		s.sortable  = true;

		/* This name length error check can likely be removed when mwan3 migrates to nftables */
		s.renderSectionAdd = function(extra_class) {
			const el = form.GridSection.prototype.renderSectionAdd.apply(this, arguments);
			const nameEl = el.querySelector('.cbi-section-create-name');
			ui.addValidator(nameEl, 'uciname', true, function(v) {
				if (validators.sectionNameInUse(v))
					return _('Rules may not share the same name as configured interfaces, members or policies.');
				if (v.length > 15) return _('Name length shall not exceed 15 characters');
				return true;
			}, 'blur', 'keyup');
			return el;
		};

		o = s.option(form.ListValue, 'family', _('Internet Protocol'));
		o.default = '';
		o.value('', _('IPv4 and IPv6'));
		o.value('ipv4', _('IPv4 only'));
		o.value('ipv6', _('IPv6 only'));
		o.modalonly = true;

		o = s.option(form.Value, 'proto', _('Protocol'),
			_('View the content of /etc/protocols for protocol description'));
		o.default = 'all';
		o.rmempty = false;
		o.value('all');
		o.value('tcp');
		o.value('udp');
		o.value('icmp');
		o.value('esp');

		o = s.option(form.Value, 'src_ip', _('Source'),
			_('Supports CIDR notation (eg "192.168.100.0/24") and comma-separated addresses (eg "8.8.8.8,8.8.4.4") without quotes'));
		o.textvalue = function(section_id) {
			const ip = this.cfgvalue(section_id);
			const set = uci.get('mwan3', section_id, 'ipset_src');
			const port = uci.get('mwan3', section_id, 'src_port');
			const addr = (ip && ip.length > 0) ? ip : (set && set.length > 0) ? set : null;
			if (addr && port && port.length > 0) return addr + ':' + port;
			if (addr) return addr;
			if (port && port.length > 0) return '*:' + port;
			return '-';
		};
		o.validate = function(section_id, value) {
			if (!value || value.length === 0)
				return true;
			const family = this.map.lookupOption('family', section_id)[0].formvalue(section_id);
			const addrs = value.split(',').map(function(s) { return s.trim(); });
			for (var i = 0; i < addrs.length; i++) {
				if (!addrs[i].length)
					return _('Empty address in comma-separated list');
				if (!stubValidator.apply('ipaddr', addrs[i]))
					return _('Invalid IP address or prefix: ') + addrs[i];
				var is_v6 = !!validation.parseIPv6(addrs[i].split('/')[0]);
				if (family === 'ipv4' && is_v6)
					return _('Source address must be IPv4 when family is set to IPv4 only');
				if (family === 'ipv6' && !is_v6)
					return _('Source address must be IPv6 when family is set to IPv6 only');
			}
			return true;
		};

		o = s.option(form.Value, 'src_port', _('Source port'),
			_('May be entered as a single or multiple port(s) (eg "22" or "80,443") or as a portrange (eg "1024-2048") without quotes'));
		o.depends('proto', 'tcp');
		o.depends('proto', 'udp');
		o.modalonly = true;

		o = s.option(form.Value, 'dest_ip', _('Destination'),
			_('Supports CIDR notation (eg "192.168.100.0/24") and comma-separated addresses (eg "8.8.8.8,8.8.4.4") without quotes'));
		o.textvalue = function(section_id) {
			const ip = this.cfgvalue(section_id);
			const set = uci.get('mwan3', section_id, 'ipset');
			const port = uci.get('mwan3', section_id, 'dest_port');
			const fwmark = uci.get('mwan3', section_id, 'fwmark');
			const fwmask = uci.get('mwan3', section_id, 'fwmask');
			const addr = (ip && ip.length > 0) ? ip : (set && set.length > 0) ? set : null;
			const parts = [];
			if (addr && port && port.length > 0) parts.push(addr + ':' + port);
			else if (addr) parts.push(addr);
			else if (port && port.length > 0) parts.push('*:' + port);
			if (fwmark && fwmask) parts.push('mark:' + fwmark + '/' + fwmask);
			return parts.length > 0 ? parts.join(' ') : '-';
		};
		o.validate = function(section_id, value) {
			if (!value || value.length === 0)
				return true;
			const family = this.map.lookupOption('family', section_id)[0].formvalue(section_id);
			const addrs = value.split(',').map(function(s) { return s.trim(); });
			for (var i = 0; i < addrs.length; i++) {
				if (!addrs[i].length)
					return _('Empty address in comma-separated list');
				if (!stubValidator.apply('ipaddr', addrs[i]))
					return _('Invalid IP address or prefix: ') + addrs[i];
				var is_v6 = !!validation.parseIPv6(addrs[i].split('/')[0]);
				if (family === 'ipv4' && is_v6)
					return _('Destination address must be IPv4 when family is set to IPv4 only');
				if (family === 'ipv6' && !is_v6)
					return _('Destination address must be IPv6 when family is set to IPv6 only');
			}
			return true;
		};

		o = s.option(form.Value, 'fwmark', _('Fwmark'),
			_('Match packet mark; enter value/mask in hex. Mask must not overlap mwan3 internal mark bits.'));
		o.modalonly = true;
		o.placeholder = '0x80000/0xff0000';
		o.cfgvalue = function(section_id) {
			const mark = uci.get('mwan3', section_id, 'fwmark');
			const mask = uci.get('mwan3', section_id, 'fwmask');
			if (mark && mask) return mark + '/' + mask;
			if (mark) return mark;
			return null;
		};
		o.write = function(section_id, value) {
			if (!value || value.length === 0) {
				uci.unset('mwan3', section_id, 'fwmark');
				uci.unset('mwan3', section_id, 'fwmask');
				return;
			}
			const parts = value.split('/');
			uci.set('mwan3', section_id, 'fwmark', parts[0]);
			uci.set('mwan3', section_id, 'fwmask', parts[1]);
		};
		o.remove = function(section_id) {
			uci.unset('mwan3', section_id, 'fwmark');
			uci.unset('mwan3', section_id, 'fwmask');
		};
		o.validate = function(section_id, value) {
			if (!value || value.length === 0) return true;
			const hexre = /^0x[0-9a-fA-F]+$/;
			const parts = value.split('/');
			if (parts.length !== 2 || !hexre.test(parts[0]) || !hexre.test(parts[1]))
				return _('Format must be value/mask in hex notation (e.g. 0x80000/0xff0000)');
			const mmx_mask = parseInt(uci.get('mwan3', 'globals', 'mmx_mask') || constants.MMX_MASK_DEFAULT, 16);
			if ((parseInt(parts[1], 16) & mmx_mask) !== 0)
				return _('Mask overlaps mwan3 internal mark bits (0x' + mmx_mask.toString(16) + ')');
			return true;
		};

		o = s.option(form.Value, 'dest_port', _('Destination port'),
			_('May be entered as a single or multiple port(s) (eg "22" or "80,443") or as a portrange (eg "1024-2048") without quotes'));
		o.depends('proto', 'tcp');
		o.depends('proto', 'udp');
		o.modalonly = true;

		o = s.option(form.ListValue, 'sticky', _('Sticky'),
			_('Traffic from the same source IP address that previously matched this rule within the sticky timeout period will use the same WAN interface'));
		o.default = '0';
		o.value('1', _('Yes'));
		o.value('0', _('No'));
		o.modalonly = true;

		o = s.option(form.Value, 'timeout', _('Sticky timeout'),
			_('Seconds. Acceptable values: 1-1000000. Defaults to 600 if not set'));
		o.datatype = 'range(1, 1000000)';
		o.modalonly = true;
		o.depends('sticky', '1');

		const nftset_info = data[0];
		const family_label = { 'ipv4_addr': ' (IPv4)', 'ipv6_addr': ' (IPv6)' };

		function ip_family(ip) {
			if (!ip || ip.length === 0) return null;
			var first = ip.split(',')[0].trim().split('/')[0];
			return validation.parseIPv6(first) ? 'ipv6' : 'ipv4';
		}

		function nftset_validate(section_id, value) {
			if (!value || value.length === 0)
				return true;
			const family = this.map.lookupOption('family', section_id)[0].formvalue(section_id);
			if (!family)
				return true;
			const set_type = nftset_info[value]?.type;
			if (family === 'ipv4' && set_type === 'ipv6_addr')
				return _('Selected NFT set is IPv6 but family is set to IPv4 only');
			if (family === 'ipv6' && set_type === 'ipv4_addr')
				return _('Selected NFT set is IPv4 but family is set to IPv6 only');
			return true;
		}

		function isConfigDisabled(name) {
			const match = uci.sections('mwan3', 'ipset').find(s => s.name === name);
			return match ? match.enabled === '0' : false;
		}

		o = s.option(form.Value, 'ipset_src', _('Source NFT set'),
			_('Match source addresses against this nft set'));
		o.value('', _('-- Please choose --'));
		for (let s_name in nftset_info) {
			if (isConfigDisabled(s_name)) continue;
			const label = s_name + (family_label[nftset_info[s_name].type] || '');
			o.value(s_name, label);
		}
		o.validate = function(section_id, value) {
			if (!value || value.length === 0)
				return true;
			const src_ip = this.map.lookupOption('src_ip', section_id)[0].formvalue(section_id);
			if (src_ip && src_ip.length > 0)
				return _('Source NFT set and source address both match source - use one or the other');
			const set_type = nftset_info[value]?.type;
			const dest_ip = this.map.lookupOption('dest_ip', section_id)[0].formvalue(section_id);
			const dest_fam = ip_family(dest_ip);
			if (dest_fam === 'ipv4' && set_type === 'ipv6_addr')
				return _('Source NFT set is IPv6 but destination address is IPv4');
			if (dest_fam === 'ipv6' && set_type === 'ipv4_addr')
				return _('Source NFT set is IPv4 but destination address is IPv6');
			const ipset = this.map.lookupOption('ipset', section_id)[0].formvalue(section_id);
			const ipset_type = nftset_info[ipset]?.type;
			if (set_type && ipset_type && set_type !== ipset_type)
				return _('Source and destination NFT sets have different address families');
			return nftset_validate.call(this, section_id, value);
		};
		o.modalonly = true;

		o = s.option(form.Value, 'ipset', _('Destination NFT set'),
			_('Match destination addresses against this nft set (declare sets in /etc/config/mwan3; dnsmasq syntax: nftset=/youtube.com/4#inet#mwan3#youtube)'));
		o.value('', _('-- Please choose --'));
		for (let s_name in nftset_info) {
			if (isConfigDisabled(s_name)) continue;
			const label = s_name + (family_label[nftset_info[s_name].type] || '');
			o.value(s_name, label);
		}
		o.validate = function(section_id, value) {
			if (!value || value.length === 0)
				return true;
			const dest_ip = this.map.lookupOption('dest_ip', section_id)[0].formvalue(section_id);
			if (dest_ip && dest_ip.length > 0)
				return _('Destination NFT set and destination address both match destination - use one or the other');
			const set_type = nftset_info[value]?.type;
			const src_ip = this.map.lookupOption('src_ip', section_id)[0].formvalue(section_id);
			const src_fam = ip_family(src_ip);
			if (src_fam === 'ipv4' && set_type === 'ipv6_addr')
				return _('Destination NFT set is IPv6 but source address is IPv4');
			if (src_fam === 'ipv6' && set_type === 'ipv4_addr')
				return _('Destination NFT set is IPv4 but source address is IPv6');
			return nftset_validate.call(this, section_id, value);
		};
		o.modalonly = true;

		o = s.option(form.Flag, 'logging', _('Logging'),
			_('Enables firewall rule logging (global mwan3 logging must also be enabled)'));
		o.modalonly = true;

		o = s.option(form.ListValue, 'use_policy', _('Policy'));
		let options = uci.sections('mwan3', 'policy')
		for (let opt of options) {
			o.value(opt['.name']);
		}
		o.value('unreachable', _('unreachable (reject)'));
		o.value('blackhole', _('blackhole (drop)'));
		o.value('default', _('default (use main routing table)'));

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = o.enabled;
		o.editable = true;
		o.renderWidget = function(section_id, option_index, cfgvalue) {
			const ipsetName    = uci.get('mwan3', section_id, 'ipset');
			const ipsetSrcName = uci.get('mwan3', section_id, 'ipset_src');

			function isIpsetDisabled(name) {
				if (!name) return false;
				const match = uci.sections('mwan3', 'ipset').find(s => s.name === name);
				return match ? match.enabled === '0' : false;
			}

			const hasDisabledIpset = isIpsetDisabled(ipsetName) || isIpsetDisabled(ipsetSrcName);
			const storedEnabled    = uci.get('mwan3', section_id, 'enabled');
			const currentlyEnabled = storedEnabled !== '0';

			if (hasDisabledIpset && !currentlyEnabled) {
				const prevReadonly = this.readonly;
				this.readonly = true;
				const widget = form.Flag.prototype.renderWidget.apply(this, [section_id, option_index, cfgvalue]);
				this.readonly = prevReadonly;
				return widget;
			}
			return form.Flag.prototype.renderWidget.apply(this, [section_id, option_index, cfgvalue]);
		};

		return m.render();
	}
})
