import { requestHttp } from './naver-http-request.mjs';
import { resultVersion, verifyResult } from './naver-coordination-contract.mjs';
import {requireExternalWriterControl} from './naver-writer-safety.mjs';

// One git-tree update publishes both result files. No shell, redirect, force-push, retry or fallback.
export function createGitHubPublisher({ repository, branch, token, origin='https://api.github.com', fixture=false, authority=undefined, revalidate=undefined }) {
    if(!fixture){requireExternalWriterControl(authority,{repository,branch});if(typeof revalidate!=='function')throw Error('live authority revalidation required');}
    let fenceCheck=null;
    if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!branch||!token)throw Error('publisher configuration missing');
    const target=new URL(origin);
    if(fixture ? !['127.0.0.1','[::1]'].includes(target.hostname) : target.origin!=='https://api.github.com')throw Error('publisher origin refused');
    const base=`${target.origin}/repos/${repository}`;
    const api=async(method,suffix,value)=>{
        if(!fixture)await revalidate();
        if(fenceCheck)await fenceCheck();
        const response=await requestHttp(base+suffix,{method,headers:{authorization:`Bearer ${typeof token==='function'?await token():token}`,'content-type':'application/json','user-agent':'tikitikit-coordinated-publisher'},
            body:value===undefined?undefined:JSON.stringify(value),loopbackOnly:fixture});
        if(!response.ok)throw Error('publication refused');
        if(!fixture)await revalidate();
        if(fenceCheck)await fenceCheck();
        return response.json();
    };
    let publishedRef=null;
    async function assertHead(expected) {
        const head=await api('GET','/git/ref/heads/'+encodeURIComponent(branch));
        if(!expected||head.object?.sha!==expected)throw Error('stale publication base');
        return head;
    }
    async function files(entries,message,expectedBase,rawEntries) {
        if(rawEntries!==undefined&&(!Array.isArray(rawEntries)||rawEntries.length!==entries.length||rawEntries.some((row,i)=>!Array.isArray(row)||row.length!==2||row[0]!==entries[i][0]||typeof row[1]!=='string'||JSON.stringify(JSON.parse(row[1]))!==JSON.stringify(entries[i][1]))))throw Error('raw publication content mismatch');
        const refPath='/git/refs/heads/'+encodeURIComponent(branch);
        const head=await assertHead(expectedBase);
        if(typeof head.object?.sha!=='string')throw Error('invalid publication head');
        const parent=await api('GET','/git/commits/'+encodeURIComponent(head.object.sha));
        if(typeof parent.tree?.sha!=='string')throw Error('invalid publication tree');
        const tree=[];
        for(const [index,[path,content]] of entries.entries()){
            if(!['data/all-flights-cache.json','data/naver-prices.json','data/today-pick.json','data/price-history.json','data/crawl-log.json','data/interpark-prices.json','data/booking-link-health.json'].includes(path))throw Error('publication path refused');
            const blob=await api('POST','/git/blobs',{content:Buffer.from(rawEntries?rawEntries[index][1]:JSON.stringify(content)).toString('base64'),encoding:'base64'});
            if(typeof blob.sha!=='string')throw Error('invalid publication blob');
            tree.push({path,mode:'100644',type:'blob',sha:blob.sha});
        }
        const madeTree=await api('POST','/git/trees',{base_tree:parent.tree.sha,tree});
        if(typeof madeTree.sha!=='string')throw Error('invalid publication tree');
        const commit=await api('POST','/git/commits',{message,tree:madeTree.sha,parents:[head.object.sha]});
        if(typeof commit.sha!=='string')throw Error('invalid publication commit');
        const update=await api('PATCH',refPath,{sha:commit.sha,force:false});
        if(update.object?.sha!==commit.sha)throw Error('publication ref mismatch');
        publishedRef=commit.sha;
    }
    return {
        async publishApprovedCode({expectedBase,commitSha}){
            if(!/^[a-f0-9]{40}$/.test(expectedBase)||!/^[a-f0-9]{40}$/.test(commitSha)||expectedBase===commitSha)throw Error('invalid deployment identity');
            await assertHead(expectedBase);
            const before=await api('GET','/git/commits/'+expectedBase),after=await api('GET','/git/commits/'+commitSha);
            if(after.parents?.length!==1||after.parents[0].sha!==expectedBase)throw Error('deployment must be based on exact current head');
            const readTree=async sha=>{
                if(typeof sha!=='string'||!sha)throw Error('invalid code tree');
                const value=await api('GET','/git/trees/'+encodeURIComponent(sha)+'?recursive=1');
                if(value.truncated!==false||!Array.isArray(value.tree))throw Error('incomplete code tree');
                const entries=new Map();
                for(const item of value.tree){if(entries.has(item.path))throw Error('duplicate tree path');entries.set(item.path,item);}
                return entries;
            };
            const oldTree=await readTree(before.tree?.sha),newTree=await readTree(after.tree?.sha);
            let changed=0;
            for(const path of new Set([...oldTree.keys(),...newTree.keys()])){
                const old=oldTree.get(path),next=newTree.get(path);
                if(old?.sha===next?.sha&&old?.mode===next?.mode&&old?.type===next?.type)continue;
                if(path==='data'||path.startsWith('data/')||/(^|\/)(\.env(?:\..*)?|node_modules|\.git)(\/|$)/.test(path))throw Error('deployment changes protected content');
                if([old,next].filter(Boolean).some(x=>!(x.type==='tree'||(x.type==='blob'&&['100644','100755'].includes(x.mode)))))throw Error('deployment special entry refused');
                changed++;
            }
            if(!changed)throw Error('empty deployment');
            await assertHead(expectedBase);
            const update=await api('PATCH','/git/refs/heads/'+encodeURIComponent(branch),{sha:commitSha,force:false});
            if(update.object?.sha!==commitSha)throw Error('deployment ref mismatch');
            publishedRef=commitSha;return publishedRef;
        },
        async publishFiles(entries,expectedBase,rawEntries=undefined){await files(entries,'chore(data): publish coordinated writer result',expectedBase,rawEntries);return publishedRef;},
        attachFence(check){if(fenceCheck||typeof check!=='function')throw Error('fence already attached or invalid');fenceCheck=check;},
        async readInputs(includeSelection=false) {
            const head=await api('GET','/git/ref/heads/'+encodeURIComponent(branch));
            if(typeof head.object?.sha!=='string')throw Error('invalid input head');
            const read=async file=>{
                const value=await api('GET','/contents/data/'+file+'?ref='+encodeURIComponent(head.object.sha));
                if(value.encoding!=='base64'||typeof value.content!=='string')throw Error('invalid input content');
                return JSON.parse(Buffer.from(value.content,'base64').toString('utf8'));
            };
            const cache=await read('all-flights-cache.json'),prices=await read('naver-prices.json');
            if(!Array.isArray(cache.flights)||!prices||typeof prices!=='object')throw Error('invalid input data');
            return {ref:head.object.sha,cache,prices,...(includeSelection?{pick:await read('today-pick.json')}:{})};
        },
        async publish({cache,prices,version,expectedBase}) {
            if(version!==resultVersion(cache)||!verifyResult(cache,prices,version))throw Error('publication result mismatch');
            await files([['data/all-flights-cache.json',cache],['data/naver-prices.json',prices]],'chore(data): publish coordinated Naver result',expectedBase);
            return version;
        },
        async assertPublished(){await assertHead(publishedRef);return publishedRef;},
        async publishCacheChange(cache,expectedBase){await files([['data/all-flights-cache.json',cache]],'chore(data): publish fenced source result',expectedBase);return publishedRef;},
        async assertInput(ref){await assertHead(ref);},
        async publishTodayPick(pick){await files([['data/today-pick.json',pick]],'chore(data): preserve daily A selection',publishedRef);},
    };
}
export function createExactReadback({url,fixture=false,timeoutMs=10000}) {
    const endpoint=new URL(url);
    if(endpoint.username||endpoint.password||endpoint.hash)throw Error('readback target refused');
    if(fixture ? !['127.0.0.1','[::1]'].includes(endpoint.hostname) : endpoint.protocol!=='https:')throw Error('readback origin refused');
    return async cache=>{
        const expected=resultVersion(cache);if(!expected)throw Error('invalid expected result');
        const response=await requestHttp(endpoint,{timeoutMs,loopbackOnly:fixture});
        if(!response.ok)throw Error('readback refused');
        const data=await response.json();if(data.result_version!==expected)throw Error('readback mismatch');
        return expected;
    };
}
