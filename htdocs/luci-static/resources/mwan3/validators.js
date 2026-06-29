'use strict';
'require baseclass';
'require uci';
'require validation';

/* Shared validation helpers for the network configuration views. */

/* Workaround shim: the stock datatype validator overwrites this.value before
   it reaches a custom validate function, so format checks call this stub
   directly instead of relying on a plain o.datatype. */

function stub() {
	return {
		factory: validation,
		apply: function(type, value, args) {
			if (value != null)
				this.value = value;
			return validation.types[type].apply(this, args);
		},
		assert: function(condition) {
			return !!condition;
		}
	};
}

/* Address family of an address, CIDR or comma-separated list (the first
   element decides). Returns 'ipv4', 'ipv6', or null for an empty value. */

function ipFamily(ip) {
	if (!ip || ip.length === 0) return null;
	var first = ip.split(',')[0].trim().split('/')[0];
	return validation.parseIPv6(first) ? 'ipv6' : 'ipv4';
}

/* True if a name is already used by an interface, member, policy or rule
   section, optionally ignoring the section whose name is exceptName. */

function sectionNameInUse(value, exceptName) {
	var sections = [
		...uci.sections('mwan3', 'interface'),
		...uci.sections('mwan3', 'member'),
		...uci.sections('mwan3', 'policy'),
		...uci.sections('mwan3', 'rule')
	];
	for (var j = 0; j < sections.length; j++) {
		if (exceptName != null && sections[j]['.name'] === exceptName)
			continue;
		if (sections[j]['.name'] === value)
			return true;
	}
	return false;
}

return baseclass.extend({
	stub: stub,
	ipFamily: ipFamily,
	sectionNameInUse: sectionNameInUse,
});
