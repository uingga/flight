import {createSign} from 'node:crypto';
import {requestHttp} from './naver-http-request.mjs';
export function installationTokenProvider({appId,installationId,privateKey,repository,request=requestHttp,workflows=false}){
 if(!Number.isSafeInteger(appId)||!Number.isSafeInteger(installationId)||!privateKey)throw Error('App configuration missing');
 let cached=null,expires=0;
 return async()=>{
  if(cached&&Date.now()<expires-60000)return cached;
  const now=Math.floor(Date.now()/1000),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const input=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:now-30,exp:now+300,iss:String(appId)});
  const signer=createSign('RSA-SHA256');signer.update(input);signer.end();const jwt=input+'.'+signer.sign(privateKey,'base64url');
  const r=await request(`https://api.github.com/app/installations/${installationId}/access_tokens`,{method:'POST',headers:{authorization:`Bearer ${jwt}`,'content-type':'application/json','user-agent':'tikitikit-publisher'},body:JSON.stringify({repositories:[repository.split('/')[1]],permissions:{contents:'write',administration:'read',...(workflows?{workflows:'write'}:{})}})});
  if(!r.ok)throw Error('App token issuance refused');const body=await r.json();
  if(typeof body.token!=='string'||body.permissions?.contents!=='write'||body.permissions?.administration!=='read'||(workflows&&body.permissions?.workflows!=='write'))throw Error('App token scope mismatch');
  expires=Date.parse(body.expires_at);if(!Number.isFinite(expires)||expires<=Date.now())throw Error('App token expired');cached=body.token;return cached;
 };
}
