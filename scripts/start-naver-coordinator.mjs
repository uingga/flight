import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {Coordinator} from '../src/lib/naver-coordinator.mjs';
import {assertMode} from '../src/lib/naver-coordination-contract.mjs';
import {startCoordinatorServer,startLoopbackFixtureServer} from '../src/lib/naver-http.mjs';
import {requireExternalWriterControl} from '../src/lib/naver-writer-safety.mjs';
import {configuredPublicationRuntime} from '../src/lib/writer-service.mjs';
import {createPublicationHandler,WRITER_FILES} from '../src/lib/writer-broker.mjs';
import {deliverPublication} from '../src/lib/writer-relay-agent.mjs';

export async function startConfiguredCoordinator(env=process.env,{fixtureRoot,publicationFixture}={}) {
    if(publicationFixture&&!fixtureRoot)throw Error('publication fixture requires fixture root');
    if(!fixtureRoot && !assertMode(env))throw Error('coordinated mode required');
    const root=fixtureRoot?fs.realpathSync(fixtureRoot):null;
    if(root && (!root.startsWith(fs.realpathSync(tmpdir())+path.sep)||!path.basename(root).startsWith('naver-http-fixture-')))throw Error('fixture root refused');
    const resolveFile=name=>{
        if(!env[name])throw Error(`missing configuration: ${name}`);
        const target=path.resolve(env[name]);
        const parent=fs.realpathSync(path.dirname(target));
        if(root && !parent.startsWith(root+path.sep)&&parent!==root)throw Error('fixture path refused');
        if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('symlink configuration refused');
        return target;
    };
    const secrets=Object.fromEntries(['A','C','PUBLISHER'].map(role=>[role==='PUBLISHER'?'publisher':role,fs.readFileSync(resolveFile(`NAVER_COORDINATION_${role}_TOKEN_FILE`),'utf8').trim()]));
    if(!root)for(const role of [...Object.keys(WRITER_FILES),'deploy'])secrets[role]=fs.readFileSync(resolveFile(`TIKIT_WRITER_${role.toUpperCase().replaceAll('-','_')}_TOKEN_FILE`),'utf8').trim();
    if(Object.values(secrets).some(value=>!value)||new Set(Object.values(secrets)).size!==Object.keys(secrets).length)throw Error('distinct nonempty role credentials required');
    const publication=(!root||publicationFixture)?await configuredPublicationRuntime(env,publicationFixture):null;
    if(!root)requireExternalWriterControl(publication?.authority);
    const dbPath=resolveFile('NAVER_COORDINATION_DB_PATH');
    if(!env.NAVER_COORDINATION_APPROVED_DIGEST)throw Error('approved digest required');
    const port=Number(env.NAVER_COORDINATION_PORT||0);
    if(!Number.isInteger(port)||port<0||port>65535)throw Error('invalid port');
    const relayPollMs=Number(env.TIKIT_WRITER_RELAY_POLL_MS||5000);
    if(!Number.isInteger(relayPollMs)||relayPollMs<1000||relayPollMs>60000)throw Error('invalid relay polling interval');
    const coordinator=new Coordinator(dbPath,Date.now,env.NAVER_COORDINATION_APPROVED_DIGEST,{initialize:Boolean(root),writerFencing:true});
    try {
        const approveCode=async input=>{
            if(root)return false;
            const value=JSON.parse(fs.readFileSync(resolveFile('TIKIT_WRITER_CODE_APPROVAL_FILE'),'utf8'));
            return value.repository===env.NAVER_COORDINATION_REPOSITORY&&value.branch===env.NAVER_COORDINATION_BRANCH
                &&value.commitSha===input.commitSha&&value.expectedBase===input.expectedBase
                &&Number.isFinite(value.expiresAt)&&Date.now()<value.expiresAt;
        };
        const publicationHandler=publication?createPublicationHandler({coordinator,secrets,...publication,approveCode}):undefined;
        let relayToken;
        if(env.TIKIT_WRITER_RELAY_URL){
            if(root||!publicationHandler)throw Error('relay requires configured publication authority');
            relayToken=fs.readFileSync(resolveFile('TIKIT_WRITER_RELAY_AGENT_TOKEN_FILE'),'utf8').trim();
            if(!relayToken||Object.values(secrets).includes(relayToken))throw Error('distinct relay credential required');
        }
        const server=await (root?startLoopbackFixtureServer:startCoordinatorServer)({coordinator,secrets,port,publicationHandler,authority:publication?.authority,beforeControl:publication?.revalidate});
        let stopped=false,closing,wake;
        const delivery=relayToken?(async()=>{
            while(!stopped){
                try{await deliverPublication({relayUrl:env.TIKIT_WRITER_RELAY_URL,agentToken:relayToken,publicationHandler,secrets});}
                catch{stopped=true;break;} // Unknown outcomes remain claimed; no automatic restart/replay.
                if(!stopped)await new Promise(r=>{const timer=setTimeout(r,relayPollMs);wake=()=>{clearTimeout(timer);r();};});
            }
        })():Promise.resolve();
        return {...server,close:()=>closing||=(async()=>{stopped=true;wake?.();await delivery;await server.close();coordinator.close();})()};
    } catch(error){coordinator.close();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
    const args=process.argv.slice(2);
    if(args.length&&!(args.length===2&&args[0]==='--loopback-fixture')) {console.error('invalid arguments');process.exitCode=1;}
    else startConfiguredCoordinator(process.env,{fixtureRoot:args[0]?args[1]:undefined}).then(server=>{
        console.log('coordinator listening on loopback');
        process.send?.({ready:true,url:server.url});
        const stop=()=>server.close().then(()=>{process.exitCode=0;if(process.connected)process.disconnect();},()=>{process.exitCode=1;if(process.connected)process.disconnect();});
        process.once('SIGINT',stop);process.once('SIGTERM',stop);
        if(args[0])process.on('message',message=>{if(message==='shutdown')stop();});
    }).catch(()=>{console.error('coordinator startup refused');process.exitCode=1;});
}
