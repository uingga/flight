import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { requestRemoteWorker, safeRemoteStderr } from '../src/lib/remote-worker-transport';

function fixture(script: (child: any)=>void) {
    let starts=0,kills=0;
    const records:any[]=[];
    const start:any=()=>{
        starts++;
        const child:any=new EventEmitter();
        child.stdin=new EventEmitter(); child.stdout=new EventEmitter(); child.stderr=new EventEmitter();
        child.stdin.end=()=>queueMicrotask(()=>script(child));
        child.kill=()=>{kills++;return true;};
        return child;
    };
    const run=(extra={})=>requestRemoteWorker({args:['host','worker'],request:{secret:'never log'},timeoutMs:20,
        maxBytes:1024,trace:r=>records.push(r),...extra},start);
    return {run,records,counts:()=>({starts,kills})};
}
test('successful or failed correlated replies can complete without any retry',async()=>{
    for(const status of ['verified','failed']) {
        const f=fixture(c=>{c.stdout.emit('data',Buffer.from(JSON.stringify({status})));c.emit('close',status==='verified'?0:1,null);});
        assert.equal((await f.run()).status,status);
        assert.deepEqual(f.counts(),{starts:1,kills:0});
        assert.equal(f.records.at(-1).state,'replied');
    }
});
test('timeout is distinct and never treated as proof of zero site requests',async()=>{
    const f=fixture(()=>{});
    await assert.rejects(f.run(),/remote_transport_timeout/);
    assert.equal(f.records.at(-1).remoteCompletionUnknown,true);
    assert.deepEqual(f.counts(),{starts:1,kills:1});
});
test('spawn/stdin/oversize/invalid reply/abnormal success each fail once',async()=>{
    for(const [reason,script] of [
        ['remote_spawn_failed',(c:any)=>c.emit('error',Error('private'))],
        ['remote_stdin_failed',(c:any)=>c.stdin.emit('error',Error('private'))],
        ['remote_reply_too_large',(c:any)=>c.stdout.emit('data',Buffer.alloc(1025))],
        ['invalid_remote_reply',(c:any)=>{c.stdout.emit('data',Buffer.from('bad'));c.emit('close',1,null);}],
        ['remote_exit_failed',(c:any)=>{c.stdout.emit('data',Buffer.from('{"status":"verified"}'));c.emit('close',1,null);}],
    ] as const) {
        const f=fixture(script);
        await assert.rejects(f.run(),new RegExp(reason));
        assert.equal(f.records.at(-1).reason,reason);assert.equal(f.counts().starts,1);
        assert.equal(f.records.length,2);
    }
});
test('stderr records only known categories, never credentials, paths or source response bodies',async()=>{
    const secret='Bearer-super-private-token';
    const f=fixture(c=>{c.stderr.emit('data',Buffer.from('Collector release refused: dependency_missing: C:/secret/'+secret));c.emit('close',1,null);});
    await assert.rejects(f.run());
    assert.equal(f.records.at(-1).stderrCode,'dependency_missing');
    assert.doesNotMatch(JSON.stringify(f.records),/Bearer|C:\/secret|never log/);
    assert.equal(safeRemoteStderr('unrecognized '+secret),'unclassified_stderr');
    assert.equal(safeRemoteStderr('Permission denied (publickey).'),'ssh_authentication_failed');
});
test('trace failure settles instead of leaving a completed worker promise hanging',async()=>{
    const f=fixture(c=>{c.stdout.emit('data',Buffer.from('{"status":"verified"}'));c.emit('close',0,null);});
    await assert.rejects(f.run({trace:(r:any)=>{if(r.state!=='started')throw Error('disk');}}),/remote_diagnostics_failed/);
});
