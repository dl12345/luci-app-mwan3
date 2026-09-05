// Read-only shell fixtures. No router connection or network/configuration writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../root/usr/libexec/luci-mwan3'), 'utf8');
const routes = source.slice(source.indexOf('diag_routes() {'), source.indexOf('diag_cmd() {'));
function run(family, id = 5) {
	return spawnSync('sh', ['-c', `
ID=0
config_load() { :; }
config_foreach() { ID=${id}; }
config_get() { family=${family}; }
ip() { printf 'ip'; printf ' <%s>' "$@"; }
${routes}
diag_routes fixture
`], {encoding:'utf8'});
}
assert.match(run('ipv4').stdout, /ip <-4> <route> <list> <table> <5>/);
assert.match(run('ipv6').stdout, /ip <-6> <route> <list> <table> <5>/);
assert.equal(run('invalid').status, 2);
assert.equal(run('ipv6', 0).status, 2);
const rules = source.slice(source.indexOf('diag_rules() {'), source.indexOf('diag_routes() {'));
const failure = spawnSync('sh', ['-c', `ubus() { return 73; }\n${rules}\ndiag_rules fixture`], {encoding:'utf8'});
assert.notEqual(failure.status, 0);
assert.equal(failure.stdout, '');
console.log('5 diagnostic helper checks passed');
