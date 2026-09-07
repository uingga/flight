import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

if (process.env.VERCEL) throw new Error('Local preview only');
// Run only from the isolated worktree. Never copy production .env files here.
if (fs.readdirSync(process.cwd()).some(name => /^\.env($|\.)/.test(name) && name !== '.env.example')) {
    throw new Error('Remove environment files from the preview worktree before starting');
}
const port = process.env.FLIGHT_ORDER_PREVIEW_PORT || '31848';
const env = {
    ...process.env,
    ADMIN_KEY: 'flight-order-local-preview',
    FLIGHT_ORDER_PREVIEW_DIR: path.join(process.cwd(), 'tmp', 'flight-order-preview'),
    FLIGHT_ORDER_ENABLED: '',
    SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', GH_PAT: '', GITHUB_TOKEN: '',
    EMAIL_USER: '', EMAIL_PASS: '', GA4_PRIVATE_KEY: '', GA4_CLIENT_EMAIL: '', GA4_PROPERTY_ID: '',
    NEXT_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
};
const command = process.argv.includes('--production') ? 'start' : 'dev';
const child = spawn(process.execPath, [path.join('node_modules', 'next', 'dist', 'bin', 'next'), command, '--hostname', '127.0.0.1', '--port', port], { env, stdio: 'inherit', windowsHide: true });
console.log(`Isolated flight order preview: http://127.0.0.1:${port}/preview/flight-order`);
child.on('exit', code => { process.exitCode = code || 0; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
