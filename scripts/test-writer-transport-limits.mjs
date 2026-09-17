import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {readWriterGit,WRITER_GIT_MAX_BUFFER} from './publish-writer.mjs';
import {createBrokerClient,WRITER_BROKER_TIMEOUT_MS} from '../src/lib/writer-broker-client.mjs';
test('committed JSON above the default 1 MiB git buffer is read exactly',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tikit-writer-buffer-'));
 const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 git(['init']);git(['config','user.name','Offline test']);git(['config','user.email','test@example.invalid']);
 const data=JSON.stringify({rows:'x'.repeat(1300000)});
 fs.writeFileSync(path.join(root,'sample.json'),data);
 git(['add','sample.json']);git(['commit','-m','fixture']);
 assert.equal(readWriterGit(root,['show','HEAD:sample.json']),data);
 assert.equal(WRITER_GIT_MAX_BUFFER,32*1024*1024);
});
test('default broker deadline permits a read taking longer than eight seconds',async()=>{
 assert.equal(WRITER_BROKER_TIMEOUT_MS,60000);
 const server=http.createServer((_req,res)=>setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({result:{ref:'verified'}}));},8500));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const result=await createBrokerClient({url:`http://127.0.0.1:${server.address().port}/`,token:'fixture'})('readInputs');assert.equal(result.ref,'verified');}
 finally{await new Promise(r=>server.close(r));}
});
