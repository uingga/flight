import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {dueTripcomSlot,TRIPCOM_TIMES,verifyTripcomInstallation,verifyTripcomTransport,TRIPCOM_COORDINATOR_URL} from './run-temporary-tripcom-b.mjs';
import {REPLACEMENT_ROOT} from '../src/lib/temporary-b-replacement.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
test('uses exactly the existing ten paired times without replaying an older slot',()=>{
    assert.equal(TRIPCOM_TIMES.length,10);
    assert.equal(dueTripcomSlot(Date.parse('2026-09-26T11:50:00+09:00')),'2026-09-26T11:48:00+09:00');
    assert.throws(()=>dueTripcomSlot(Date.parse('2026-09-26T05:00:00+09:00')));
});
test('logical B retains exact loopback central admission and existing A dedicated profile',()=>{
    const files=Array.from({length:10},(_,i)=>({file:`file_${i}.py`,sha256:sha('code')}));
    const manifest={format:1,files,version:sha(JSON.stringify(files))};
    const config={host:'B',hostname:'OFFICE-OMEN',enabled:true,parallelMode:true,physicalHost:'A',replacementId:'b-on-a-20260926',
        profile:'C:/Users/ynal/tmp/chrome-tripcom',stateRoot:REPLACEMENT_ROOT+'/tripcom-state',coordinatorUrl:TRIPCOM_COORDINATOR_URL,
        workerTokenFile:'C:/Users/ynal/Tikitikit/ac-control/tripcom/secrets/B.txt',version:manifest.version};
    verifyTripcomInstallation(config,manifest,()=>Buffer.from('code'));
    for(const [key,value] of Object.entries({host:'C',physicalHost:'B',enabled:false,profile:'personal',coordinatorUrl:'http://127.0.0.1:47832',stateRoot:'fresh'}))
        assert.throws(()=>verifyTripcomInstallation({...config,[key]:value},manifest,()=>Buffer.from('code')));
    assert.throws(()=>verifyTripcomInstallation(config,manifest,()=>Buffer.from('changed')));
});

test('transport preflight uses the real client constructor, dummy credential and no network action',()=>{
    let calls=0;
    const result=verifyTripcomTransport({coordinatorUrl:TRIPCOM_COORDINATOR_URL},{run:(python,args,options)=>{
        calls++;
        assert.match(python,/Python314\/python\.exe$/);
        assert.equal(args.at(-1),'http://127.0.0.1:47832/tripcom');
        assert.match(args[2],/from tripcom_transport import Client/);
        assert.match(args[2],/offline-contract-only/);
        assert.doesNotMatch(args[2],/execute_worker|browser|read_text|urlopen/);
        assert.equal(options.cwd,path.join(REPLACEMENT_ROOT,'tripcom-release'));
        return {status:0,stdout:'transport_contract_valid\n'};
    }});
    assert.equal(calls,1);
    assert.deepEqual(result,{transportContract:true,networkRequests:0});
});

test('missing path and failed Python startup are refused before a worker can run',()=>{
    for(const url of ['http://127.0.0.1:47832','http://127.0.0.1:47832/tripcom/','http://192.168.1.2:47832/tripcom'])
        assert.throws(()=>verifyTripcomTransport({coordinatorUrl:url},{run:()=>{throw Error('must not spawn');}}),/invalid_tripcom_coordinator_url/);
    for(const output of [{status:1,stdout:''},{status:0,stdout:''},{status:0,stdout:'transport_contract_valid',error:Error('timeout')}])
        assert.throws(()=>verifyTripcomTransport({coordinatorUrl:TRIPCOM_COORDINATOR_URL},{run:()=>output}),/tripcom_transport_contract_failed/);
});
