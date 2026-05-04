'use strict';
'require form';
'require view';
'require uci';
'require ui';

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('mwan3')
		]);
	},

	render: function () {
		let m, s, o;

		/* ── Lookup tables ──────────────────────────────────────────── */
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

		/* ── Phase 1: Behaviour annotation ─────────────────────────── */

		/*
		 * Derive a plain-English description of a policy's routing behaviour
		 * from its use_member list.  Returns a \n-separated string, one line
		 * per address family.
		 */
		function deriveBehaviour(section_id) {
			var useMembers = uci.get('mwan3', section_id, 'use_member') || [];
			if (!Array.isArray(useMembers)) useMembers = [useMembers];
			if (!useMembers.length) return _('No members configured');

			var byFamily   = {};
			var hasMissing = false;

			useMembers.forEach(function(mname) {
				var info = memberInfo[mname];
				if (!info) { hasMissing = true; return; }
				var fam = info.family;
				if (!byFamily[fam]) byFamily[fam] = {};
				if (!byFamily[fam][info.metric]) byFamily[fam][info.metric] = [];
				byFamily[fam][info.metric].push({ iface: info.iface, weight: info.weight });
			});

			function tierStr(entries) {
				if (entries.length === 1) return entries[0].iface;
				var total = entries.reduce(function(a, e) { return a + e.weight; }, 0);
				return '(' + entries.map(function(e) {
					return e.iface + ' ' + Math.round(e.weight * 100 / total) + '%';
				}).join(', ') + ')';
			}

			var parts = [];
			['ipv4', 'ipv6'].forEach(function(fam) {
				if (!byFamily[fam]) return;
				var label   = fam === 'ipv4' ? 'IPv4' : 'IPv6';
				var metrics = Object.keys(byFamily[fam]).map(Number).sort(function(a, b) { return a - b; });
				var entries = byFamily[fam][metrics[0]];
				var desc;

				if (metrics.length === 1 && entries.length === 1) {
					desc = entries[0].iface;
				} else if (metrics.length === 1) {
					var total = entries.reduce(function(a, e) { return a + e.weight; }, 0);
					desc = _('Load balanced') + ': (' + entries.map(function(e) {
						return e.iface + ' ' + Math.round(e.weight * 100 / total) + '%';
					}).join(', ') + ')';
				} else {
					desc = _('Failover') + ': ' + metrics.map(function(metric) {
						return tierStr(byFamily[fam][metric]);
					}).join(' --> ');
				}

				parts.push(label + ': ' + desc);
			});

			if (hasMissing)
				parts.push('(' + _('some members undefined') + ')');

			return parts.join('\n') || _('No members configured');
		}

		/*
		 * Return the plain-English description for a single address family,
		 * without any family-label prefix.  Used by the split IPv4/IPv6 columns.
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
			}).join(' → ');

			if (hasMissing) desc += ' (' + _('some members undefined') + ')';
			return desc;
		}

		/* ── Phase 2: Policy Builder ────────────────────────────────── */

		function gcd(a, b) { return b ? gcd(b, a % b) : a; }
		function gcdList(arr) { return arr.reduce(gcd); }

		/*
		 * Compute GCD-reduced integer weights from a family entry list.
		 * Single entry always gets weight 1.  Used by both getErrors and doSave
		 * so the two agree on the member name that would be generated.
		 */
		function computeWeights(famEntries) {
			if (famEntries.length === 1) return [1];
			var pcts = famEntries.map(function(e) { return e.pct; });
			var g    = gcdList(pcts);
			return pcts.map(function(p) { return p / g; });
		}

		/*
		 * Find an existing member section whose option values exactly match
		 * (iface, metric, weight).  Returns the section object or undefined.
		 * This is the reuse check: any matching member is reused regardless
		 * of its name.
		 */
		function findExistingMember(iface, metric, weight) {
			return uci.sections('mwan3', 'member').find(function(sec) {
				return (sec.interface || '')              === iface  &&
				       parseInt(sec.metric || '1', 10)   === metric &&
				       parseInt(sec.weight || '1', 10)   === weight;
			});
		}

		/*
		 * Redistribute a list of entries of the same family so their pct
		 * values sum to 100, as equally as possible.  The first entry
		 * absorbs any rounding remainder.
		 */
		function distributeEqual(famEntries) {
			var n = famEntries.length;
			if (!n) return;
			if (n === 1) { famEntries[0].pct = 100; return; }
			var share = Math.floor(100 / n);
			famEntries.forEach(function(e) { e.pct = share; });
			famEntries[0].pct = 100 - share * (n - 1);
		}

		/*
		 * Build a modal state object from an existing policy's UCI config.
		 * Tiers are derived from member metric values (ascending metric = tier 1, 2, ...).
		 * Percentage shares within each tier are computed from weight ratios.
		 */
		function stateFromPolicy(pname) {
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
		}

		/*
		 * Return an array of user-visible error strings describing why the
		 * current state cannot be saved.  Empty array means state is valid.
		 */
		function getErrors(state) {
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
					var taken = [].concat(
						uci.sections('mwan3', 'interface'),
						uci.sections('mwan3', 'member'),
						uci.sections('mwan3', 'policy'),
						uci.sections('mwan3', 'rule')
					).map(function(sec) { return sec['.name']; });
					if (taken.indexOf(nm) >= 0)
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
			 * different values.  If a value-matching member already exists it
			 * will be reused and no name collision can occur.
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
						if (reuse) return; /* will reuse — no create, no collision */
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
		}

		/*
		 * Write UCI creates/sets for the policy builder state, then call
		 * uci.save() and reload the page.
		 *
		 * Member naming: <iface>_m<metric>_w<weight>  (same as manual convention)
		 * Weight is the GCD-reduced form of the pct values within each
		 * family tier (or 1 for a single-entry family tier).
		 * Any existing member whose (interface, metric, weight) values match is
		 * reused by its actual name regardless of what that name is.  A new
		 * section is created only when no value-match exists; collision with a
		 * differently-configured same-named section is prevented by getErrors().
		 *
		 * After saving, members that were in the old use_member list but are no
		 * longer referenced by any policy are offered to the user for deletion
		 * via showOrphanCleanup().
		 */
		function doSave(state, saveBtn) {
			saveBtn.disabled    = true;
			saveBtn.textContent = _('Saving...');

			var pname = state.mode === 'new' ? state.newPolicyName : state.policyName;

			/* Capture old member list before any changes for orphan detection. */
			var oldMembers = [];
			if (state.mode === 'existing') {
				var cur = uci.get('mwan3', pname, 'use_member') || [];
				oldMembers = Array.isArray(cur) ? cur.slice() : [cur];
			}

			var useMembers = [];

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
							uci.add('mwan3', 'member', mname);
							uci.set('mwan3', mname, 'interface', entry.iface);
							uci.set('mwan3', mname, 'metric',    String(metric));
							uci.set('mwan3', mname, 'weight',    String(weight));
						}
						useMembers.push(mname);
					});
				});
			});

			if (state.mode === 'new')
				uci.add('mwan3', 'policy', pname);

			uci.set('mwan3', pname, 'use_member', useMembers);
			uci.set('mwan3', pname, 'last_resort', state.lastResort);

			/*
			 * Compute orphans against the updated UCI cache.  At this point
			 * the policy's use_member list already reflects useMembers, so a
			 * simple scan of all policies correctly identifies members that are
			 * no longer referenced by anything.
			 */
			var newSet = {};
			useMembers.forEach(function(m) { newSet[m] = true; });
			var orphans = oldMembers.filter(function(mname) {
				if (newSet[mname]) return false;
				return !uci.sections('mwan3', 'policy').some(function(pol) {
					var pm = pol.use_member || [];
					if (!Array.isArray(pm)) pm = [pm];
					return pm.indexOf(mname) >= 0;
				});
			});

			var autoDelete = localStorage.getItem('mwan3.autoDeleteMembers') !== '0';
			if (autoDelete)
				orphans.forEach(function(mname) { uci.remove('mwan3', mname); });

			uci.save().then(function() {
				ui.hideModal();
				if (orphans.length && !autoDelete)
					showOrphanCleanup(orphans);
				else
					window.location.reload();
			}).catch(function(err) {
				saveBtn.disabled    = false;
				saveBtn.textContent = _('Save');
				ui.addNotification(null, E('p', {}, _('Save failed: ') + err), 'danger');
			});
		}

		/*
		 * Show a modal listing orphaned member sections (no longer referenced
		 * by any policy) with checkboxes so the user can selectively delete them.
		 */
		function showOrphanCleanup(orphans) {
			var items = orphans.map(function(mname) {
				var cb = E('input', { 'type': 'checkbox', 'checked': '' });
				return {
					cb:    cb,
					mname: mname,
					row:   E('div', { 'style': 'display:flex; align-items:center; gap:8px; margin:3px 0' }, [
						cb, E('code', {}, mname)
					])
				};
			});

			var deleteBtn = E('button', {
				'class': 'cbi-button cbi-button-remove',
				'click': function(ev) {
					ev.preventDefault();
					items.forEach(function(item) {
						if (item.cb.checked) uci.remove('mwan3', item.mname);
					});
					uci.save().then(function() {
						ui.hideModal();
						window.location.reload();
					}).catch(function(err) {
						ui.addNotification(null, E('p', {}, _('Delete failed: ') + err), 'danger');
					});
				}
			}, _('Delete selected'));

			ui.showModal(_('Orphaned members'), [
				E('p', {}, _('The following members are no longer referenced by any policy. Select those to delete:')),
				E('div', {
					'style': 'margin:8px 0 12px; padding:8px; border:1px solid #ccc; border-radius:4px'
				}, items.map(function(item) { return item.row; })),
				E('div', {
					'style': 'display:flex; gap:8px; justify-content:flex-end; border-top:1px solid #ccc; padding-top:10px'
				}, [
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

		/*
		 * Open the Policy Builder modal.  The modal maintains a `state`
		 * object describing the policy being edited; tier blocks are re-rendered
		 * in-place on every user interaction that changes structure.
		 */
		function openPolicyBuilder(opts) {
			opts = opts || {};
			var policies = uci.sections('mwan3', 'policy');

			var state;
			if (opts.mode === 'edit' && opts.policyName) {
				state = stateFromPolicy(opts.policyName);
			} else {
				state = {
					mode:          'new',
					policyName:    '',
					newPolicyName: opts.newPolicyName || '',
					lastResort:    'unreachable',
					tiers:         [{ entries: [] }]
				};
			}

			/* These DOM nodes are created once and mutated as state changes. */
			var tiersContainer  = E('div');
			var errorsContainer = E('div', { 'style': 'margin-top:6px; min-height:1em' });
			var saveBtn = E('button', {
				'class': 'cbi-button cbi-button-save',
				'click': function(ev) { ev.preventDefault(); doSave(state, saveBtn); }
			}, _('Save'));

			function updateErrors() {
				var errors = getErrors(state);
				errorsContainer.textContent = '';
				errors.forEach(function(err) {
					errorsContainer.appendChild(
						E('div', { 'style': 'color:#d9534f; font-size:0.9em; margin:2px 0' }, err));
				});
				saveBtn.disabled = errors.length > 0;
			}

			/*
			 * Render a single entry row inside a tier.
			 * famCounts: map of family -> count of entries with that family in this tier.
			 */
			function renderEntryRow(entry, entryIdx, tier, famCounts) {
				var isLocked = famCounts[entry.family] === 1;

				var famSel = E('select', {
					'style': 'width:5.5em',
					'change': function() {
						entry.family = famSel.value;
						var avail = ifacesByFamily[entry.family] || [];
						entry.iface = avail[0] || '';
						/* Redistribute all families after a family change. */
						var famGroups = {};
						tier.entries.forEach(function(e) {
							if (!famGroups[e.family]) famGroups[e.family] = [];
							famGroups[e.family].push(e);
						});
						Object.keys(famGroups).forEach(function(fam) {
							distributeEqual(famGroups[fam]);
						});
						refreshTiers();
					}
				});
				famSel.appendChild(E('option', { value: 'ipv4' }, 'IPv4'));
				famSel.appendChild(E('option', { value: 'ipv6' }, 'IPv6'));
				famSel.value = entry.family;

				var availIfaces = ifacesByFamily[entry.family] || [];
				var ifaceSel = E('select', {
					'style': 'width:7em',
					'change': function() { entry.iface = ifaceSel.value; }
				});
				if (availIfaces.length) {
					availIfaces.forEach(function(iface) {
						ifaceSel.appendChild(E('option', { value: iface }, iface));
					});
					ifaceSel.value = entry.iface || availIfaces[0];
					entry.iface = ifaceSel.value;
				} else {
					ifaceSel.appendChild(E('option', { value: '' }, _('(none)')));
					ifaceSel.disabled = true;
				}

				var pctInput = E('input', {
					'type':     'number',
					'min':      '1',
					'max':      '100',
					'value':    String(entry.pct),
					'style':    'width:3.5em' + (isLocked ? '; opacity:0.6' : ''),
					'readonly': isLocked ? '' : null,
					'input':    function() {
						var v = parseInt(pctInput.value, 10);
						if (!isNaN(v) && v >= 1 && v <= 100) entry.pct = v;
						updateErrors();
					}
				});

				var removeBtn = E('button', {
					'class': 'cbi-button cbi-button-remove',
					'style': 'padding:1px 6px',
					'title': _('Remove this entry'),
					'click': function(ev) {
						ev.preventDefault();
						var removedFam = entry.family;
						tier.entries.splice(entryIdx, 1);
						var remaining = tier.entries.filter(function(e) { return e.family === removedFam; });
						distributeEqual(remaining);
						refreshTiers();
					}
				}, '×');

				return E('div', {
					'style': 'display:flex; gap:6px; align-items:center; margin:3px 0'
				}, [famSel, ifaceSel, pctInput, E('span', {}, '%'), removeBtn]);
			}

			/* Render a complete tier block including its header and entry rows. */
			function renderTierBlock(tier, tierIdx) {
				var isOnlyTier = state.tiers.length === 1;

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
					'class': 'cbi-button',
					'style': 'margin-top:5px; padding:1px 8px; font-size:0.9em',
					'click': function(ev) {
						ev.preventDefault();
						var defaultFam   = ifacesByFamily.ipv4.length ? 'ipv4' : 'ipv6';
						var avail        = ifacesByFamily[defaultFam] || [];
						tier.entries.push({ family: defaultFam, iface: avail[0] || '', pct: 0 });
						var same = tier.entries.filter(function(e) { return e.family === defaultFam; });
						distributeEqual(same);
						refreshTiers();
					}
				}, _('+ Add interface'));

				var removeTierBtn = E('button', {
					'class': 'cbi-button cbi-button-remove',
					'style': 'padding:1px 8px; font-size:0.9em',
					'disabled': isOnlyTier ? '' : null,
					'click': function(ev) {
						ev.preventDefault();
						if (!isOnlyTier) {
							state.tiers.splice(tierIdx, 1);
							refreshTiers();
						}
					}
				}, _('Remove tier'));

				return E('div', {
					'style': 'border:1px solid #ccc; border-radius:4px; padding:8px 10px; margin-bottom:8px'
				}, [
					E('div', { 'style': 'display:flex; justify-content:space-between; align-items:center; margin-bottom:6px' }, [
						E('strong', {}, tierLabel),
						removeTierBtn
					])
				].concat(entryRows).concat([addEntryBtn]));
			}

			/* Rebuild all tier blocks inside tiersContainer and refresh errors. */
			function refreshTiers() {
				tiersContainer.textContent = '';
				state.tiers.forEach(function(tier, tierIdx) {
					tiersContainer.appendChild(renderTierBlock(tier, tierIdx));
				});
				updateErrors();
			}

			/* Policy selector dropdown. */
			var policySelect = E('select', {
				'style': 'width:13em',
				'change': function() {
					if (policySelect.value === '__new__') {
						state = {
							mode:          'new',
							policyName:    '',
							newPolicyName: newNameInput.value,
							lastResort:    'unreachable',
							tiers:         [{ entries: [] }]
						};
						newNameRow.style.display = '';
					} else {
						state = stateFromPolicy(policySelect.value);
						newNameRow.style.display = 'none';
					}
					lastResortSel.value = state.lastResort;
					refreshTiers();
				}
			});
			policySelect.appendChild(E('option', { value: '__new__' }, _('- New policy -')));
			policies.forEach(function(p) {
				policySelect.appendChild(E('option', { value: p['.name'] }, p['.name']));
			});
			if (opts.mode === 'edit' && opts.policyName)
				policySelect.value = opts.policyName;
			else
				policySelect.value = '__new__';

			/* Name input shown only for new policies. */
			var newNameInput = E('input', {
				'type':        'text',
				'placeholder': _('policy name'),
				'maxlength':   '15',
				'style':       'width:10em',
				'value':       state.newPolicyName,
				'input':       function() {
					state.newPolicyName = newNameInput.value;
					updateErrors();
				}
			});
			var newNameRow = E('div', {
				'style': 'display:' + (state.mode === 'new' ? 'flex' : 'none') + '; align-items:center; gap:8px; margin-bottom:8px'
			}, [
				E('label', { 'style': 'min-width:7em; text-align:right' }, _('Name:')),
				newNameInput
			]);

			/* Last resort selector. */
			var lastResortSel = E('select', { 'style': 'width:13em' });
			lastResortSel.appendChild(E('option', { value: 'unreachable' }, _('unreachable (reject)')));
			lastResortSel.appendChild(E('option', { value: 'blackhole' },   _('blackhole (drop)')));
			lastResortSel.appendChild(E('option', { value: 'default' },     _('default (use main routing table)')));
			lastResortSel.value = state.lastResort;
			lastResortSel.addEventListener('change', function() { state.lastResort = lastResortSel.value; });

			/* Add tier button. */
			var addTierBtn = E('button', {
				'class': 'cbi-button',
				'style': 'margin-top:4px; margin-bottom:4px; padding:2px 8px',
				'click': function(ev) {
					ev.preventDefault();
					state.tiers.push({ entries: [] });
					refreshTiers();
				}
			}, _('+ Add tier'));

			/* Initial render. */
			refreshTiers();

			ui.showModal(_('Policy Builder'), [
				E('div', { 'style': 'display:flex; align-items:center; gap:8px; margin-bottom:8px' }, [
					E('label', { 'style': 'min-width:7em; text-align:right' }, _('Policy:')),
					policySelect
				]),
				newNameRow,
				E('div', { 'style': 'display:flex; align-items:center; gap:8px; margin-bottom:10px' }, [
					E('label', { 'style': 'min-width:7em; text-align:right' }, _('Last resort:')),
					lastResortSel
				]),
				E('hr', { 'style': 'margin:6px 0 10px' }),
				tiersContainer,
				addTierBtn,
				errorsContainer,
				E('div', {
					'style': 'display:flex; gap:8px; justify-content:flex-end; margin-top:12px; padding-top:10px; border-top:1px solid #ccc'
				}, [
					E('button', {
						'class': 'cbi-button',
						'click': function(ev) { ev.preventDefault(); ui.hideModal(); }
					}, _('Dismiss')),
					saveBtn
				])
			]);

			/* Align top of modal with first data row of the policy grid. */
			requestAnimationFrame(function() {
				var overlay = document.querySelector('#modal_overlay');
				if (!overlay) return;
				var anchor = document.querySelector('table.cbi-section-table tbody tr') ||
				             document.querySelector('table.cbi-section-table');
				var top = anchor ? Math.round(anchor.getBoundingClientRect().top) : 0;
				overlay.style.alignItems   = 'flex-start';
				overlay.style.overflowY    = 'auto';
				if (overlay.firstElementChild)
					overlay.firstElementChild.style.marginTop = Math.max(0, top) + 'px';
			});
		}

		/* ── Form ───────────────────────────────────────────────────── */

		m = new form.Map('mwan3', _('MultiWAN Manager - Policies'),
			_('Policies control how mwan3 distributes traffic.') + '<br />' +
			_('Policies may not share the same name as interfaces, members or rules.') + '<br />' +
			_('Policy names must be alphanumeric with underscore and <= 15 characters.'));

		s = m.section(form.GridSection, 'policy');
		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;

		s.renderRowActions = function(section_id) {
			var tdEl = form.GridSection.prototype.renderRowActions.apply(this, [section_id]);
			var editBtn = tdEl.querySelector('.cbi-button-edit');
			if (editBtn) {
				var newBtn = editBtn.cloneNode(true);
				newBtn.addEventListener('click', function(ev) {
					ev.preventDefault();
					openPolicyBuilder({ mode: 'edit', policyName: section_id });
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
				let sections = [
					...uci.sections('mwan3', 'interface'),
					...uci.sections('mwan3', 'member'),
					...uci.sections('mwan3', 'policy'),
					...uci.sections('mwan3', 'rule')
				];
				for (let j = 0; j < sections.length; j++) {
					if (sections[j]['.name'] == v)
						return _('Policies may not share the same name as configured interfaces, members or rules');
				}
				if (v.length > 15) return _('Name length shall not exceed 15 characters');
				return true;
			}, 'blur', 'keyup');

			/* Remove the default Add button -- the builder button replaces it. */
			var addBtn = el.querySelector('.cbi-button-add');
			if (addBtn) addBtn.remove();

			el.appendChild(E('div', { 'style': 'margin-top:6px' }, [
				E('button', {
					'class': 'cbi-button cbi-button-add',
					'click': function(ev) {
						ev.preventDefault();
						openPolicyBuilder({ mode: 'new', newPolicyName: nameEl.value });
					}
				}, _('Add...'))
			]));

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
			var autoDelete = localStorage.getItem('mwan3.autoDeleteMembers') !== '0';
			var cb = E('input', { 'type': 'checkbox', 'id': 'pref_delete_members',
				'change': function() {
					localStorage.setItem('mwan3.autoDeleteMembers', this.checked ? '1' : '0');
				}
			});
			cb.checked = autoDelete;
			var h2 = node.querySelector('h2[name="content"]');
			if (h2) {
				var titleText = h2.textContent;
				h2.textContent = '';
				h2.style.cssText = 'display:flex; align-items:center; justify-content:space-between;';
				h2.appendChild(E('span', {}, [titleText]));
				h2.appendChild(E('label', {
					'for': 'pref_delete_members',
					'style': 'font-size:1rem; font-weight:normal; display:flex; align-items:center; gap:0.5em; cursor:pointer;'
				}, [_('Delete unused member definitions'), cb]));
			}
			return node;
		});
	}
})
