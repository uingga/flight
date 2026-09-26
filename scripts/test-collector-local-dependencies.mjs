import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dependencyPlan, prepareDependencies, verifyPreparedDependencies } from './prepare-collector-local-dependencies.mjs';
import { assertLocalCollectorPath, verifyDependencies } from './lib/collector-dependencies.mjs';

function fixture() {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'collector-local-test-'));
    const releaseRoot=path.join(root,'release'),depotRoot=path.join(root,'depot');
    fs.mkdirSync(releaseRoot);
    const lock=JSON.stringify({lockfileVersion:3,packages:{'':{name:'fixture'},'node_modules/fixture':{version:'1.0.0'},
        'node_modules/optional':{version:'1.0.0',optional:true}}});
    fs.writeFileSync(path.join(releaseRoot,'package.json'),JSON.stringify({name:'fixture',dependencies:{fixture:'1.0.0'}}));
    fs.writeFileSync(path.join(releaseRoot,'package-lock.json'),lock);
    return {root,releaseRoot,depotRoot,expectedLockSha:createHash('sha256').update(lock).digest('hex'),
        cleanup(){
            assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
            assert.ok(path.basename(root).startsWith('collector-local-test-'));
            fs.rmSync(root,{recursive:true,force:true});
        }};
}
const fakeInstall=async root=>{
    const dir=path.join(root,'node_modules/fixture');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0'}));
};

test('prepare creates verified immutable local dependencies and never activates/replaces the release',async()=>{
    const f=fixture();try{
        const sourceBefore=fs.readFileSync(path.join(f.releaseRoot,'package-lock.json'),'utf8');
        let installs=0;
        const first=await prepareDependencies(f,async root=>{installs++;await fakeInstall(root);});
        assert.equal(first.activated,false);assert.equal(first.reused,false);assert.equal(first.checked,1);
        assert.equal(fs.existsSync(path.join(f.releaseRoot,'node_modules')),false);
        assert.equal(fs.readFileSync(path.join(f.releaseRoot,'package-lock.json'),'utf8'),sourceBefore);
        assert.deepEqual(verifyPreparedDependencies(first.path,dependencyPlan(f)),{checked:1});
        const second=await prepareDependencies(f,async()=>{installs++;throw Error('must_not_install');});
        assert.equal(second.reused,true);assert.equal(installs,1);
    }finally{f.cleanup();}
});
test('cloud paths and cloud-backed junctions are refused before package-by-package reads',()=>{
    for(const dir of ['Dropbox','OneDrive','OneDrive - Company','Google Drive'])
        assert.throws(()=>assertLocalCollectorPath(path.resolve(dir,'node_modules')),/not_local/);
    const f=fixture();try{
        const cloud=path.join(f.root,'Dropbox/node_modules');fs.mkdirSync(cloud,{recursive:true});
        fs.symlinkSync(cloud,path.join(f.releaseRoot,'node_modules'),'junction');
        assert.throws(()=>verifyDependencies(f.releaseRoot),/not_local/);
    }finally{f.cleanup();}
});
test('lock mismatch, dependency changes and symlink escapes remain fail closed',async()=>{
    const f=fixture();try{
        assert.throws(()=>dependencyPlan({...f,expectedLockSha:'0'.repeat(64)}),/lock_changed/);
        await assert.rejects(prepareDependencies(f,async root=>{
            await fakeInstall(root);fs.writeFileSync(path.join(root,'node_modules/fixture/package.json'),'{"version":"2.0.0"}');
        }),/version_mismatch/);
        assert.equal(fs.existsSync(path.join(f.depotRoot,f.expectedLockSha)),false);
        const result=await prepareDependencies(f,fakeInstall);
        fs.writeFileSync(path.join(result.path,'package-lock.json'),'{}');
        await assert.rejects(prepareDependencies(f,fakeInstall),/prepared_dependencies_mismatch/);
    }finally{f.cleanup();}
});
test('a failed install preserves a diagnostic staging folder without changing active data',async()=>{
    const f=fixture();try{
        await assert.rejects(prepareDependencies(f,async()=>{throw Error('install_failed');}),/install_failed/);
        const staged=fs.readdirSync(f.depotRoot).filter(n=>n.startsWith('.staging-'));
        assert.equal(staged.length,1);
        assert.equal(JSON.parse(fs.readFileSync(path.join(f.depotRoot,staged[0],'failed.json'),'utf8')).reason,'install_failed');
        assert.equal(fs.existsSync(path.join(f.releaseRoot,'node_modules')),false);
    }finally{f.cleanup();}
});
test('dependency package JSON cannot resolve outside the prepared local tree',async()=>{
    const f=fixture();try{
        const external=path.join(f.root,'external');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'package.json'),'{"version":"1.0.0"}');
        fs.mkdirSync(path.join(f.releaseRoot,'node_modules'));
        fs.symlinkSync(external,path.join(f.releaseRoot,'node_modules/fixture'),'junction');
        assert.throws(()=>verifyDependencies(f.releaseRoot),/outside_local_root/);
    }finally{f.cleanup();}
});
