'use strict';
'require baseclass';

/* Default mwan3 rule-base priorities and firewall mask. iif, fwmark and
   unreachable mirror the defaults of the matching UCI options under
   mwan3.globals, applied when those options are unset. src has no UCI
   option of its own: it is the derived source-rule base (unreachable
   base + interface maximum + 1), which is 3061 with the default bases
   and 0x3F00 mask. These mirror the core mwan3 package; keep them in
   step with it. */

return baseclass.extend({
	RULE_BASE_DEFAULTS: { iif: 1000, fwmark: 2000, unreachable: 3000, src: 3061 },
	MMX_MASK_DEFAULT:   '0x3F00',
});
