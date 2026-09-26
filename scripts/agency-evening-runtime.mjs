import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
    if (process.argv.length !== 3 || process.argv[2] !== '--scheduled') throw new Error('scheduled_only');
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
        size += chunk.length;
        if (size > 15_000_000) throw new Error('evening_request_too_large');
        chunks.push(chunk);
    }
    const request = JSON.parse(Buffer.concat(chunks).toString());
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json'), 'utf8'));
    // The existing host-owned collector verifier runs before loading any crawler module.
    const {replacementWorkerContext} = await import('../src/lib/temporary-b-replacement.mjs');
    const replacement=replacementWorkerContext();
    if(replacement){
        const {verifyAgencyEveningRelease}=await import('./agency-evening-release.mjs');
        verifyAgencyEveningRelease(root,manifest,replacement.releaseVersion);
        if(request.version!==replacement.releaseVersion)throw Error('temporary_evening_version_mismatch');
    } else {
        const verifier = pathToFileURL(path.join(root, '..', 'collector', 'collector-release.mjs')).href;
        const { verifyRelease } = await import(verifier);
        verifyRelease(root, manifest, request.version);
    }
    const { executeAgencyEvening } = await import('./agency-evening-worker.mjs');
    process.stdout.write(JSON.stringify(await executeAgencyEvening(request)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(() => { console.error('Evening runtime refused; preserve slot evidence'); process.exitCode = 1; });
