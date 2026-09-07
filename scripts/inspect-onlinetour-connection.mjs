// Read-only transport diagnostic. No attachment, navigation or account content.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(import.meta.url);
require('tsx/cjs');
const { connectDedicatedChrome } = require('../src/lib/onlinetour-browser-adapter.ts');
const reasons = new Set(['dedicated_chrome_discovery_failed', 'cdp_connect_deadline', 'cdp_connect_failed']);
let client;
const startedAt = Date.now();
if (process.argv.length !== 3 || process.argv[2] !== '--consent-confirmed') {
    console.error('Explicit consent required. Dedicated Chrome transport only; no site requests.');
    process.exitCode = 2;
} else {
    try {
        client = await connectDedicatedChrome();
        console.log(JSON.stringify({ status: 'transport_connected', browserMode: 'persistent_dedicated_loopback',
            siteRequests: 0, pageActions: 0, attached: false }));
    } catch (error) {
        console.log(JSON.stringify({ status: 'not_connected', reason: reasons.has(error.message) ? error.message : 'connection_failed',
            elapsedMs: Date.now() - startedAt, siteRequests: 0, pageActions: 0, attached: false }));
        process.exitCode = 1;
    } finally { await client?.close(); }
}
