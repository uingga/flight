import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLocalCollectorPath, verifyDependencies } from './lib/collector-dependencies.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const defaultDepot = () => path.join(os.homedir(), 'AppData/Local/Tikitikit/collector-dependencies');

function assertPlainDirectory(target) {
    assertLocalCollectorPath(path.resolve(target));
    let current = path.resolve(target);
    for (;;) {
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('linked_dependency_depot');
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
}

export function dependencyPlan({ releaseRoot, expectedLockSha, depotRoot = defaultDepot() }) {
    if (!/^[a-f0-9]{64}$/.test(expectedLockSha || '')) throw Error('exact_dependency_lock_required');
    const source = assertLocalCollectorPath(fs.realpathSync(releaseRoot));
    assertPlainDirectory(depotRoot);
    const lock = fs.readFileSync(path.join(source, 'package-lock.json'));
    const pkg = fs.readFileSync(path.join(source, 'package.json'));
    if (sha(lock) !== expectedLockSha) throw Error('dependency_lock_changed');
    return { source, lock, pkg, lockSha: expectedLockSha, packageSha: sha(pkg),
        depotRoot: path.resolve(depotRoot), destination: path.resolve(depotRoot, expectedLockSha) };
}

export function verifyPreparedDependencies(root, plan) {
    assertPlainDirectory(root);
    const marker = JSON.parse(fs.readFileSync(path.join(root, 'prepared.json'), 'utf8'));
    if (marker.format !== 1 || marker.lockSha !== plan.lockSha || marker.packageSha !== plan.packageSha
        || sha(fs.readFileSync(path.join(root, 'package-lock.json'))) !== plan.lockSha
        || sha(fs.readFileSync(path.join(root, 'package.json'))) !== plan.packageSha)
        throw Error('prepared_dependencies_mismatch');
    const result = verifyDependencies(root);
    if (result.checked !== marker.checked) throw Error('prepared_dependencies_mismatch');
    return result;
}

function npmInstall(root, npmCli) {
    if (!npmCli || !path.isAbsolute(npmCli) || !fs.existsSync(npmCli)) throw Error('local_npm_cli_required');
    assertLocalCollectorPath(fs.realpathSync(npmCli));
    return new Promise((resolve, reject) => {
        // No browser downloads or package lifecycle scripts. This is a NEW,
        // private staging directory; npm never sees an active node_modules.
        const child = spawn(process.execPath, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
            cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
                npm_config_cache: path.join(path.dirname(root), 'npm-cache') },
        });
        let done = false;
        const finish = error => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(); };
        const timer = setTimeout(() => { finish(Error('dependency_install_timeout')); child.kill(); }, 10 * 60000);
        child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
        child.on('error', () => finish(Error('dependency_install_failed')));
        child.on('close', (code, signal) => finish(code === 0 && !signal ? null : Error('dependency_install_failed')));
    });
}

export async function prepareDependencies(options, install = npmInstall) {
    const plan = dependencyPlan(options);
    if (fs.existsSync(plan.destination)) {
        const result = verifyPreparedDependencies(plan.destination, plan);
        return { status: 'prepared', reused: true, activated: false, path: plan.destination, lockSha: plan.lockSha, ...result };
    }
    fs.mkdirSync(plan.depotRoot, { recursive: true });
    assertPlainDirectory(plan.depotRoot);
    const staging = path.join(plan.depotRoot, '.staging-' + randomUUID());
    fs.mkdirSync(staging); // Exclusive name. A failed staging directory is retained, never recursively deleted.
    fs.writeFileSync(path.join(staging, 'package.json'), plan.pkg, { flag: 'wx' });
    fs.writeFileSync(path.join(staging, 'package-lock.json'), plan.lock, { flag: 'wx' });
    try {
        await install(staging, options.npmCli);
        const result = verifyDependencies(staging);
        if (sha(fs.readFileSync(path.join(staging, 'package-lock.json'))) !== plan.lockSha
            || sha(fs.readFileSync(path.join(staging, 'package.json'))) !== plan.packageSha)
            throw Error('dependency_lock_changed');
        fs.writeFileSync(path.join(staging, 'prepared.json'), JSON.stringify({ format: 1, lockSha: plan.lockSha,
            packageSha: plan.packageSha, checked: result.checked, createdAt: new Date().toISOString() }), { flag: 'wx' });
        if (fs.existsSync(plan.destination)) throw Error('dependency_destination_raced');
        fs.renameSync(staging, plan.destination);
        verifyPreparedDependencies(plan.destination, plan);
        return { status: 'prepared', reused: false, activated: false, path: plan.destination, lockSha: plan.lockSha, ...result };
    } catch (error) {
        // No raw npm output or environment values; no change to active releases.
        const reason = /^[a-z_]+$/.test(error?.message) ? error.message : 'dependency_prepare_failed';
        if (fs.existsSync(staging)) fs.writeFileSync(path.join(staging, 'failed.json'), JSON.stringify({ reason, at: new Date().toISOString() }));
        throw Error(reason);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [mode, releaseRoot, expectedLockSha, npmCli] = process.argv.slice(2);
    if (mode !== '--prepare' || process.argv.length !== 6) throw Error('explicit_dependency_prepare_required');
    const result = await prepareDependencies({ releaseRoot, expectedLockSha, npmCli });
    console.log(JSON.stringify(result));
}
