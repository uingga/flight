import {requestHttp} from './naver-http-request.mjs';
const proofs=new WeakSet();
export function requireAuthority(proof,scope){
 if(!proofs.has(proof)||proof.fixture)throw Error('unverified publisher authority');
 if(scope&&(scope.repository!==proof.repository||scope.branch!==proof.branch))throw Error('publisher authority scope mismatch');
}
export async function verifyWriterAuthority({repository,branch,appId,rulesetId,token,origin='https://api.github.com',fixture=false}){
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!Number.isSafeInteger(appId)||!Number.isSafeInteger(rulesetId))throw Error('authority configuration missing');
 const u=new URL(origin);if(fixture?!['127.0.0.1','[::1]'].includes(u.hostname):u.origin!=='https://api.github.com')throw Error('authority origin refused');
 const get=async suffix=>{const r=await requestHttp(u.origin+suffix,{headers:{authorization:`Bearer ${typeof token==='function'?await token():token}`,'user-agent':'tikitikit-authority'},loopbackOnly:fixture});if(!r.ok)throw Error('authority read refused');return r.json();};
 const rule=await get(`/repos/${repository}/rulesets/${rulesetId}`);
 const actors=rule.bypass_actors||[],refs=rule.conditions?.ref_name;
 if(rule.target!=='branch'||rule.enforcement!=='active'||rule.source!==repository||rule.source_type!=='Repository'
  ||refs?.include?.length!==1||refs.include[0]!==`refs/heads/${branch}`||refs.exclude?.length!==0
  ||actors.length!==1||actors[0].actor_type!=='Integration'||actors[0].actor_id!==appId||actors[0].bypass_mode!=='always'
  ||!['update','deletion','non_fast_forward'].every(type=>rule.rules?.some(r=>r.type===type)))throw Error('exclusive writer ruleset not established');
 const installed=await get('/installation/repositories?per_page=100');
 if(!installed.repositories?.some(r=>r.full_name===repository))throw Error('installation repository mismatch');
 // The installation token provider is bound to the configured App private key.
 const proof=Object.freeze({repository,branch,appId,rulesetId,fixture});proofs.add(proof);return proof;
}
