import fs from 'node:fs';
import { githubMrtClient, resolveMrtSlot, reserveMrtSlot } from '../src/lib/myrealtrip-schedule.mjs';

const token = process.env.GITHUB_TOKEN;
if (!token || !process.env.GITHUB_RUN_ID || !process.env.GITHUB_SHA) throw new Error('Missing GitHub identity');
const api = githubMrtClient(token, process.env.GITHUB_REPOSITORY);
const current = await api(`actions/runs/${process.env.GITHUB_RUN_ID}`);
if (current.status !== 200) throw new Error('Cannot identify originating run');
const slot = resolveMrtSlot({ schedule: process.env.TRIGGER_SCHEDULE,
    expectedAt: process.env.EXPECTED_AT, createdAt: current.data.created_at });
const shouldRun = slot ? await reserveMrtSlot(api, slot, process.env.GITHUB_SHA, process.env.GITHUB_RUN_ID) : false;
console.log(`[mrt-slot] expected_at=${slot?.expectedAt || 'stale-slot'} should_run=${shouldRun}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    `should_run=${shouldRun}\nexpected_at=${slot?.expectedAt || ''}\n`);
