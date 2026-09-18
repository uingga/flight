import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { extractTracking } from '../src/lib/threads-tracking';
import type { VerifiedThreadsLink } from '../src/lib/threads-post-links';

function postPath(raw: string): string {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !['www.threads.com', 'threads.com', 'www.threads.net', 'threads.net'].includes(url.hostname)
        || url.username || url.password || url.search || url.hash
        || !/^\/@tikitikit\.kr\/post\/[\w-]+\/?$/.test(url.pathname)) throw Error('Expected an exact tikitikit.kr Threads post URL');
    return url.pathname.replace(/\/$/, '');
}

// This stores an operator-verified relationship, never an inferred city/price match or a visit count.
export function registerLink(rows: VerifiedThreadsLink[], input: {
    postUrl: string; replyUrl: string; link: string; verifiedOn: string; confirmed: boolean;
}): VerifiedThreadsLink[] {
    if (!input.confirmed) throw Error('Confirm the published root post and its own reply before registration');
    const root = postPath(input.postUrl), reply = postPath(input.replyUrl);
    if (root === reply) throw Error('Expected the separate own-reply permalink');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.verifiedOn) || !Number.isFinite(Date.parse(input.verifiedOn))
        || new Date(input.verifiedOn).toISOString().slice(0, 10) !== input.verifiedOn) throw Error('Invalid verification date');
    const url = new URL(input.link);
    if (!['http:', 'https:'].includes(url.protocol) || !['tikitikit.kr', 'www.tikitikit.kr'].includes(url.hostname)
        || url.username || url.password || url.hash || !extractTracking(input.link).trackingContent) throw Error('Expected a Tikitikit tracking link');
    for (const key of url.searchParams.keys()) if (!['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].includes(key)) throw Error('Unexpected query parameter');
    if (url.searchParams.has('utm_source') && url.searchParams.get('utm_source') !== 'threads') throw Error('Not a Threads source');
    const existing = rows.find(row => row.postPath === root);
    if (existing) {
        if (existing.url !== input.link || existing.replyUrl !== input.replyUrl) throw Error('Existing mapping differs; review instead of overwriting it');
        return rows;
    }
    return [...rows, { postId: null, postPath: root, replyUrl: input.replyUrl, url: input.link, verifiedOn: input.verifiedOn }];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const get = (name: string) => {
        const index = args.indexOf(name);
        if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw Error(`Missing ${name}`);
        return args[index + 1];
    };
    const file = new URL('../src/lib/threads-post-links.json', import.meta.url);
    const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as VerifiedThreadsLink[];
    const next = registerLink(rows, { postUrl: get('--post-url'), replyUrl: get('--reply-url'), link: get('--link'),
        verifiedOn: get('--verified-on'), confirmed: args.includes('--confirm-verified') });
    if (next !== rows) fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Verified links: ${next.length}. Local registry only; no posting, deployment or traffic changes.`);
}
