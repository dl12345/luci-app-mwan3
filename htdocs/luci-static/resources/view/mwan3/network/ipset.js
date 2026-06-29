'use strict';
'require form';
'require view';
'require uci';
'require ui';
'require validation';
'require mwan3.validators as validators';

var stubValidator = validators.stub();

return view.extend({
	load: function() {
		return uci.load('mwan3');
	},

	render: function() {
		let m, s, o;

		m = new form.Map('mwan3', _('MultiWAN Manager - IP Sets'),
			_('IP sets are nftables address sets referenced by mwan3 rules.') + '<br />' +
			_('Sets can be populated with static entries, loaded from a file, or populated at runtime by dnsmasq name resolution.') + '<br />' +
			_('Set names must not begin with "mwan3_" (reserved for internal use).') + '<br />' +
			_('The Enable checkbox is greyed if the set is referenced by an enabled rule.'));

		s = m.section(form.GridSection, 'ipset', _('IP Sets'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable  = true;
		s.nodescriptions = true;

		s.handleRemove = function(section_id, ev) {
			const name = uci.get('mwan3', section_id, 'name');
			if (name) {
				const refs = uci.sections('mwan3', 'rule')
					.filter(r => r.ipset === name || r.ipset_src === name)
					.map(r => r['.name']);
				if (refs.length > 0) {
					ui.addNotification(null, E('p',
						_('Cannot delete IP set "%s": referenced by rule(s): %s. Remove those rule references first.')
							.format(name, refs.join(', '))),
						'warning');
					return Promise.resolve();
				}
			}
			return form.GridSection.prototype.handleRemove.call(this, section_id, ev);
		};

		o = s.option(form.Value, 'name', _('Name'));
		o.rmempty = false;
		o.validate = function(section_id, value) {
			if (!value || value.length === 0)
				return true;
			if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(value))
				return _('Invalid name: use letters, digits, _ . or - only, starting with a letter or _');
			if (/^mwan3_/.test(value))
				return _('Names beginning with "mwan3_" are reserved for internal use');
			const sections = uci.sections('mwan3', 'ipset');
			for (let i = 0; i < sections.length; i++) {
				if (sections[i]['.name'] !== section_id && sections[i].name === value)
					return _('A set with this name already exists');
			}
			return true;
		};

		o = s.option(form.ListValue, 'family', _('Family'));
		o.value('ipv4', _('IPv4'));
		o.value('ipv6', _('IPv6'));
		o.default = 'ipv4';

		o = s.option(form.DynamicList, 'entry', _('IPs / Networks'),
			_('Static entries: IP addresses or CIDR subnets (eg "192.168.1.1" or "10.0.0.0/8")'));
		o.validate = function(section_id, value) {
			if (!value || value.length === 0)
				return true;
			if (!stubValidator.apply('ipaddr', value))
				return _('Invalid IP address or prefix');
			var family = this.map.lookupOption('family', section_id)[0].formvalue(section_id);
			var is_v6 = !!validation.parseIPv6(value.split('/')[0]);
			if (family === 'ipv4' && is_v6)
				return _('Entry must be an IPv4 address when family is set to IPv4');
			if (family === 'ipv6' && !is_v6)
				return _('Entry must be an IPv6 address when family is set to IPv6');
			return true;
		};
		o.modalonly = true;

		o = s.option(form.DynamicList, 'domain', _('Domains'),
			_('Domain names resolved by dnsmasq and added to the set at runtime (eg "youtube.com")'));
		o.modalonly = true;

		o = s.option(form.FileUpload, 'loadfile', _('Include File'),
			_('File of IP addresses or CIDRs, one per line; lines beginning with # are ignored'));
		o.root_directory = '/etc/luci-uploads';
		o.enable_remove = true;
		o.enable_upload = true;
		o.datatype = 'file';
		o.rmempty = true;
		o.modalonly = true;

		o = s.option(form.Value, 'maxelem', _('Max Entries'),
			_('Maximum number of elements in the set. Leave empty for no limit'));
		o.datatype = 'uinteger';
		o.placeholder = _('unlimited');
		o.modalonly = true;
		o.rmempty = true;

		o = s.option(form.Value, 'timeout', _('Timeout'),
			_('Entry lifetime in seconds. 0 means entries do not expire'));
		o.datatype = 'uinteger';
		o.placeholder = '0';
		o.modalonly = true;
		o.rmempty = true;

		o = s.option(form.Flag, 'counters', _('Counters'),
			_('Track per-element packet and byte counts'));
		o.modalonly = true;
		o.rmempty = true;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = o.enabled;
		o.editable = true;
		o.renderWidget = function(section_id, option_index, cfgvalue) {
			const name = uci.get('mwan3', section_id, 'name');
			let isReferenced = false;
			if (name) {
				isReferenced = uci.sections('mwan3', 'rule')
					.some(r => r.enabled !== '0' && (r.ipset === name || r.ipset_src === name));
			}
			const storedEnabled = uci.get('mwan3', section_id, 'enabled');
			const currentlyEnabled = storedEnabled !== '0';

			if (isReferenced && currentlyEnabled) {
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
});
