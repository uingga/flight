import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createBrokerClient} from '../src/lib/writer-broker-client.mjs';
import {WRITER_FILES} from '../src/lib/writer-broker.mjs';
import {publicationDiagnostic,publicationFailureMessage} from '../src/lib/writer-publication-diagnostics.mjs';
export const WRITER_GIT_MAX_BUFFER=32*1024*1024;
export const readWriterGit=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:WRITER_GIT_MAX_BUFFER,stdio:['ignore','pipe','pipe']});
export async function publishCommittedWriter({role,root=process.cwd(),env=process.env,git=(args)=>readWriterGit(root,args)}){
 if(!WRITER_FILES[role])throw Error('unknown writer');
 if(env.NAVER_COORDINATION!=='1')throw Error('coordinated publication requires explicit mode');
 if(git(['status','--porcelain','--untracked-files=no']).trim())throw Error('uncommitted writer changes refused');
 const head=git(['rev-parse','HEAD']).trim(),base=git(['rev-parse','HEAD^']).trim();
 if(!/^[a-f0-9]{40}$/.test(head)||!/^[a-f0-9]{40}$/.test(base))throw Error('invalid commit identity');
 if(git(['rev-list','--parents','-n','1','HEAD']).trim().split(/\s+/).length!==2)throw Error('merge commit refused');
 const names=git(['diff','--name-only',base,head,'--']).trim().split(/\r?\n/).filter(Boolean);
 if(!names.length||names.some(f=>!WRITER_FILES[role].some(n=>f===`data/${n}.json`)))throw Error('commit contains disallowed files');
 const rawEntries=names.map(file=>[file,git(['show',`${head}:${file}`])]);
 const entries=rawEntries.map(([file,raw])=>[file,JSON.parse(raw)]);
 const token=env.TIKIT_WRITER_TOKEN||fs.readFileSync(env.TIKIT_WRITER_TOKEN_FILE,'utf8').trim();
 // The A agent may finish the GitHub publication after the relay's initial 202.
 // Keep checking the same durable receipt for as long as its completion retry window.
 const result=await createBrokerClient({url:env.TIKIT_WRITER_URL,token,timeoutMs:900000})('commit',{expectedBase:base,requestId:head,entries,rawEntries});
 if(!/^[a-f0-9]{40}$/.test(result?.commitSha||''))throw Error('invalid publication commit response');
 return {...result,localCommit:head};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 publishCommittedWriter({role:process.argv[2]}).then(result=>{console.log('coordinated writer published '+result.commitSha);if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`published_commit=${result.commitSha}\n`);}).catch(error=>{console.error(JSON.stringify(publicationDiagnostic(error)));console.error(publicationFailureMessage(error));process.exitCode=1;});
}
