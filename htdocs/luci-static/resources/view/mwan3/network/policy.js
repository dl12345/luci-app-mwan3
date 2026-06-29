'use strict';
'require form';
'require view';
'require uci';
'require ui';
'require mwan3.components as components';
'require mwan3.widgets as widgets';
'require mwan3.validators as validators';

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('mwan3')
		]);
	},

	render: function () {
		components.loadStyle();

		let m, s, o;

		/* ---- Lookup tables ---- */

		var ifaceFamily = {};
		var ifacesByFamily = { ipv4: [], ipv6: [] };
		uci.sections('mwan3', 'interface').forEach(function(iface) {
			var fam = iface.family || 'ipv4';
			ifaceFamily[iface['.name']] = fam;
			if (!ifacesByFamily[fam]) ifacesByFamily[fam] = [];
			ifacesByFamily[fam].push(iface['.name']);
		});

		var memberInfo = {};
		uci.sections('mwan3', 'member').forEach(function(mbr) {
			var iface = mbr.interface || '';
			memberInfo[mbr['.name']] = {
				iface:  iface,
				metric: parseInt(mbr.metric  || '1', 10),
				weight: parseInt(mbr.weight  || '1', 10),
				family: ifaceFamily[iface] || 'ipv4'
			};
		});

		/* ---- Grid column descriptions ---- */

		/*
		 * Return the plain-English description for a single address family,
		 * without any family-label prefix. Used by the split IPv4/IPv6 columns.
		 */
		function familyDesc(section_id, fam) {
			var useMembers = uci.get('mwan3', section_id, 'use_member') || [];
			if (!Array.isArray(useMembers)) useMembers = [useMembers];

			var byMetric   = {};
			var hasMissing = false;

			useMembers.forEach(function(mname) {
				var info = memberInfo[mname];
				if (!info) { hasMissing = true; return; }
				if (info.family !== fam) return;
				if (!byMetric[info.metric]) byMetric[info.metric] = [];
				byMetric[info.metric].push({ iface: info.iface, weight: info.weight });
			});

			var metrics = Object.keys(byMetric).map(Number).sort(function(a, b) { return a - b; });
			if (!metrics.length) return hasMissing ? '(' + _('some members undefined') + ')' : '';

			function tierStr(entries) {
				if (entries.length === 1) return '[' + entries[0].iface + ']';
				var total = entries.reduce(function(a, e) { return a + e.weight; }, 0);
				return '[' + entries.map(function(e) {
					return e.iface + ' ' + Math.round(e.weight * 100 / total) + '%';
				}).join(', ') + ']';
			}

			var desc = metrics.map(function(metric) {
				return tierStr(byMetric[metric]);
			}).join(' \u2192 ');

			if (hasMissing) desc += ' (' + _('some members undefined') + ')';
			return desc;
		}

		/* ---- Apply (side effects) ---- */

		/*
		 * Apply a policy specification produced by the editor: create the
		 * members it needs, set the policy's member list and last resort, remove
		 * orphans when auto-delete is on, then save and reload. When auto-delete
		 * is off and orphans remain, offer them for selective deletion.
		 */
		function applyPolicy(editor) {
			var spec = editor.getValue();

			spec.membersToCreate.forEach(function(mb) {
				uci.add('mwan3', 'member', mb.name);
				uci.set('mwan3', mb.name, 'interface', mb.iface);
				uci.set('mwan3', mb.name, 'metric',    String(mb.metric));
				uci.set('mwan3', mb.name, 'weight',    String(mb.weight));
			});

			if (spec.isNew)
				uci.add('mwan3', 'policy', spec.policyName);

			uci.set('mwan3', spec.policyName, 'use_member',  spec.useMembers);
			uci.set('mwan3', spec.policyName, 'last_resort', spec.lastResort);

			var autoDelete = localStorage.getItem('mwan3.autoDeleteMembers') !== '0';
			if (autoDelete)
				spec.orphans.forEach(function(mname) { uci.remove('mwan3', mname); });

			return uci.save().then(function() {
				ui.hideModal();
				if (spec.orphans.length && !autoDelete)
					showOrphanCleanup(spec.orphans);
				else
					window.location.reload();
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, _('Save failed: ') + err), 'danger');
			});
		}

		/*
		 * List orphaned member sections with checkboxes so the user can
		 * selectively delete them.
		 */
		function showOrphanCleanup(orphans) {
			var items = orphans.map(function(mname) {
				var cb = E('input', { 'type': 'checkbox', 'checked': '' });
				return {
					cb:    cb,
					mname: mname,
					row:   E('div', { 'class': 'mwan3-pb-orphan-row' }, [ cb, E('code', {}, mname) ])
				};
			});

			var deleteBtn = E('button', {
				'class': 'cbi-button cbi-button-remove',
				'click': ui.createHandlerFn(this, function() {
					items.forEach(function(item) {
						if (item.cb.checked) uci.remove('mwan3', item.mname);
					});
					return uci.save().then(function() {
						ui.hideModal();
						window.location.reload();
					}).catch(function(err) {
						ui.addNotification(null, E('p', {}, _('Delete failed: ') + err), 'danger');
					});
				})
			}, _('Delete selected'));

			ui.showModal(_('Orphaned members'), [
				E('p', {}, _('The following members are no longer referenced by any policy. Select those to delete:')),
				E('div', { 'class': 'mwan3-pb-orphan-list' }, items.map(function(item) { return item.row; })),
				E('div', { 'class': 'mwan3-pb-actions' }, [
					E('button', {
						'class': 'cbi-button',
						'click': function(ev) {
							ev.preventDefault();
							ui.hideModal();
							window.location.reload();
						}
					}, _('Dismiss')),
					deleteBtn
				])
			]);
		}

		/* ---- Policy Builder modal ---- */

		/*
		 * Open the builder modal around a PolicyTierEditor instance. The editor
		 * owns the editing and computes the specification; this wiring applies
		 * the result and keeps the Save button in step with validity.
		 */
		function openBuilder(opts) {
			var editor = new widgets.PolicyTierEditor({
				ifacesByFamily: ifacesByFamily,
				memberInfo:     memberInfo,
				policies:       uci.sections('mwan3', 'policy'),
				mode:           opts.mode === 'edit' ? 'edit' : 'new',
				policyName:     opts.policyName,
				newPolicyName:  opts.newPolicyName
			});

			var body = editor.render();

			var saveBtn = E('button', {
				'class': 'cbi-button cbi-button-save',
				'click': ui.createHandlerFn(this, function() {
					if (!editor.isValid()) return;
					return applyPolicy(editor);
				})
			}, _('Save'));

			editor.onChange = function() { saveBtn.disabled = !editor.isValid(); };
			saveBtn.disabled = !editor.isValid();

			ui.showModal(_('Policy Builder'), [
				body,
				E('div', { 'class': 'mwan3-pb-actions' }, [
					E('button', {
						'class': 'cbi-button',
						'click': function(ev) { ev.preventDefault(); ui.hideModal(); }
					}, _('Dismiss')),
					saveBtn
				])
			]);
		}

		/* ---- Form ---- */

		m = new form.Map('mwan3', _('MultiWAN Manager - Policies'),
			_('Policies control how mwan3 distributes traffic.') + '<br />' +
			_('Policies may not share the same name as interfaces, members or rules.') + '<br />' +
			_('Policy names must be alphanumeric with underscore and <= 15 characters.'));

		s = m.section(form.GridSection, 'policy');
		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;

		s.addbtntitle = _('Add...');

		s.handleAdd = function(ev, name) {
			openBuilder({ mode: 'new', newPolicyName: name || '' });
		};

		s.renderRowActions = function(section_id) {
			var tdEl = form.GridSection.prototype.renderRowActions.apply(this, [section_id]);
			var editBtn = tdEl.querySelector('.cbi-button-edit');
			if (editBtn) {
				var newBtn = editBtn.cloneNode(true);
				newBtn.addEventListener('click', function(ev) {
					ev.preventDefault();
					openBuilder({ mode: 'edit', policyName: section_id });
				});
				editBtn.parentNode.replaceChild(newBtn, editBtn);
			}
			return tdEl;
		};

		/* This name length error check can likely be removed when mwan3 migrates to nftables */
		s.renderSectionAdd = function(extra_class) {
			var el = form.GridSection.prototype.renderSectionAdd.apply(this, arguments),
				nameEl = el.querySelector('.cbi-section-create-name');

			ui.addValidator(nameEl, 'uciname', true, function(v) {
				if (validators.sectionNameInUse(v))
					return _('Policies may not share the same name as configured interfaces, members or rules');
				if (v.length > 15) return _('Name length shall not exceed 15 characters');
				return true;
			}, 'blur', 'keyup');

			return el;
		};

		o = s.option(form.DummyValue, '_ipv4', _('IPv4 Priority order'));
		o.textvalue = function(section_id) {
			var text = familyDesc(section_id, 'ipv4');
			return text ? E('span', {}, [text]) : E('em', {}, ['-']);
		};

		o = s.option(form.DummyValue, '_ipv6', _('IPv6 Priority order'));
		o.textvalue = function(section_id) {
			var text = familyDesc(section_id, 'ipv6');
			return text ? E('span', {}, [text]) : E('em', {}, ['-']);
		};

		o = s.option(form.ListValue, 'last_resort', _('Last resort'),
			_('When all policy members are offline use this behavior for matched traffic'));
		o.default = 'unreachable';
		o.value('unreachable', _('unreachable (reject)'));
		o.value('blackhole', _('blackhole (drop)'));
		o.value('default', _('default (use main routing table)'));

		return m.render().then(function(node) {
			/* Page preference: whether unused members are deleted automatically
			   on save. Placed in a small toolbar above the grid. */
			var autoDelete = localStorage.getItem('mwan3.autoDeleteMembers') !== '0';
			var cb = E('input', {
				'type': 'checkbox',
				'id': 'pref_delete_members',
				'change': function() {
					localStorage.setItem('mwan3.autoDeleteMembers', this.checked ? '1' : '0');
				}
			});
			cb.checked = autoDelete;

			var toolbar = E('div', { 'class': 'mwan3-pb-toolbar' }, [
				E('label', { 'for': 'pref_delete_members', 'class': 'mwan3-pb-pref' },
					[ _('Delete unused member definitions'), cb ])
			]);

			var descr = node.querySelector('.cbi-map-descr');
			if (descr && descr.parentNode)
				descr.parentNode.insertBefore(toolbar, descr.nextSibling);
			else
				node.insertBefore(toolbar, node.firstChild);

			return node;
		});
	}
})
