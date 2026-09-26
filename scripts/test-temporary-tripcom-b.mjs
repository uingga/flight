import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {dueTripcomSlot,TRIPCOM_TIMES,verifyTripcomInstallation} from './run-temporary-tripcom-b.mjs';
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
        profile:'C:/Users/ynal/tmp/chrome-tripcom',stateRoot:REPLACEMENT_ROOT+'/tripcom-state',coordinatorUrl:'http://127.0.0.1:47832',
        workerTokenFile:'C:/Users/ynal/Tikitikit/ac-control/tripcom/secrets/B.txt',version:manifest.version};
    verifyTripcomInstallation(config,manifest,()=>Buffer.from('code'));
    for(const [key,value] of Object.entries({host:'C',physicalHost:'B',enabled:false,profile:'personal',coordinatorUrl:'http://elsewhere',stateRoot:'fresh'}))
        assert.throws(()=>verifyTripcomInstallation({...config,[key]:value},manifest,()=>Buffer.from('code')));
    assert.throws(()=>verifyTripcomInstallation(config,manifest,()=>Buffer.from('changed')));
});
