import { readFileSync, statSync } from 'node:fs';
import { TE31_POSTS } from '../src/lib/te31-posts';
import { decodeTe31Listing, parseTe31Listing } from '../src/lib/server/promotion-te31';
const file = process.argv[2];
if (!file || statSync(file).size > 2_000_000) throw new Error('Pass one local listing HTML file, at most 2 MB');
// Supply the original bytes. An already-converted UTF-8 file must also declare charset=utf-8.
const rows = parseTe31Listing(decodeTe31Listing(readFileSync(file)), TE31_POSTS.map(post => post.id));
console.log(JSON.stringify({ registeredRows: [...rows].map(([id, metrics]) => ({ id, metrics })), registeredTotal: TE31_POSTS.length }, null, 2));
if (!rows.size) process.exitCode = 1;
