import fs from 'node:fs';
import path from 'node:path';

// Match TtangDetailCheckpoint's existing canonical staging contract; never relax it.
export function createEveningStaging(root, id, source, files) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id || '')
        || !['ybtour', 'hanatour', 'modetour', 'ttang', 'onlinetour', 'lottetour'].includes(source)
        || !files || Object.keys(files).some(name => !/^[a-z][a-z0-9-]*\.json$/.test(name)))
        throw new Error('invalid_evening_staging');
    const canonical = fs.realpathSync(root);
    let parent = canonical;
    for (const name of ['.local-crawler', 'staging']) {
        parent = path.join(parent, name);
        try { fs.mkdirSync(parent); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        if (!fs.lstatSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink()
            || path.relative(parent, fs.realpathSync(parent))) throw new Error('unsafe_evening_staging');
    }
    const dir = path.join(parent, `evening-${id}-${source}`);
    fs.mkdirSync(dir); // Exclusive per source and request; old evidence is never reused/overwritten.
    if (path.relative(dir, fs.realpathSync(dir))) throw new Error('unsafe_evening_staging');
    for (const [name, value] of Object.entries(files))
        fs.writeFileSync(path.join(dir, name), JSON.stringify(value), { flag: 'wx' });
    return dir;
}
