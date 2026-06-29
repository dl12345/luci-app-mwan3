'use strict';
'require baseclass';

/* Default mwan3 rule-base priorities and firewall mask, applied when the
   corresponding UCI option under mwan3.globals is unset. These mirror the
   defaults the core mwan3 package uses; keep them in step with it. */

return baseclass.extend({
	RULE_BASE_DEFAULTS: { iif: 1000, fwmark: 2000, unreachable: 3000 },
	MMX_MASK_DEFAULT:   '0x3F00',
});
