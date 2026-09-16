import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertMode} from '../src/lib/naver-coordination-contract.mjs';
import {createBrokerClient} from '../src/lib/writer-broker-client.mjs';
export async function publishCode({expectedBase,commitSha,invoke}){
 if(!/^[a-f0-9]{40}$/.test(expectedBase)||!/^[a-f0-9]{40}$/.test(commitSha))throw Error('exact deployment SHAs required');
 return invoke('deploy',{expectedBase,commitSha,requestId:commitSha});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 (async()=>{
  if(!assertMode())throw Error('coordinated mode required');
  if(process.argv.length!==4)throw Error('expected base and approved commit required');
  const token=fs.readFileSync(process.env.TIKIT_WRITER_DEPLOY_TOKEN_FILE,'utf8').trim();
  await publishCode({expectedBase:process.argv[2],commitSha:process.argv[3],invoke:createBrokerClient({url:process.env.TIKIT_WRITER_URL,token})});
  console.log('approved code publication verified');
 })().catch(()=>{console.error('code publication refused; no fallback');process.exitCode=1;});
}
