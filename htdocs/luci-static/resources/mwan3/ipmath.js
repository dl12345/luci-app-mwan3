'use strict';
'require baseclass';
'require validation';

/* IPv4/IPv6 address, CIDR containment, set-membership and port-matching
   helpers. */

/* ---- IPv4 ---- */

function ipv4ToUint(ip) {
	var parts = ip.split('.');
	return ((parseInt(parts[0], 10) << 24) |
	        (parseInt(parts[1], 10) << 16) |
	        (parseInt(parts[2], 10) << 8)  |
	         parseInt(parts[3], 10)) >>> 0;
}

function ipv4InCidr(ip, cidr) {
	var slash = cidr.indexOf('/');
	if (slash < 0) return ip === cidr;
	var prefix  = parseInt(cidr.substring(slash + 1), 10);
	var mask    = prefix === 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
	var network = ipv4ToUint(cidr.substring(0, slash)) & mask;
	return (ipv4ToUint(ip) & mask) === network;
}

function ipv4CidrContains(a, b) {
	var slashA = a.indexOf('/'), slashB = b.indexOf('/');
	var prefA  = slashA < 0 ? 32 : parseInt(a.substring(slashA + 1), 10);
	var prefB  = slashB < 0 ? 32 : parseInt(b.substring(slashB + 1), 10);
	if (prefA > prefB) return false; /* A is more specific than B */
	var maskA   = prefA === 0 ? 0 : ((0xFFFFFFFF << (32 - prefA)) >>> 0);
	var netA    = (ipv4ToUint(slashA < 0 ? a : a.substring(0, slashA)) & maskA) >>> 0;
	var netB    = (ipv4ToUint(slashB < 0 ? b : b.substring(0, slashB)) & maskA) >>> 0;
	return netA === netB;
}

/* ---- IPv6 ---- */

function expandIPv6(ip) {
	var halves = ip.split('::');
	if (halves.length === 2) {
		var left  = halves[0] ? halves[0].split(':') : [];
		var right = halves[1] ? halves[1].split(':') : [];
		var fill  = 8 - left.length - right.length;
		for (var i = 0; i < fill; i++) left.push('0');
		return left.concat(right);
	}
	return ip.split(':');
}

function ipv6ToBigInt(ip) {
	var groups = expandIPv6(ip);
	var result = BigInt(0);
	for (var i = 0; i < 8; i++)
		result = (result << BigInt(16)) | BigInt(parseInt(groups[i] || '0', 16));
	return result;
}

function ipv6InCidr(ip, cidr) {
	var slash = cidr.indexOf('/');
	if (slash < 0) return ip.toLowerCase() === cidr.toLowerCase();
	var prefix  = parseInt(cidr.substring(slash + 1), 10);
	var allOnes = (BigInt(1) << BigInt(128)) - BigInt(1);
	var mask    = prefix === 0 ? BigInt(0)
	            : allOnes ^ ((BigInt(1) << BigInt(128 - prefix)) - BigInt(1));
	var ipInt   = ipv6ToBigInt(ip);
	var netInt  = ipv6ToBigInt(cidr.substring(0, slash));
	return (ipInt & mask) === (netInt & mask);
}

function ipv6CidrContains(a, b) {
	var slashA = a.indexOf('/'), slashB = b.indexOf('/');
	var prefA  = slashA < 0 ? 128 : parseInt(a.substring(slashA + 1), 10);
	var prefB  = slashB < 0 ? 128 : parseInt(b.substring(slashB + 1), 10);
	if (prefA > prefB) return false; /* A is more specific than B */
	var allOnes = (BigInt(1) << BigInt(128)) - BigInt(1);
	var maskA   = prefA === 0 ? BigInt(0) : allOnes ^ ((BigInt(1) << BigInt(128 - prefA)) - BigInt(1));
	var netA    = ipv6ToBigInt(slashA < 0 ? a : a.substring(0, slashA)) & maskA;
	var netB    = ipv6ToBigInt(slashB < 0 ? b : b.substring(0, slashB)) & maskA;
	return netA === netB;
}

/* ---- Family detection and dispatch ---- */

function isIPv6(ip) {
	return !!validation.parseIPv6(ip.split('/')[0]);
}

function ipInCidr(ip, cidr) {
	if (!ip || !cidr) return false;
	return isIPv6(ip) ? ipv6InCidr(ip, cidr) : ipv4InCidr(ip, cidr);
}

/* True if CIDR A contains CIDR B (A is a superset of B) */
function cidrContains(a, b) {
	if (a.indexOf(',') >= 0 || b.indexOf(',') >= 0) return false;
	var a_v6 = !!validation.parseIPv6(a.split('/')[0]);
	var b_v6 = !!validation.parseIPv6(b.split('/')[0]);
	if (a_v6 && b_v6) return ipv6CidrContains(a, b);
	if (!a_v6 && !b_v6) return ipv4CidrContains(a, b);
	return false;
}

/* ---- NFT set membership ---- */

function ipInSet(ip, members) {
	for (var i = 0; i < members.length; i++) {
		var m = members[i];
		if (m.indexOf('-') > 0 && !isIPv6(m)) {
			/* IPv4 range: a.b.c.d-a.b.c.e */
			var ends  = m.split('-');
			var start = ipv4ToUint(ends[0]);
			var end   = ipv4ToUint(ends[1]);
			var addr  = ipv4ToUint(ip);
			if (addr >= start && addr <= end) return true;
		} else if (m.indexOf('/') >= 0) {
			if (ipInCidr(ip, m)) return true;
		} else if (m === ip) {
			return true;
		}
	}
	return false;
}

/* ---- Port matching ---- */

function portMatches(port, spec) {
	/* port: user input string or ''; spec: UCI rule value or undefined */
	if (!spec) return true;   /* rule has no port constraint */
	if (!port) return true;   /* no port entered, treat as wildcard */
	var p = parseInt(port, 10);
	if (isNaN(p)) return false;
	var parts = spec.split(',');
	for (var i = 0; i < parts.length; i++) {
		var part = parts[i].trim();
		if (part.indexOf(':') >= 0) {
			var range = part.split(':');
			if (p >= parseInt(range[0], 10) && p <= parseInt(range[1], 10)) return true;
		} else if (parseInt(part, 10) === p) {
			return true;
		}
	}
	return false;
}

return baseclass.extend({
	ipv4ToUint: ipv4ToUint,
	ipv4InCidr: ipv4InCidr,
	ipv4CidrContains: ipv4CidrContains,
	expandIPv6: expandIPv6,
	ipv6ToBigInt: ipv6ToBigInt,
	ipv6InCidr: ipv6InCidr,
	ipv6CidrContains: ipv6CidrContains,
	isIPv6: isIPv6,
	ipInCidr: ipInCidr,
	cidrContains: cidrContains,
	ipInSet: ipInSet,
	portMatches: portMatches,
});
