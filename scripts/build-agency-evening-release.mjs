import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agencyEveningManifest, verifyAgencyEveningRelease } from './agency-evening-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main() {
    const destination = process.argv[2];
    if (!destination || process.argv.length !== 3 || !path.isAbsolute(destination))
        throw new Error('absolute_release_destination_required');
    const target = path.resolve(destination);
    if (target === root || target.startsWith(root + path.sep) || fs.existsSync(target))
        throw new Error('release_destination_must_be_new_and_external');
    const names = execFileSync('git', ['ls-files', '-z', '--', 'src/lib', 'src/types', 'scripts',
        'package.json', 'package-lock.json', 'tsconfig.json'], { cwd: root })
        .toString('utf8').split('\0').filter(Boolean).map(name => name.replaceAll('\\', '/'));
    if (!names.includes('scripts/agency-evening-runtime.mjs') || !names.includes('scripts/agency-evening-worker.mjs')
        || !names.includes('scripts/agency-evening-collect.ts')) throw new Error('release_code_not_committed');
    const files = names.map(file => {
        const source = path.join(root, file);
        if (fs.lstatSync(source).isSymbolicLink()) throw new Error('linked_release_source');
        return { file, content: fs.readFileSync(source) };
    });
    const manifest = agencyEveningManifest(files);
    fs.mkdirSync(target, { recursive: true });
    for (const { file, content } of files) {
        const output = path.join(target, file);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, content, { flag: 'wx' });
    }
    fs.writeFileSync(path.join(target, 'release-manifest.json'), JSON.stringify(manifest), { flag: 'wx' });
    verifyAgencyEveningRelease(target, manifest, manifest.version);
    console.log(JSON.stringify({ version: manifest.version, files: files.length,
        bytes: files.reduce((sum, file) => sum + file.content.length, 0), destination: target }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    try { main(); } catch (error) { console.error(error instanceof Error ? error.message : 'release_build_failed'); process.exitCode = 1; }
