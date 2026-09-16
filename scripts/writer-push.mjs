import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {publishCommittedWriter} from './publish-writer.mjs';
import {WRITER_FILES} from '../src/lib/writer-broker.mjs';
import {reconcilePublication} from './lib/writer-reconcile.mjs';

export async function pushWriter({role,args=[],env=process.env,root=process.cwd(),publish=publishCommittedWriter,exec=execFileSync}) {
 if(!WRITER_FILES[role])throw Error('unknown writer role');
 const mode=env.NAVER_COORDINATION||'0';
 if(!['0','1'].includes(mode))throw Error('invalid writer mode');
 if(mode==='1'){
  const result=await publish({role,env,root});
  if(role==='source-fallback'||(role==='daily'&&!env.GITHUB_ACTIONS))reconcilePublication({root,...result,repository:env.NAVER_COORDINATION_REPOSITORY});
  return result;
 }
 if(Object.entries(env).some(([k,v])=>v&&(k.startsWith('NAVER_COORDINATION_')||k.startsWith('TIKIT_WRITER_'))))throw Error('partial coordinated writer configuration');
 if(!['','origin main','origin HEAD:main'].includes(args.join(' ')))throw Error('legacy push arguments refused');
 exec('git',['push',...args],{cwd:root,env,stdio:'inherit'});
 return {commitSha:exec('git',['rev-parse','HEAD'],{cwd:root,env,encoding:'utf8'}).trim()};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 pushWriter({role:process.argv[2],args:process.argv.slice(3)}).then(({commitSha})=>{
  if(!/^[a-f0-9]{40}$/.test(commitSha))throw Error('invalid published commit');
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`commit=${commitSha}\npublished_commit=${commitSha}\n`);
  console.log('writer publication confirmed');
 }).catch(()=>{console.error('writer publication refused; no alternate push');process.exitCode=1;});
}
