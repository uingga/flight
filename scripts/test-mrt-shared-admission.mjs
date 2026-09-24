import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acquireMrt,assertMrtOwner,releaseMrt} from '../src/lib/mrt-shared-admission.mjs';
const sha='a'.repeat(40),slot='2026-09-17T03:05:00.000Z';
function fixture(){let n=0;const refs=new Map();return {refs,api:async(p,m='GET',b)=>{
 if(p==='git/commits'&&m==='POST')return {status:201,data:{sha:(++n).toString(16).padStart(40,'0')}};
 if(p.startsWith('git/commits/'))return {status:200,data:{tree:{sha}}};
 if(p==='git/refs'){const k=b.ref.slice(5);if(refs.has(k))return {status:422};refs.set(k,b.sha);return {status:201};}
 if(m==='DELETE'){refs.delete(p.slice('git/refs/'.length));return {status:204};}
 const value=refs.get(p.slice('git/ref/'.length));return {status:value?200:404,data:{object:{sha:value}}};
 }};}
test('GitHub/B/C competing admission gives only one collector',async()=>{const {api}=fixture();const r=await Promise.all(['github','B','C'].map(host=>acquireMrt(api,{slot,host,sha})));assert.equal(r.filter(Boolean).length,1);});
test('release retains slot claim and cannot collect the same round again',async()=>{const {api}=fixture();const t=await acquireMrt(api,{slot,host:'C',sha});await releaseMrt(api,t);assert.equal(await acquireMrt(api,{slot,host:'C',sha}),null);});
test('crash/unknown completion never expires active admission',async()=>{const {api}=fixture();await acquireMrt(api,{slot,host:'github',sha});assert.equal(await acquireMrt(api,{slot:'2026-09-18T03:05:00.000Z',host:'C',sha}),null);});
test('stale owner cannot release a new collector',async()=>{const {api}=fixture();const old=await acquireMrt(api,{slot,host:'github',sha});await releaseMrt(api,old);const next=await acquireMrt(api,{slot:'2026-09-18T03:05:00.000Z',host:'C',sha});await assert.rejects(releaseMrt(api,old));await assertMrtOwner(api,next);});
