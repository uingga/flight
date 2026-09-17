// Data publication only. Never imports or starts a scraper and never releases a collector lock.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createBrokerClient} from '../src/lib/writer-broker-client.mjs';
import {verifyMrtArchive,planMrtRecovery,publicationFailure} from '../src/lib/mrt-publication-recovery.mjs';
import {mergeCrawlLogHistories} from './merge-crawl-log.mjs';
const [mode,directory,resolvedCategory]=process.argv.slice(2);
if(!['--inspect','--apply'].includes(mode)||!directory)throw Error('use --inspect <archive-dir>, or --apply <archive-dir> <resolved-category>');
if(process.env.NAVER_COORDINATION!=='1')throw Error('coordinated writer required');
const dir=fs.realpathSync(directory),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const archived=verifyMrtArchive({manifest,cacheRaw:fs.readFileSync(path.join(dir,'all-flights-cache.json')),logsRaw:fs.readFileSync(path.join(dir,'crawl-log.json'))});
const failure=JSON.parse(fs.readFileSync(path.join(dir,'mrt-publication-failure.json')));
if(failure.runId!==manifest.runId)throw Error('failure and archive run mismatch');
const broker=createBrokerClient({url:process.env.TIKIT_WRITER_URL,token:process.env.TIKIT_WRITER_TOKEN||fs.readFileSync(process.env.TIKIT_WRITER_TOKEN_FILE,'utf8').trim()});
const current=await broker('readInputs');
const decision=planMrtRecovery({current:current.cache,archived:archived.cache,manifest,failure,resolvedCategory});
console.log(JSON.stringify({action:decision.action,reason:decision.reason,category:failure.category,sourceTimestamp:archived.cache.sourceUpdatedAt.myrealtrip}));
if(mode==='--apply'&&decision.action==='publish'){
 // Logs come from the same immutable Git ref as the broker's cache, never a stale local checkout.
 const repository=process.env.GITHUB_REPOSITORY||'uingga/flight';
 const response=await fetch(`https://api.github.com/repos/${repository}/contents/data/crawl-log.json?ref=${current.ref}`,{headers:process.env.GITHUB_TOKEN?{authorization:'Bearer '+process.env.GITHUB_TOKEN}:{},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('pinned logs unavailable');let body=await response.json();
 if(body.encoding==='none'){
  if(!/^[a-f0-9]{40}$/.test(body.sha))throw Error('invalid log blob');
  const blob=await fetch(`https://api.github.com/repos/${repository}/git/blobs/${body.sha}`,{headers:process.env.GITHUB_TOKEN?{authorization:'Bearer '+process.env.GITHUB_TOKEN}:{},signal:AbortSignal.timeout(20000)});
  if(!blob.ok)throw Error('log blob unavailable');body=await blob.json();
 }
 const logs=JSON.parse(Buffer.from(body.content,'base64').toString());
 const entries=[['data/all-flights-cache.json',decision.cache],['data/crawl-log.json',mergeCrawlLogHistories(logs,archived.logs,['myrealtrip']).history]];
 const requestId=createHash('sha256').update(JSON.stringify({archive:manifest.hashes,base:current.ref,entries})).digest('hex');
 const journal=path.join(dir,'publication-recovery-attempt.json');
 fs.writeFileSync(journal,JSON.stringify({requestId,expectedBase:current.ref,resolvedCategory,createdAt:new Date().toISOString()}),{flag:'wx'});
 try{
  const result=await broker('commit',{requestId,expectedBase:current.ref,entries});
  const observed=await broker('readInputs');
  const proof=planMrtRecovery({current:observed.cache,archived:archived.cache,manifest,failure});
  if(proof.action!=='skip')throw Error('publication readback unconfirmed');
  fs.writeFileSync(path.join(dir,'publication-recovery-result.json'),JSON.stringify({result,proof,observedRef:observed.ref}),{flag:'wx'});
  console.log('archived source publication verified');
 }catch(error){console.error(JSON.stringify(publicationFailure(error)));throw Error('recovery stopped; inspect journal and readback before another attempt');}
}
