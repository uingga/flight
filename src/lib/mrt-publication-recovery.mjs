import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {mergeCacheSource} from './merge-cache-source.mjs';
export function publicationFailure(error){
 const code=String(error?.code||''),status=Number(error?.httpStatus)||null;
 const category=code==='ENOBUFS'||status===413?'capacity':
  [401,403].includes(status)?'authorization':code==='ECONNREFUSED'?'connection_refused':'outcome_unknown';
 return {category,code:code||null,httpStatus:status,automaticRetry:false};
}
const flights=cache=>(cache.flights||[]).filter(f=>f.source==='myrealtrip').sort((a,b)=>String(a.id).localeCompare(String(b.id)));
export function planMrtRecovery({current,archived,manifest,failure,resolvedCategory,now=Date.now()}){
 if(manifest?.collector!=='success'||!Array.isArray(archived?.flights)||!Array.isArray(current?.flights))throw Error('verified successful collection required');
 const incoming=Date.parse(archived.sourceUpdatedAt?.myrealtrip),existing=Date.parse(current.sourceUpdatedAt?.myrealtrip);
 const slot=Date.parse(manifest.ticket?.slot);
 if(!Number.isFinite(incoming)||!Number.isFinite(slot)||incoming<slot||incoming>now+300000)throw Error('invalid collection timestamp');
 if(!flights(archived).length)throw Error('empty recovery refused');
 if(flights(current).length&&!Number.isFinite(existing))return {action:'hold',reason:'current_source_timestamp_unknown'};
 for(const cache of [current,archived]){const c=cache.sourceCircuits?.myrealtrip;if(c&&(!Number.isFinite(Date.parse(c.nextProbeAt))||Date.parse(c.nextProbeAt)>now))return {action:'hold',reason:'source_circuit'};}
 if(existing>incoming)return {action:'skip',reason:'newer_source_already_published'};
 if(existing===incoming)return isDeepStrictEqual(flights(current),flights(archived))?{action:'skip',reason:'source_already_published'}:{action:'hold',reason:'same_timestamp_different_content'};
 if(!['capacity','authorization','connection_refused'].includes(failure?.category))return {action:'hold',reason:'publication_outcome_requires_readback_and_inflight_review'};
 if(resolvedCategory!==failure.category)return {action:'hold',reason:'diagnose_and_resolve_before_publication',category:failure.category};
 return {action:'publish',cache:mergeCacheSource(structuredClone(current),structuredClone(archived),'myrealtrip')};
}
export function verifyMrtArchive({manifest,cacheRaw,logsRaw}){
 if(manifest?.version!==1||manifest.collector!=='success'||!/^[a-f0-9]{40}$/.test(manifest.ticket?.owner||''))throw Error('invalid successful archive manifest');
 for(const [name,raw] of [['all-flights-cache.json',cacheRaw],['crawl-log.json',logsRaw]])if(createHash('sha256').update(raw).digest('hex')!==manifest.hashes?.[name])throw Error('archive hash mismatch');
 return {cache:JSON.parse(cacheRaw),logs:JSON.parse(logsRaw)};
}
