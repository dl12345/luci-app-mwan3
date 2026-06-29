'use strict';
'require baseclass';

/* Value formatters shared across the status views. */

function formatDuration(secs) {
	var d = Math.floor(secs / 86400);
	var h = Math.floor((secs % 86400) / 3600);
	var m = Math.floor((secs % 3600) / 60);
	var parts = [];
	if (d > 0) parts.push(d + 'd');
	if (d > 0 || h > 0) parts.push(h + 'h');
	parts.push(m + 'm');
	return parts.join(' ');
}

function fmtBytes(n) {
	if (n == null || n < 0) return '-';
	if (n < 1024)        return n + ' B';
	if (n < 1048576)     return (n / 1024).toFixed(1) + ' KiB';
	if (n < 1073741824)  return (n / 1048576).toFixed(1) + ' MiB';
	return (n / 1073741824).toFixed(2) + ' GiB';
}

function fmtAddr(addr, port) {
	var a = (addr && addr.length > 0) ? addr : null;
	var p = (port && port.length > 0) ? port : null;
	if (a && p) return a + ':' + p;
	if (a) return a;
	if (p) return '*:' + p;
	return null;
}

return baseclass.extend({
	formatDuration: formatDuration,
	fmtBytes: fmtBytes,
	fmtAddr: fmtAddr,
});
