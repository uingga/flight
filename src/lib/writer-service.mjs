import fs from 'node:fs';
import {assertMode} from './naver-coordination-contract.mjs';
import {requireExternalWriterControl} from './naver-writer-safety.mjs';
import {installationTokenProvider} from './writer-app-token.mjs';
import {verifyWriterAuthority} from './writer-authority.mjs';
import {createGitHubPublisher} from './naver-publication.mjs';

// Called before opening the ledger or socket. No boolean attestation substitutes for authority.
export async function configuredPublicationRuntime(env=process.env,fixture=undefined){
 if(fixture){
  const url=new URL(fixture.origin);
  if(!['127.0.0.1','[::1]'].includes(url.hostname))throw Error('publication fixture origin refused');
  return {publicationFactory:async()=>createGitHubPublisher({...fixture,fixture:true}),revalidate:async()=>{}};
 }
 if(!assertMode(env))throw Error('coordinated mode required');
 const need=name=>{if(!env[name])throw Error(`missing configuration: ${name}`);return env[name];};
 const repository=need('NAVER_COORDINATION_REPOSITORY'),branch=need('NAVER_COORDINATION_BRANCH');
 const appId=Number(need('TIKIT_WRITER_APP_ID')),rulesetId=Number(need('TIKIT_WRITER_RULESET_ID'));
 const token=installationTokenProvider({appId,installationId:Number(need('TIKIT_WRITER_INSTALLATION_ID')),repository,workflows:true,
  privateKey:fs.readFileSync(need('TIKIT_WRITER_APP_KEY_FILE'),'utf8')});
 const scope={repository,branch};
 const revalidate=async()=>{
  const proof=await verifyWriterAuthority({...scope,appId,rulesetId,token});
  requireExternalWriterControl(proof,scope);return proof;
 };
 const authority=await revalidate();
 return {authority,revalidate,publicationFactory:async()=>{
  const proof=await revalidate();
  return createGitHubPublisher({...scope,token,authority:proof,revalidate});
 }};
}
