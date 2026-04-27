'use strict';
'require form';
'require view';
'require uci';
'require ui';

function makeBlurOnly(opt) {
	opt.render = function(config_name, section_id, in_table) {
		return Promise.resolve(form.Value.prototype.render.apply(this, arguments)).then(function(node) {
			/* The validation keyup listener is registered in bubble phase during
			 * render. We suppress it by adding a capture-phase listener on the
			 * same input: at the target, capture listeners run before bubble
			 * listeners, so stopImmediatePropagation() prevents validation from
			 * firing on every keystroke. Validation still runs on blur. */
			var input = node && node.querySelector && node.querySelector('input');
			if (input) {
				input.addEventListener('keyup', function(ev) {
					ev.stopImmediatePropagation();
				}, true);
			}
			return node;
		});
	};
}

function makeBlurOnlyList(opt) {
	opt.render = function(config_name, section_id, in_table) {
		return Promise.resolve(form.DynamicList.prototype.render.apply(this, arguments)).then(function(node) {
			function suppress(input) {
				input.addEventListener('keyup', function(ev) {
					ev.stopImmediatePropagation();
				}, true);
			}
			node.querySelectorAll('input').forEach(suppress);
			/* DynamicList adds inputs dynamically when the user clicks "+".
			 * Watch for new inputs and attach the same suppressor to each. */
			new MutationObserver(function(mutations) {
				for (var i = 0; i < mutations.length; i++) {
					var added = mutations[i].addedNodes;
					for (var j = 0; j < added.length; j++) {
						if (added[j].querySelectorAll)
							added[j].querySelectorAll('input').forEach(suppress);
					}
				}
			}).observe(node, { childList: true, subtree: true });
			return node;
		});
	};
}

return view.extend({
	load: function() {
		return uci.load('mwan3');
	},

	render: function() {
		let m, s, o;

		m = new form.Map('mwan3', _('MultiWAN Manager - IP Sets'),
			_('IP sets are nftables address sets referenced by mwan3 rules.') + '<br />' +
			_('Sets can be populated with static entries, loaded from a file, or populated at runtime by dnsmasq name resolution.') + '<br />' +
			_('Set names must not begin with "mwan3_" (reserved for internal use).'));

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
		o.render = function(config_name, section_id, in_table) {
			return Promise.resolve(form.Value.prototype.render.apply(this, arguments)).then(function(node) {
				var input = node && node.querySelector && node.querySelector('input');
				if (input && !input.value) {
					/* Field is empty on render (new section). Mark pristine so
					 * checkDepends-triggered triggerValidation calls are suppressed
					 * until the user actually interacts with the field. */
					input._mwan3_pristine = true;
					input.classList.remove('cbi-input-invalid');
					var unpristine = function() { input._mwan3_pristine = false; };
					input.addEventListener('blur',  unpristine, { once: true });
					input.addEventListener('input', unpristine, { once: true });
					/* After the modal is in the DOM, attach a capture-phase listener
					 * to the Save button. The capture fires before LuCI's bubble-phase
					 * click handler, so _mwan3_pristine is cleared before checkDepends
					 * is called from map.save(), allowing triggerValidation to add the
					 * red border and give the user visual feedback. */
					requestAnimationFrame(function() {
						var modal = document.querySelector('#modal_overlay > .modal.cbi-modal');
						var saveBtn = modal && modal.querySelector('.cbi-button-positive.important');
						if (saveBtn && modal.contains(input))
							saveBtn.addEventListener('click', unpristine,
								{ once: true, capture: true });
					});
				}
				return node;
			});
		};
		o.triggerValidation = function(section_id) {
			var elem = this.getUIElement(section_id);
			if (!elem) return true;
			var input = elem.node && elem.node.querySelector && elem.node.querySelector('input');
			if (input && input._mwan3_pristine)
				return true;
			return elem.triggerValidation();
		};
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
		o.datatype = 'ipaddr';
		o.validate = function(section_id, value) {
			if (!value || value.length === 0)
				return true;
			const family = this.map.lookupOption('family', section_id)[0].formvalue(section_id);
			const is_v6 = value.indexOf(':') !== -1;
			if (family === 'ipv4' && is_v6)
				return _('Entry must be an IPv4 address when family is set to IPv4');
			if (family === 'ipv6' && !is_v6)
				return _('Entry must be an IPv6 address when family is set to IPv6');
			return true;
		};
		o.modalonly = true;
		makeBlurOnlyList(o);

		o = s.option(form.DynamicList, 'domain', _('Domains'),
			_('Domain names resolved by dnsmasq and added to the set at runtime (eg "youtube.com")'));
		o.modalonly = true;

		o = s.option(form.FileUpload, 'loadfile', _('Include File'),
			_('File of IP addresses or CIDRs, one per line; lines beginning with # are ignored'));
		o.root_directory = '/etc/luci-uploads';
		o.enable_delete = true;
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

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.editable = true;

		return m.render();
	}
});
