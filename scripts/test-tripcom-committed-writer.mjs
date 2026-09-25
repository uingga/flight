import test from 'node:test';
import assert from 'node:assert/strict';
import {publishCommittedWriter} from './publish-writer.mjs';
import {publicationDiagnostic} from '../src/lib/writer-publication-diagnostics.mjs';

const base='a'.repeat(40),head='b'.repeat(40),published='c'.repeat(40);
const current={flights:[{id:'old-y',source:'ybtour'},{id:'tripcom-new',source:'tripcom'}],count:2,
 sources:{ybtour:1,tripcom:1},tripcomPrimary:{runId:'current'}};
const proposed={flights:[{id:'new-y',source:'ybtour'}],count:1,sources:{ybtour:1}};
const git=args=>{
 const key=args.join(' ');
 return ({'status --porcelain --untracked-files=no':'','rev-parse HEAD':head,'rev-parse HEAD^':base,
  'rev-list --parents -n 1 HEAD':`${head} ${base}`,[`diff --name-only ${base} ${head} --`]:'data/all-flights-cache.json',
  [`show ${head}:data/all-flights-cache.json`]:JSON.stringify(proposed)})[key] ?? (()=>{throw Error(`unexpected git: ${key}`)})();
};
const env={NAVER_COORDINATION:'1',TIKIT_WRITER_TOKEN:'test-token',TIKIT_WRITER_URL:'http://127.0.0.1'};

test('committed daily writer preserves Trip.com from exact latest base',async()=>{
 const calls=[];
 const brokerFactory=()=>async(action,payload)=>{
  calls.push([action,payload]);
  return action==='readInputs'?{ref:base,cache:current}:{commitSha:published};
 };
 const result=await publishCommittedWriter({role:'daily',env,git,brokerFactory});
 assert.equal(result.commitSha,published);
 assert.deepEqual(calls.map(([action])=>action),['readInputs','commit']);
 assert.deepEqual(calls[1][1].entries[0][1].flights,[proposed.flights[0],current.flights[1]]);
 assert.deepEqual(JSON.parse(calls[1][1].rawEntries[0][1]),calls[1][1].entries[0][1]);
});

test('base changed before merge refuses commit rather than publishing stale cache',async()=>{
 const calls=[];
 const brokerFactory=()=>async(action,payload)=>{calls.push(action);return {ref:published,cache:current};};
 await assert.rejects(publishCommittedWriter({role:'daily',env,git,brokerFactory}),error=>{
  assert.match(error.message,/base changed/);
  assert.deepEqual(publicationDiagnostic(error),{
   event:'writer-publication-error',outcome:'refused',code:'WRITER_PRECOMMIT_BASE_CHANGED',
   httpStatus:null,lastCode:null,lastHttpStatus:null,requestId:head,receiptAccepted:false,newRequestAllowed:true,
  });
  return true;
 });
 assert.deepEqual(calls,['readInputs']);
});
