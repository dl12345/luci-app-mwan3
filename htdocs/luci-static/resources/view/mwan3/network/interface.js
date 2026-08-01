'use strict';
'require form';
'require fs';
'require view';
'require uci';
'require ui';
'require mwan3.ipmath as ipmath';
'require mwan3.validators as validators';

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.stat('/usr/bin/httping'), {}),
			L.resolveDefault(fs.stat('/usr/bin/nping'), {}),
			L.resolveDefault(fs.stat('/usr/bin/arping'), {}),
			uci.load('network')
		]);
	},

	render: function (stats) {
		let m, s, o;

		m = new form.Map('mwan3', _('MultiWAN Manager - Interfaces'),
			_('Mwan3 requires that all interfaces have a unique metric configured in /etc/config/network.') + '<br />' +
			_('Names must match the interface name found in /etc/config/network.') + '<br />' +
			_('Names may contain characters A-Z, a-z, 0-9, _ and no spaces-') + '<br />' +
			_('Interfaces may not share the same name as configured members, policies or rules.'));

		s = m.section(form.GridSection, 'interface');
		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;

		s.tab('general', _('General Settings'));
		s.tab('ipv6', _('IPv6 Settings'));
		s.tab('tracking', _('Tracking Settings'));
		s.tab('reliability', _('Reliability Settings'));

		/* This name length error check can likely be removed when mwan3 migrates to nftables */
		s.renderSectionAdd = function(extra_class) {
			var el = form.GridSection.prototype.renderSectionAdd.apply(this, arguments),
				nameEl = el.querySelector('.cbi-section-create-name');
			ui.addValidator(nameEl, 'uciname', true, function(v) {
				if (validators.sectionNameInUse(v))
					return _('Interfaces may not share the same name as configured members, policies or rules.');
				if (v.length > 15) return _('Name length shall not exceed 15 characters');
				return true;
			}, 'blur', 'keyup');
			return el;
		};

		/* The 1:1 translation options are gated on the globals ipv6_routing
		   option, which no dependency can reach from this view, and one of them
		   is a family of options named after the other interface sections, so
		   they are built per row here rather than declared statically. uci.get
		   reads staged values, so turning the global on and saving reveals them
		   without an apply. With it off they are never declared, so a modal
		   save cannot strip a stored translation configuration. */

		s.addModalOptions = function(modalSection, section_id) {
			if (uci.get('mwan3', 'globals', 'ipv6_routing') !== 'on')
				return;

			var o = modalSection.taboption('ipv6', form.Value, 'ipv6_translate_pool',
				_('1:1 translation pool'),
				_('Carry the traffic of the other IPv6 WANs on this interface by 1:1 prefix translation, giving each carried LAN segment its own stable target prefix. Enter auto to carve the targets out of this interface\'s own delegation, or a prefix routed to this interface to carve out of that instead. Leave blank to carry foreign traffic by masquerade.'));
			o.depends('family', 'ipv6');
			o.value('auto');
			o.validate = function(section_id, value) {
				if (!value || value.length === 0 || value === 'auto')
					return true;
				if (!validators.ipv6Cidr(value, 1, 64))
					return _('Enter auto or an IPv6 prefix with a length between /1 and /64');
				return true;
			};

			uci.sections('mwan3', 'interface').forEach(function(section) {
				var name = section['.name'];

				if (name === section_id || section.family !== 'ipv6')
					return;

				o = modalSection.taboption('ipv6', form.DynamicList, 'ipv6_translate_prefix_' + name,
					_('Translation override for %s').format(name),
					_('Map the delegated prefixes of %s onto target prefixes of your own choosing, preserving their internal subnet layout and taking precedence over the pool carve for that WAN. Entries pair positionally with its delegated prefixes, and each target must be at least as large as the delegation it maps.').format(name));
				o.depends('family', 'ipv6');
				o.validate = function(section_id, value) {
					if (!value || value.length === 0)
						return true;
					if (!validators.ipv6Cidr(value, 1, 64))
						return _('Enter an IPv6 prefix with a length between /1 and /64');
					return true;
				};
			});

			o = modalSection.taboption('ipv6', form.DynamicList, 'ipv6_translate_ula',
				_('ULA segments to carry'),
				_('Carry ULA addressed LAN segments by 1:1 translation as well, which the delegated prefixes never cover. Enter auto to carry every ULA segment the router assigns or has delegated downstream, or a ULA prefix to name one directly, such as a segment behind a downstream router.'));
			o.depends({ family: 'ipv6', ipv6_translate_pool: /^./ });
			o.value('auto');
			o.validate = function(section_id, value) {
				if (!value || value.length === 0 || value === 'auto')
					return true;
				if (!validators.ipv6Cidr(value, 1, 64))
					return _('Enter auto or an IPv6 prefix with a length between /1 and /64');
				if (!ipmath.ipv6CidrContains('fc00::/7', value))
					return _('A carried ULA segment must lie inside fc00::/7');
				return true;
			};
		};

		o = s.taboption('general', form.Flag, 'enabled', _('Enabled'));
		o.default = false;

		o = s.taboption('general', form.ListValue, 'initial_state', _('Initial state'),
			_('Expect interface state on up event'));
		o.default = 'online';
		o.value('online', _('Online'));
		o.value('offline', _('Offline'));
		o.modalonly = true;

		o = s.taboption('general', form.ListValue, 'family', _('Internet Protocol'));
		o.default = 'ipv4';
		o.value('ipv4', _('IPv4'));
		o.value('ipv6', _('IPv6'));
		o.modalonly = true;

		o = s.taboption('tracking', form.Flag, 'track_gateway', _('Track gateway'),
			_('Automatically track the next hop peer. Applies only to point to point connections.'));
		o.depends('family', 'ipv4');
		o.default = '0';
		o.modalonly = true;

		o = s.taboption('ipv6', form.Value, 'snat6', _('IPv6 SNAT'),
			_('Source-NAT mwan3-rerouted router-originated IPv6 traffic egressing this interface. ' +
			  'Leave blank or set to 0 to disable (default). Set to 1 to SNAT to the interface\'s primary global address. ' +
			  'Set to a literal IPv6 address to SNAT to that address (e.g. NPTv6-style fixed source). ' +
			  'Default is off because RFC 6724 source-address selection and SADR routing can solve the same ' +
			  'problem without translation, and NAT66 is harmful in PA/ULA designs.'));
		o.depends('family', 'ipv6');
		o.placeholder = '0';
		o.rmempty = true;
		o.modalonly = true;

		o = s.taboption('tracking', form.DynamicList, 'track_ip', _('Tracking hostname or IP address'),
			_('This hostname or IP address will be pinged to determine if the link is up or down. Leave blank to assume interface is always online'));
		o.datatype = 'host';
		o.modalonly = true;

		o = s.taboption('tracking', form.ListValue, 'track_method', _('Tracking method'));
		o.default = 'ping';
		o.value('ping');
		if (stats[0].type === 'file') {
			o.value('httping');
		}
		if (stats[1].type === 'file') {
			o.value('nping-tcp');
			o.value('nping-udp');
			o.value('nping-icmp');
			o.value('nping-arp');
		}
		if (stats[2].type === 'file') {
			o.value('arping');
		}

		o = s.taboption('tracking', form.Flag, 'httping_ssl', _('Enable ssl tracking'),
			_('Enables https tracking on ssl port 443'));
		o.depends('track_method', 'httping');
		o.rmempty = false;
		o.modalonly = true;

		o = s.taboption('reliability', form.Value, 'reliability', _('Tracking reliability'),
			_('Acceptable values: 1-100. This many Tracking IP addresses must respond for the link to be deemed up'));
		o.datatype = 'range(1, 100)';
		o.default = '1';

		o = s.taboption('tracking', form.ListValue, 'count', _('Ping count'));
		o.default = '1';
		o.value('1');
		o.value('2');
		o.value('3');
		o.value('4');
		o.value('5');
		o.modalonly = true;

		o = s.taboption('tracking', form.Value, 'size', _('Ping size'));
		o.default = '56';
		o.depends('track_method', 'ping');
		o.value('8');
		o.value('24');
		o.value('56');
		o.value('120');
		o.value('248');
		o.value('504');
		o.value('1016');
		o.value('1472');
		o.value('2040');
		o.datatype = 'range(1, 65507)';
		o.modalonly = true;

		o =s.taboption('tracking', form.Value, 'max_ttl', _('Max TTL'));
		o.default = '60';
		o.depends('track_method', 'ping');
		o.value('10');
		o.value('20');
		o.value('30');
		o.value('40');
		o.value('50');
		o.value('60');
		o.value('70');
		o.datatype = 'range(1, 255)';
		o.modalonly = true;

		o = s.taboption('reliability', form.Flag, 'check_quality', _('Check link quality'));
		o.depends('track_method', 'ping');
		o.default = false;
		o.modalonly = true;

		o = s.taboption('reliability', form.Value, 'failure_latency', _('Failure latency [ms]'));
		o.depends('check_quality', '1');
		o.default = '1000';
		o.value('25');
		o.value('50');
		o.value('75');
		o.value('100');
		o.value('150');
		o.value('200');
		o.value('250');
		o.value('300');
		o.modalonly = true;

		o = s.taboption('reliability', form.Value, 'failure_loss', _('Failure packet loss [%]'));
		o.depends('check_quality', '1');
		o.default = '40';
		o.value('2');
		o.value('5');
		o.value('10');
		o.value('20');
		o.value('25');
		o.modalonly = true;

		o = s.taboption('reliability', form.Value, 'recovery_latency', _('Recovery latency [ms]'));
		o.depends('check_quality', '1');
		o.default = '500';
		o.value('25');
		o.value('50');
		o.value('75');
		o.value('100');
		o.value('150');
		o.value('200');
		o.value('250');
		o.value('300');
		o.modalonly = true;

		o = s.taboption('reliability', form.Value, 'recovery_loss', _('Recovery packet loss [%]'));
		o.depends('check_quality', '1');
		o.default = '10';
		o.value('2');
		o.value('5');
		o.value('10');
		o.value('20');
		o.value('25');
		o.modalonly = true;

		o = s.taboption('tracking', form.ListValue, "timeout", _("Ping timeout"));
		o.default = '4';
		o.value('1', _('%d second').format('1'));
		for (var i = 2; i <= 10; i++)
			o.value(String(i), _('%d seconds').format(i));
		o.modalonly = true;

		o = s.taboption('tracking', form.ListValue, 'interval', _('Ping interval'));
		o.default = '10';
		o.value('1', _('%d second').format('1'));
		o.value('3', _('%d seconds').format('3'));
		o.value('5', _('%d seconds').format('5'));
		o.value('10', _('%d seconds').format('10'));
		o.value('20', _('%d seconds').format('20'));
		o.value('30', _('%d seconds').format('30'));
		o.value('60', _('%d minute').format('1'));
		o.value('300', _('%d minutes').format('5'));
		o.value('600', _('%d minutes').format('10'));
		o.value('900', _('%d minutes').format('15'));
		o.value('1800', _('%d minutes').format('30'));
		o.value('3600', _('%d hour').format('1'));

		o = s.taboption('tracking', form.Value, 'failure_interval', _('Failure interval'),
			_('Ping interval during failure detection'));
		o.default = '5';
		o.value('1', _('%d second').format('1'));
		o.value('3', _('%d seconds').format('3'));
		o.value('5', _('%d seconds').format('5'));
		o.value('10', _('%d seconds').format('10'));
		o.value('20', _('%d seconds').format('20'));
		o.value('30', _('%d seconds').format('30'));
		o.value('60', _('%d minute').format('1'));
		o.value('300', _('%d minutes').format('5'));
		o.value('600', _('%d minutes').format('10'));
		o.value('900', _('%d minutes').format('15'));
		o.value('1800', _('%d minutes').format('30'));
		o.value('3600', _('%d hour').format('1'));
		o.modalonly = true;

		o = s.taboption('tracking', form.Flag, 'keep_failure_interval', _('Keep failure interval'),
			_('Keep ping failure interval during failure state'));
		o.default = false;
		o.modalonly = true;

		o = s.taboption('tracking', form.Value, 'recovery_interval', _('Recovery interval'),
			_('Ping interval during failure recovering'));
		o.default = '5';
		o.value('1', _('%d second').format('1'));
		o.value('3', _('%d seconds').format('3'));
		o.value('5', _('%d seconds').format('5'));
		o.value('10', _('%d seconds').format('10'));
		o.value('20', _('%d seconds').format('20'));
		o.value('30', _('%d seconds').format('30'));
		o.value('60', _('%d minute').format('1'));
		o.value('300', _('%d minutes').format('5'));
		o.value('600', _('%d minutes').format('10'));
		o.value('900', _('%d minutes').format('15'));
		o.value('1800', _('%d minutes').format('30'));
		o.value('3600', _('%d hour').format('1'));
		o.modalonly = true;

		o = s.taboption('reliability', form.ListValue, 'down', _('Interface down'),
			_('Interface will be deemed down after this many failed ping tests'));
		o.default = '5';
		o.value('1');
		o.value('2');
		o.value('3');
		o.value('4');
		o.value('5');
		o.value('6');
		o.value('7');
		o.value('8');
		o.value('9');
		o.value('10');

		o = s.taboption('reliability', form.ListValue, 'up', _('Interface up'),
			_('Downed interface will be deemed up after this many successful ping tests'));
		o.default = "5";
		o.value('1');
		o.value('2');
		o.value('3');
		o.value('4');
		o.value('5');
		o.value('6');
		o.value('7');
		o.value('8');
		o.value('9');
		o.value('10');

		o = s.taboption('general', form.DynamicList, 'flush_conntrack', _('Flush conntrack table'),
			_('Flush the entire global conntrack table on selected events. Per-interface conntrack entries are already flushed automatically on ifdown.'));
		o.value('ifup', _('ifup (netifd)'));
		o.value('ifdown', _('ifdown (netifd)'));
		o.value('connected', _('connected (mwan3)'));
		o.value('disconnected', _('disconnected (mwan3)'));
		o.modalonly = true;

		o = s.taboption('general', form.DummyValue, 'metric', _('Metric'),
			_('This displays the metric assigned to this interface in /etc/config/network'));
		o.rawhtml = true;
		o.cfgvalue = function(s) {
			var metric = uci.get('network', s, 'metric')
			if (metric)
				return metric;
			else
				return _('No interface metric set!');
		}

		return m.render();
	}
})
