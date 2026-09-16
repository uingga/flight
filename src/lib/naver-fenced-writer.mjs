import {randomUUID} from 'node:crypto';
import {mergeCacheSource} from './merge-cache-source.mjs';

// Participation wrapper. On every failure keep the durable claim; never release in finally.
export async function publishSource({client,publication,source,overlay,ttlMs=60000}) {
 const lease=await client.writerAcquire({writer:source,claim:randomUUID(),ttlMs});
 publication.attachFence(()=>client.writerCheck(lease));
 const input=await publication.readInputs();
 const nextTime=Date.parse(overlay.sourceUpdatedAt?.[source]||''),previousTime=Date.parse(input.cache.sourceUpdatedAt?.[source]||'');
 if(!Number.isFinite(nextTime)||(Number.isFinite(previousTime)&&nextTime<=previousTime))throw Error('missing or stale source generation');
 const cache=mergeCacheSource(structuredClone(input.cache),overlay,source);
 // The cloned merge target retains the marker; changed content invalidates its fingerprint.
 const observed=await publication.publishCacheChange(cache,input.ref);
 if(await publication.assertPublished()!==observed)throw Error('source publication mismatch');
 await client.writerObserved({...lease,observed});await client.writerRelease({...lease,observed});
 return observed;
}
