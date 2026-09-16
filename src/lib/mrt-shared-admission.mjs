import {randomUUID} from 'node:crypto';
// A Git ref is the shared mutex for GitHub and C. Never expire or steal it.
const ACTIVE='tags/mrt-active-v1';
const claim=slot=>'tags/mrt-slot/'+slot.replace(/[-:.]/g,'');
export async function acquireMrt(api,{slot,host,sha}) {
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(slot)||!['github','C'].includes(host)||!/^[a-f0-9]{40}$/.test(sha))throw Error('invalid admission identity');
    const parent=await api('git/commits/'+sha);
    if(parent.status!==200)throw Error('parent unavailable');
    const commit=await api('git/commits','POST',{message:JSON.stringify({kind:'mrt-owner-v1',slot,host,id:randomUUID()}),tree:parent.data.tree.sha,parents:[sha]});
    if(commit.status!==201)throw Error('owner persistence failed');
    const owner=commit.data.sha;
    const lock=await api('git/refs','POST',{ref:'refs/'+ACTIVE,sha:owner});
    if(lock.status===422)return null;
    if(lock.status!==201)throw Error('admission uncertain');
    const ticket={owner,slot,host};
    // Failed or unknown claim creation retains the lock, not an optimistic retry.
    const reserved=await api('git/refs','POST',{ref:'refs/'+claim(slot),sha:owner});
    if(reserved.status===422){await releaseMrt(api,ticket,{completed:false});return null;}
    if(reserved.status!==201)throw Error('slot reservation uncertain');
    return ticket;
}
export async function assertMrtOwner(api,ticket) {
    const r=await api('git/ref/'+ACTIVE);
    if(r.status!==200||r.data.object?.sha!==ticket.owner)throw Error('MRT ownership lost');
}
// Only call after no requests were made, or after the result/circuit was durably published.
export async function releaseMrt(api,ticket,{completed=true}={}) {
    await assertMrtOwner(api,ticket);
    if(completed){
        const name='tags/mrt-done/'+ticket.slot.replace(/[-:.]/g,'');
        const saved=await api('git/refs','POST',{ref:'refs/'+name,sha:ticket.owner});
        if(saved.status!==201){
            const prior=await api('git/ref/'+name);
            if(saved.status!==422||prior.status!==200||prior.data.object?.sha!==ticket.owner)
                throw Error('MRT completion receipt uncertain');
        }
    }
    const r=await api('git/refs/'+ACTIVE,'DELETE');
    if(r.status!==204)throw Error('MRT release uncertain');
}
