'use strict';
'require baseclass';
'require uci';
'require validation';

/* Shared validation helpers for the network configuration views. */

/* Workaround shim: the stock datatype validator overwrites this.value before
   it reaches a custom validate function, so format checks call a type
   function directly instead of relying on a plain o.datatype. Use it only for
   types the framework publishes no parser for; address checks go through
   ipAddrOrPrefix() or ipv6Cidr() below. It must never be given list(), which
   writes to this.field, a member the shim does not provide. */

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

/* True for an IPv4 or IPv6 address, optionally carrying a prefix length or,
   for IPv4, a dotted netmask. Accepts what the ipaddr datatype accepts. */

function ipAddrOrPrefix(value) {
	var m = value.match(/^(\d+\.\d+\.\d+\.\d+)(?:\/(\d+\.\d+\.\d+\.\d+)|\/(\d{1,2}))?$/);
	if (m && validation.parseIPv4(m[1]) && (m[2] ? validation.parseIPv4(m[2]) : (m[3] ? +m[3] <= 32 : true)))
		return true;
	m = value.match(/^([0-9a-fA-F:.]+)(?:\/(\d{1,3}))?$/);
	return !!(m && validation.parseIPv6(m[1]) && (m[2] ? +m[2] <= 128 : true));
}

/* True for an IPv6 address carrying a prefix length within the inclusive
   range minPrefix to maxPrefix. The prefix is mandatory. */

function ipv6Cidr(value, minPrefix, maxPrefix) {
	var m = value.match(/^([0-9a-fA-F:.]+)\/(\d{1,3})$/);
	return !!(m && validation.parseIPv6(m[1]) && +m[2] >= minPrefix && +m[2] <= maxPrefix);
}

/* Entries of a comma-separated MAC address option as an array. Accepts the
   stored string or an already split array, trims each entry and drops empty
   ones. Entries are folded to upper case, matching the case the host hints
   use, so two spellings of one address cannot appear as separate items. */

function parseMacList(value) {
	var list = Array.isArray(value) ? value : String(value != null ? value : '').split(',');
	return list.map(function(entry) {
		return String(entry).trim().toUpperCase();
	}).filter(function(entry) {
		return entry.length > 0;
	});
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
	ipAddrOrPrefix: ipAddrOrPrefix,
	ipv6Cidr: ipv6Cidr,
	parseMacList: parseMacList,
	sectionNameInUse: sectionNameInUse,
});
