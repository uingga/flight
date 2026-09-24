import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const allowed = file => typeof file === 'string' && !file.includes('\\') && !path.isAbsolute(file)
    && !file.split('/').some(segment => !segment || segment === '.' || segment === '..')
    && (['package.json', 'package-lock.json', 'tsconfig.json'].includes(file)
        || /^(src|scripts)\/[a-zA-Z0-9_./-]+$/.test(file));

export function agencyEveningManifest(files) {
    if (!Array.isArray(files) || !files.length) throw new Error('empty_evening_release');
    const entries = files.map(({ file, content }) => {
        if (!allowed(file)) throw new Error('unsafe_evening_file');
        return { file, sha256: hash(content) };
    }).sort((left, right) => left.file.localeCompare(right.file, 'en'));
    if (new Set(entries.map(entry => entry.file)).size !== entries.length) throw new Error('duplicate_evening_file');
    return { format: 1, version: hash(JSON.stringify(entries)), files: entries };
}

export function verifyAgencyEveningRelease(root, manifest, expectedVersion) {
    if (manifest?.format !== 1 || !/^[a-f0-9]{64}$/.test(expectedVersion || '')
        || manifest.version !== expectedVersion || !Array.isArray(manifest.files) || !manifest.files.length)
        throw new Error('evening_release_mismatch');
    const resolved = fs.realpathSync(root);
    const files = manifest.files.map(({ file, sha256 }) => {
        if (!allowed(file) || !/^[a-f0-9]{64}$/.test(sha256 || '')) throw new Error('unsafe_evening_manifest');
        const target = path.resolve(resolved, file);
        const actual = fs.realpathSync(target);
        const relative = path.relative(resolved, actual);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)
            || actual !== target) throw new Error('linked_evening_code');
        return { file, content: fs.readFileSync(target) };
    });
    const observed = agencyEveningManifest(files);
    if (observed.version !== manifest.version || JSON.stringify(observed.files) !== JSON.stringify(manifest.files))
        throw new Error('evening_code_modified');
    return { version: observed.version, files: observed.files.length };
}
