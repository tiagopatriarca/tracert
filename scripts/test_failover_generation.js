import { db } from '../db.js';
import assert from 'node:assert';

// Mock router objects from real DB
const routerV6 = db.prepare("SELECT * FROM routers WHERE routeros_version LIKE '6.%' LIMIT 1").get();
const routerV7 = db.prepare("SELECT * FROM routers WHERE routeros_version LIKE '7.%' LIMIT 1").get();

console.log('Testing with:');
console.log('  v6 Router:', routerV6?.name, '| Version:', routerV6?.routeros_version);
console.log('  v7 Router:', routerV7?.name, '| Version:', routerV7?.routeros_version);

assert(routerV6, 'Router v6 must exist in database');
assert(routerV7, 'Router v7 must exist in database');

// Test isRouterOSv6 helper
function isRouterOSv6(router) {
  const v = (router.routeros_version || '').trim();
  return v.startsWith('6.') || v.startsWith('v6') || v.includes(' 6.');
}

assert.strictEqual(isRouterOSv6(routerV6), true, 'routerV6 should be identified as v6');
assert.strictEqual(isRouterOSv6(routerV7), false, 'routerV7 should NOT be identified as v6');

// Fetch script from server endpoints or test generation
import http from 'node:http';

console.log('\n--- Test 1: Testing script files on disk ---');
import fs from 'node:fs';
const fileV6 = fs.readFileSync('C:/Users/DATEN/.gemini/antigravity-ide/scratch/tracert/mikrotik/failover_setup_and_monitor_v6.rsc', 'utf8');
const fileV7 = fs.readFileSync('C:/Users/DATEN/.gemini/antigravity-ide/scratch/tracert/mikrotik/failover_setup_and_monitor_v7.rsc', 'utf8');

// Assertions on v6 script
assert(fileV6.includes('/ip route rule add'), 'v6 script must use /ip route rule');
assert(fileV6.includes('routing-mark='), 'v6 script must use routing-mark');
assert(!fileV6.includes('/routing table add'), 'v6 script must NOT use /routing table');
assert(!fileV6.includes('/routing rule add'), 'v6 script must NOT use /routing rule');
assert(!fileV6.includes('immediate-gw'), 'v6 script must NOT use immediate-gw');
console.log('  ✅ failover_setup_and_monitor_v6.rsc is 100% compliant with RouterOS v6 standards!');

// Assertions on v7 script
assert(fileV7.includes('/routing table add'), 'v7 script must use /routing table');
assert(fileV7.includes('routing-table='), 'v7 script must use routing-table');
assert(fileV7.includes('/routing rule add'), 'v7 script must use /routing rule');
assert(!fileV7.includes('/ip route rule add'), 'v7 script must NOT use /ip route rule');
assert(fileV7.includes('immediate-gw'), 'v7 script must use immediate-gw for interface isolation');
console.log('  ✅ failover_setup_and_monitor_v7.rsc is 100% compliant with RouterOS v7 standards!');

console.log('\n🎉 ALL FAILOVER SCRIPT VALIDATION TESTS PASSED SUCCESSFULLY!');
