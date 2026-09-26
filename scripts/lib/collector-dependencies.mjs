import fs from 'node:fs';
import path from 'node:path';

const CLOUD_PATH = /(?:^|[\\/])(?:Dropbox|OneDrive(?: - [^\\/]+)?|Google Drive|iCloudDrive)(?:[\\/]|$)/i;
export function assertLocalCollectorPath(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || CLOUD_PATH.test(value)
        || /^\\\\/.test(value)) throw Error('collector_dependencies_not_local');
    return value;
}
const within = (root, file) => {
    const relative = path.relative(root, file);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

// Validate the target BEFORE reading every dependency. A cloud-backed junction
// must fail promptly, not spend the entire source deadline recalling files.
export function verifyDependencies(root) {
    assertLocalCollectorPath(path.resolve(root));
    assertLocalCollectorPath(fs.realpathSync(root));
    const modules = assertLocalCollectorPath(fs.realpathSync(path.join(root, 'node_modules')));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    if (!lock.packages || typeof lock.packages !== 'object') throw Error('invalid_dependency_lock');
    let checked = 0;
    for (const [name, pkg] of Object.entries(lock.packages)) {
        if (!name) continue;
        if (!name.startsWith('node_modules/') || name.includes('\\')
            || name.split('/').some(p => p === '..' || p === '.' || p === '')) throw Error('unsafe_dependency_path');
        const file = path.join(root, name, 'package.json');
        if (!fs.existsSync(file)) {
            if (pkg.optional) continue;
            throw Error('dependency_missing');
        }
        const actual = assertLocalCollectorPath(fs.realpathSync(file));
        if (!within(modules, actual)) throw Error('dependency_outside_local_root');
        const installed = JSON.parse(fs.readFileSync(actual, 'utf8'));
        if (!pkg.version || installed.version !== pkg.version) throw Error('dependency_version_mismatch');
        checked++;
    }
    return { checked };
}
