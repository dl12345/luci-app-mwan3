'use strict';
'require baseclass';
'require ui';
'require dom';
'require uci';
'require mwan3.components as components';
'require mwan3.validators as validators';

/* Custom interactive widgets for the mwan3 views. */

/* A number input with native spinner controls. ui.Textfield renders a text
   input; this subclass switches the input type to number and applies the min,
   max and step bounds while inheriting the value and validation behaviour. */

var NumberField = ui.Textfield.extend({
	render: function() {
		var node = this.super('render', []);
		var input = node.querySelector('input');
		if (input) {
			input.type = 'number';
			if (this.options.min != null)  input.min  = this.options.min;
			if (this.options.max != null)  input.max  = this.options.max;
			if (this.options.step != null) input.step = this.options.step;
		}
		return node;
	}
});

/* ---- Weight maths ---- */

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
function gcdList(arr) { return arr.reduce(gcd); }

/* GCD-reduced integer weights from a family entry list. A single entry always
   gets weight 1. */

function computeWeights(famEntries) {
	if (famEntries.length === 1) return [1];
	var pcts = famEntries.map(function(e) { return e.pct; });
	var g    = gcdList(pcts);
	return pcts.map(function(p) { return p / g; });
}

/* Find an existing member section whose option values exactly match
   (iface, metric, weight). Any matching member is reused regardless of name. */

function findExistingMember(iface, metric, weight) {
	return uci.sections('mwan3', 'member').find(function(sec) {
		return (sec.interface || '')            === iface  &&
		       parseInt(sec.metric || '1', 10) === metric &&
		       parseInt(sec.weight || '1', 10) === weight;
	});
}

/* Redistribute entries of one family so their pct values sum to 100, as
   equally as possible. The first entry absorbs any rounding remainder. */

function distributeEqual(famEntries) {
	var n = famEntries.length;
	if (!n) return;
	if (n === 1) { famEntries[0].pct = 100; return; }
	var share = Math.floor(100 / n);
	famEntries.forEach(function(e) { e.pct = share; });
	famEntries[0].pct = 100 - share * (n - 1);
}

/*
 * Policy tier editor: the modal body for building and editing a weighted,
 * multi-tier, multi-family mwan3 policy. It owns the tier and entry editing,
 * the percentage-to-weight maths, and the validation, and it computes the
 * desired member set and orphan list as data via getValue(). It has no side
 * effects: it never writes uci, saves, or reloads. The consuming view applies
 * the result.
 */
var PolicyTierEditor = baseclass.extend({
	__init__: function(opts) {
		opts = opts || {};
		this.ifacesByFamily = opts.ifacesByFamily || { ipv4: [], ipv6: [] };
		this.memberInfo     = opts.memberInfo || {};
		this.policies       = opts.policies || [];
		this.onChange       = opts.onChange || function() {};

		if (opts.mode === 'edit' && opts.policyName)
			this.state = this.stateFromPolicy(opts.policyName);
		else
			this.state = {
				mode:          'new',
				policyName:    '',
				newPolicyName: opts.newPolicyName || '',
				lastResort:    'unreachable',
				tiers:         [{ entries: [] }]
			};
	},

	/* Build a state object from an existing policy's uci config. Tiers are
	   derived from member metric values (ascending metric = tier 1, 2, ...);
	   percentage shares within each tier come from the weight ratios. */

	stateFromPolicy: function(pname) {
		var memberInfo = this.memberInfo;
		var useMembers = uci.get('mwan3', pname, 'use_member') || [];
		if (!Array.isArray(useMembers)) useMembers = [useMembers];

		var byMetric = {};
		useMembers.forEach(function(mname) {
			var info = memberInfo[mname];
			if (!info) return;
			if (!byMetric[info.metric]) byMetric[info.metric] = { ipv4: [], ipv6: [] };
			byMetric[info.metric][info.family].push({ iface: info.iface, weight: info.weight });
		});

		var tiers = Object.keys(byMetric).map(Number)
			.sort(function(a, b) { return a - b; })
			.map(function(metric) {
				var entries = [];
				['ipv4', 'ipv6'].forEach(function(fam) {
					var famList = byMetric[metric][fam];
					if (!famList.length) return;
					var total = famList.reduce(function(s, e) { return s + e.weight; }, 0);
					famList.forEach(function(e) {
						entries.push({
							family: fam,
							iface:  e.iface,
							pct:    Math.round(e.weight / total * 100)
						});
					});
				});
				return { entries: entries };
			});

		if (!tiers.length) tiers = [{ entries: [] }];

		return {
			mode:          'existing',
			policyName:    pname,
			newPolicyName: '',
			lastResort:    uci.get('mwan3', pname, 'last_resort') || 'unreachable',
			tiers:         tiers
		};
	},

	/* Replace the current state and re-sync the controls and tier blocks. */

	setValue: function(state) {
		this.state = state;
		if (!this.tiersContainer) return;
		if (this._newNameField) this._newNameField.setValue(state.newPolicyName || '');
		if (this._newNameRow)
			this._newNameRow.classList[state.mode === 'new' ? 'remove' : 'add']('mwan3-hidden');
		if (this._lastResortSel) this._lastResortSel.setValue(state.lastResort);
		if (this._policySel)
			this._policySel.setValue(state.mode === 'existing' ? state.policyName : '__new__');
		if (this._policyRow)
			this._policyRow.classList[state.mode === 'new' ? 'add' : 'remove']('mwan3-hidden');
		this.refreshTiers();
	},

	/* User-visible error strings describing why the state cannot be saved.
	   An empty array means the state is valid. */

	getErrors: function() {
		var state = this.state;
		var errors = [];

		if (state.mode === 'new') {
			var nm = state.newPolicyName;
			if (!nm) {
				errors.push(_('Policy name is required'));
			} else if (!/^[a-zA-Z0-9_]+$/.test(nm)) {
				errors.push(_('Policy name may only contain A-Z, a-z, 0-9 and _'));
			} else if (nm.length > 15) {
				errors.push(_('Policy name must be 15 characters or less'));
			} else {
				if (validators.sectionNameInUse(nm))
					errors.push(_('This name is already in use'));
			}
		}

		var hasEntries = state.tiers.some(function(t) { return t.entries.length > 0; });
		if (!hasEntries)
			errors.push(_('At least one interface entry is required'));

		state.tiers.forEach(function(tier, i) {
			tier.entries.forEach(function(entry) {
				if (!entry.iface)
					errors.push(_('Tier %d has an entry with no interface selected').format(i + 1));
			});

			var famTotals = {};
			tier.entries.forEach(function(e) {
				famTotals[e.family] = (famTotals[e.family] || 0) + e.pct;
			});
			Object.keys(famTotals).forEach(function(fam) {
				if (famTotals[fam] !== 100)
					errors.push(
						_('Tier %d %s shares must total 100%% (currently %d%%)').format(
							i + 1,
							fam === 'ipv4' ? 'IPv4' : 'IPv6',
							famTotals[fam]
						));
			});
		});

		/*
		 * Collision check: for each entry that would require a new member,
		 * verify the generated name is not already taken by a section with
		 * different values. A value-matching member is reused, so no collision
		 * can occur for it.
		 */
		state.tiers.forEach(function(tier, i) {
			var metric = i + 1;
			var byFam  = {};
			tier.entries.forEach(function(e) {
				if (!byFam[e.family]) byFam[e.family] = [];
				byFam[e.family].push(e);
			});
			['ipv4', 'ipv6'].forEach(function(fam) {
				var famEntries = byFam[fam];
				if (!famEntries || !famEntries.length) return;
				var weights = computeWeights(famEntries);
				famEntries.forEach(function(entry, j) {
					if (!entry.iface) return;
					var weight  = weights[j];
					var reuse   = findExistingMember(entry.iface, metric, weight);
					if (reuse) return;
					var mname   = entry.iface + '_m' + metric + '_w' + weight;
					var nameTaken = uci.sections('mwan3', 'member').some(function(sec) {
						return sec['.name'] === mname;
					});
					if (nameTaken)
						errors.push(
							_('Cannot create member "%s": name already in use with different settings. Rename or remove it first.').format(mname)
						);
				});
			});
		});

		return errors;
	},

	isValid: function() {
		return this.getErrors().length === 0;
	},

	/*
	 * Compute the policy specification from the current state, without writing
	 * anything. Returns the policy name and mode, the last-resort behaviour, the
	 * ordered member list, the members that must be created (with their option
	 * values), and the members that would be orphaned.
	 *
	 * Member naming: <iface>_m<metric>_w<weight>. Weight is the GCD-reduced form
	 * of the pct values within each family tier (or 1 for a single-entry tier).
	 * An existing member whose values match is reused by its actual name.
	 *
	 * Orphans are members in the policy's previous use_member list that the new
	 * list drops and that no other policy references.
	 */
	getValue: function() {
		var state = this.state;
		var pname = state.mode === 'new' ? state.newPolicyName : state.policyName;

		var oldMembers = [];
		if (state.mode === 'existing') {
			var cur = uci.get('mwan3', pname, 'use_member') || [];
			oldMembers = Array.isArray(cur) ? cur.slice() : [cur];
		}

		var useMembers      = [];
		var membersToCreate = [];

		state.tiers.forEach(function(tier, tierIdx) {
			var metric = tierIdx + 1;
			var byFam  = {};
			tier.entries.forEach(function(e) {
				if (!byFam[e.family]) byFam[e.family] = [];
				byFam[e.family].push(e);
			});

			['ipv4', 'ipv6'].forEach(function(fam) {
				var famEntries = byFam[fam];
				if (!famEntries || !famEntries.length) return;
				var weights = computeWeights(famEntries);

				famEntries.forEach(function(entry, j) {
					var weight   = weights[j];
					var existing = findExistingMember(entry.iface, metric, weight);
					var mname;
					if (existing) {
						mname = existing['.name'];
					} else {
						mname = entry.iface + '_m' + metric + '_w' + weight;
						membersToCreate.push({
							name:   mname,
							iface:  entry.iface,
							metric: metric,
							weight: weight
						});
					}
					useMembers.push(mname);
				});
			});
		});

		var newSet = {};
		useMembers.forEach(function(m) { newSet[m] = true; });
		var orphans = oldMembers.filter(function(mname) {
			if (newSet[mname]) return false;
			return !uci.sections('mwan3', 'policy').some(function(pol) {
				if (pol['.name'] === pname) return false;
				var pm = pol.use_member || [];
				if (!Array.isArray(pm)) pm = [pm];
				return pm.indexOf(mname) >= 0;
			});
		});

		return {
			isNew:           state.mode === 'new',
			policyName:      pname,
			lastResort:      state.lastResort,
			useMembers:      useMembers,
			membersToCreate: membersToCreate,
			orphans:         orphans
		};
	},

	/* Build the modal body node. */

	render: function() {
		var self = this;
		var ifacesByFamily = this.ifacesByFamily;

		var tiersContainer  = E('div', { 'class': 'mwan3-pb-tiers' });
		var errorsContainer = E('div', { 'class': 'mwan3-pb-errors' });
		this.tiersContainer  = tiersContainer;
		this.errorsContainer = errorsContainer;

		function updateErrors() {
			dom.content(errorsContainer, self.getErrors().map(function(err) {
				return E('div', { 'class': 'mwan3-pb-error ' + components.textClass('danger') }, err);
			}));
			self.onChange();
		}

		/* One entry row inside a tier: family, interface, percentage, remove. */

		function renderEntryRow(entry, entryIdx, tier, famCounts) {
			var isLocked = famCounts[entry.family] === 1;

			var famSel = new ui.Select(entry.family, { ipv4: 'IPv4', ipv6: 'IPv6' },
				{ widget: 'select', sort: ['ipv4', 'ipv6'] });
			var famNode = famSel.render();
			famNode.classList.add('mwan3-pb-fam');
			famNode.addEventListener('change', function() {
				entry.family = famSel.getValue();
				var avail = ifacesByFamily[entry.family] || [];
				entry.iface = avail[0] || '';
				var famGroups = {};
				tier.entries.forEach(function(e) {
					if (!famGroups[e.family]) famGroups[e.family] = [];
					famGroups[e.family].push(e);
				});
				Object.keys(famGroups).forEach(function(fam) {
					distributeEqual(famGroups[fam]);
				});
				refreshTiers();
			});

			var availIfaces = ifacesByFamily[entry.family] || [];
			var ifaceSel, ifaceNode;
			if (availIfaces.length) {
				if (!entry.iface || availIfaces.indexOf(entry.iface) < 0)
					entry.iface = availIfaces[0];
				var ifaceChoices = {};
				availIfaces.forEach(function(iface) { ifaceChoices[iface] = iface; });
				ifaceSel = new ui.Select(entry.iface, ifaceChoices,
					{ widget: 'select', sort: availIfaces });
				ifaceNode = ifaceSel.render();
				ifaceNode.addEventListener('change', function() {
					entry.iface = ifaceSel.getValue();
				});
			} else {
				ifaceSel = new ui.Select('', { '': _('(none)') }, { widget: 'select' });
				ifaceNode = ifaceSel.render();
				var sel = ifaceNode.querySelector('select');
				if (sel) sel.disabled = true;
			}
			ifaceNode.classList.add('mwan3-pb-iface');

			var pctField = new NumberField(String(entry.pct),
				{ min: 1, max: 100, readonly: isLocked });
			var pctNode = pctField.render();
			pctNode.classList.add('mwan3-pb-pct');
			if (isLocked) pctNode.classList.add('mwan3-pb-pct--locked');
			var pctInput = pctNode.querySelector('input');
			if (pctInput)
				pctInput.addEventListener('input', function() {
					var v = parseInt(pctField.getValue(), 10);
					if (!isNaN(v) && v >= 1 && v <= 100) entry.pct = v;
					updateErrors();
				});

			var removeBtn = E('button', {
				'class': 'cbi-button cbi-button-remove mwan3-pb-entry-rm',
				'title': _('Remove this entry'),
				'click': function(ev) {
					ev.preventDefault();
					var removedFam = entry.family;
					tier.entries.splice(entryIdx, 1);
					var remaining = tier.entries.filter(function(e) { return e.family === removedFam; });
					distributeEqual(remaining);
					refreshTiers();
				}
			}, '\u00d7');

			return E('div', { 'class': 'mwan3-pb-entry' },
				[famNode, ifaceNode, pctNode, E('span', {}, '%'), removeBtn]);
		}

		/* A complete tier block: header plus its entry rows and add button. */

		function renderTierBlock(tier, tierIdx) {
			var isOnlyTier = self.state.tiers.length === 1;

			var famCounts = {};
			tier.entries.forEach(function(e) {
				famCounts[e.family] = (famCounts[e.family] || 0) + 1;
			});

			var tierLabel = tierIdx === 0
				? _('Tier 1 - Primary')
				: _('Tier %d - Failover').format(tierIdx + 1);

			var entryRows = tier.entries.map(function(entry, entryIdx) {
				return renderEntryRow(entry, entryIdx, tier, famCounts);
			});

			var addEntryBtn = E('button', {
				'class': 'cbi-button mwan3-pb-add-entry',
				'click': function(ev) {
					ev.preventDefault();

					/* Default the new entry to the family already in the tier when
					   it is homogeneous, so adding to an all-IPv6 (or all-IPv4)
					   tier load-balances within that family. An empty or mixed
					   tier falls back to IPv4 where available. */

					var fams = {};
					tier.entries.forEach(function(e) { fams[e.family] = true; });
					var present = Object.keys(fams);
					var defaultFam = (present.length === 1)
						? present[0]
						: (ifacesByFamily.ipv4.length ? 'ipv4' : 'ipv6');
					var avail = ifacesByFamily[defaultFam] || [];
					tier.entries.push({ family: defaultFam, iface: avail[0] || '', pct: 0 });
					var same = tier.entries.filter(function(e) { return e.family === defaultFam; });
					distributeEqual(same);
					refreshTiers();
				}
			}, _('+ Add interface'));

			var removeTierBtn = E('button', {
				'class': 'cbi-button cbi-button-remove mwan3-pb-rm-tier',
				'disabled': isOnlyTier ? '' : null,
				'click': function(ev) {
					ev.preventDefault();
					if (!isOnlyTier) {
						self.state.tiers.splice(tierIdx, 1);
						refreshTiers();
					}
				}
			}, _('Remove tier'));

			return E('div', { 'class': 'mwan3-pb-tier' }, [
				E('div', { 'class': 'mwan3-pb-tier-head' }, [
					E('strong', {}, tierLabel),
					removeTierBtn
				])
			].concat(entryRows).concat([addEntryBtn]));
		}

		/* Rebuild all tier blocks and refresh the error list. */

		function refreshTiers() {
			dom.content(tiersContainer, self.state.tiers.map(function(tier, tierIdx) {
				return renderTierBlock(tier, tierIdx);
			}));
			updateErrors();
		}
		this.refreshTiers = refreshTiers;

		/* Policy selector. */

		var policyChoices = { '__new__': _('- New policy -') };
		var policyOrder   = ['__new__'];
		this.policies.forEach(function(p) {
			policyChoices[p['.name']] = p['.name'];
			policyOrder.push(p['.name']);
		});
		var policySel = new ui.Select(
			self.state.mode === 'existing' ? self.state.policyName : '__new__',
			policyChoices, { widget: 'select', sort: policyOrder });
		var policyNode = policySel.render();
		policyNode.classList.add('mwan3-pb-policy');
		this._policySel = policySel;

		var policyRow = E('div', {
			'class': 'mwan3-pb-row' + (self.state.mode === 'new' ? ' mwan3-hidden' : '')
		}, [
			E('label', { 'class': 'mwan3-pb-label' }, _('Policy:')),
			policyNode
		]);
		this._policyRow = policyRow;

		/* Name field, shown only for new policies. */

		var newNameField = new ui.Textfield(self.state.newPolicyName,
			{ placeholder: _('policy name'), maxlength: 15 });
		var newNameNode = newNameField.render();
		newNameNode.classList.add('mwan3-pb-name');
		var newNameInput = newNameNode.querySelector('input');
		if (newNameInput)
			newNameInput.addEventListener('input', function() {
				self.state.newPolicyName = newNameField.getValue();
				updateErrors();
			});
		var newNameRow = E('div', {
			'class': 'mwan3-pb-row' + (self.state.mode === 'new' ? '' : ' mwan3-hidden')
		}, [
			E('label', { 'class': 'mwan3-pb-label' }, _('Name:')),
			newNameNode
		]);
		this._newNameField = newNameField;
		this._newNameRow   = newNameRow;

		/* Last resort selector. */

		var lastResortSel = new ui.Select(self.state.lastResort, {
			'unreachable': _('unreachable (reject)'),
			'blackhole':   _('blackhole (drop)'),
			'default':     _('default (use main routing table)')
		}, { widget: 'select', sort: ['unreachable', 'blackhole', 'default'] });
		var lastResortNode = lastResortSel.render();
		lastResortNode.classList.add('mwan3-pb-lastresort');
		lastResortNode.addEventListener('change', function() {
			self.state.lastResort = lastResortSel.getValue();
		});
		this._lastResortSel = lastResortSel;

		policyNode.addEventListener('change', function() {
			var v = policySel.getValue();
			if (v === '__new__')
				self.setValue({
					mode:          'new',
					policyName:    '',
					newPolicyName: newNameField.getValue(),
					lastResort:    'unreachable',
					tiers:         [{ entries: [] }]
				});
			else
				self.setValue(self.stateFromPolicy(v));
		});

		var addTierBtn = E('button', {
			'class': 'cbi-button mwan3-pb-add-tier',
			'click': function(ev) {
				ev.preventDefault();
				self.state.tiers.push({ entries: [] });
				refreshTiers();
			}
		}, _('+ Add tier'));

		refreshTiers();

		return E('div', {}, [
			policyRow,
			newNameRow,
			E('div', { 'class': 'mwan3-pb-row' }, [
				E('label', { 'class': 'mwan3-pb-label' }, _('Last resort:')),
				lastResortNode
			]),
			E('hr', { 'class': 'mwan3-pb-hr' }),
			tiersContainer,
			addTierBtn,
			errorsContainer
		]);
	}
});

return baseclass.extend({
	NumberField:      NumberField,
	PolicyTierEditor: PolicyTierEditor
});
