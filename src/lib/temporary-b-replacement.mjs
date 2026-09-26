import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPLACEMENT_ROOT = 'C:/Users/ynal/Tikitikit/ac-control/b-on-a-20260926';
export const REPLACEMENT_CONFIG = REPLACEMENT_ROOT + '/activation.json';
export const REPLACEMENT_SOURCES = Object.freeze(['modetour','ttang','onlinetour','myrealtrip','ybtour','hanatour','tripcom']);
const normalize = value => path.win32.normalize(value).toLowerCase();

// Physical host A is explicit. B remains the logical slot/quota owner; no OS
// hostname, coordinator budget, processed key or access circuit is rewritten.
export function validateReplacement(value, { now = Date.now(), hostname = os.hostname() } = {}) {
    if (!value || value.format !== 1 || value.id !== 'b-on-a-20260926'
        || value.from !== 'B' || value.to !== 'A' || value.hostname !== 'OFFICE-OMEN'
        || String(hostname).toUpperCase() !== 'OFFICE-OMEN'
        || !['prepared','active','paused'].includes(value.status)
        || !Number.isFinite(Date.parse(value.notBefore)) || Date.parse(value.notBefore) > now
        || value.bFenced !== true || !/^[a-f0-9]{64}$/.test(value.fenceSha || '')
        || !/^[a-f0-9]{64}$/.test(value.stateSha || '')
        || !/^[a-f0-9]{64}$/.test(value.releaseVersion || '')
        || normalize(value.root || '') !== normalize(REPLACEMENT_ROOT)
        || value.regularOnly !== true) throw Error('invalid_temporary_replacement');
    return value;
}

export function readReplacement({ file = REPLACEMENT_CONFIG, hostname = os.hostname(), now = Date.now() } = {}) {
    if (String(hostname).toUpperCase() !== 'OFFICE-OMEN' || !fs.existsSync(file)) return null;
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('linked_temporary_replacement');
    return validateReplacement(JSON.parse(fs.readFileSync(file, 'utf8')), { hostname, now });
}

export function replacementFor(source, slot, { manual = false, read = readReplacement } = {}) {
    const value = read();
    if (!value) return null;
    // Once fenced, a paused/invalid replacement must not fall back to B.
    if (value.status !== 'active') throw Error('temporary_replacement_not_active');
    if (!REPLACEMENT_SOURCES.includes(source) || manual
        || !Number.isFinite(Date.parse(slot)) || Date.parse(slot) < Date.parse(value.notBefore))
        throw Error('temporary_replacement_slot_not_allowed');
    return value;
}

export function replacementWorkerContext({ env = process.env, hostname = os.hostname(), read = readReplacement } = {}) {
    if (env.TIKITIKIT_TEMP_B_EXECUTION !== '1') return null;
    const value = read({ hostname });
    if (!value || value.status !== 'active' || env.TIKITIKIT_TEMP_B_VERSION !== value.releaseVersion)
        throw Error('temporary_worker_not_authorized');
    return { ...value, physicalHost: 'A', logicalHost: 'B',
        stateBase: path.join(value.root, 'state'),
        chrome: { port: 9223, profileDir: path.join(os.homedir(), 'tmp/chrome-debug') } };
}

export function collectionStateBase() {
    return replacementWorkerContext()?.stateBase || path.join(os.homedir(), 'AppData/Local/Tikitikit');
}

export function collectionHostname(hostname = os.hostname()) {
    const context = replacementWorkerContext({ hostname });
    return context ? 'DESKTOP-OFFICE' : hostname;
}

export function collectionExecutionMetadata() {
    const context=replacementWorkerContext();
    return context ? { executionHost:'A', assignedHost:'B', replacementId:context.id } : {};
}

export function collectionChromeSettings() {
    return replacementWorkerContext()?.chrome || {port:9222,profileDir:path.join(os.homedir(),'tmp/chrome-debug')};
}

export function replacementLaunch(source, slot, options) {
    const value = replacementFor(source, slot, options);
    if (!value) return null;
    return { file: process.execPath,
        args: [path.join(value.root, 'release/scripts/run-temporary-b-worker.mjs'), source, '--scheduled'],
        cwd: path.join(value.root, 'release'), version: value.releaseVersion,
        executionHost: 'A', assignedHost: 'B', replacementId: value.id };
}
