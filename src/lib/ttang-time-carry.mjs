// Carry schedules only, never availability or a fabricated verification timestamp.
const times=f=>[f.departure?.time,f.departure?.arrivalTime,f.arrival?.time,f.arrival?.arrivalTime];
const complete=f=>times(f).every(v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v));
const key=f=>[f.id,f.airline?.trim(),f.departure?.airport,f.arrival?.airport,f.departure?.date,f.arrival?.date].join('|');
const product=f=>f.ttangProduct?.masterId&&f.ttangProduct?.fareId?`${f.ttangProduct.masterId}|${f.ttangProduct.fareId}`:'';
export function carryTtangTimes(current, previous) {
    const old=new Map(),groups=new Map();
    for(const f of previous)if(f.source==='ttang'&&complete(f))old.set(key(f),[...(old.get(key(f))||[]),f]);
    for(const f of current)if(f.source==='ttang')groups.set(key(f),[...(groups.get(key(f))||[]),f]);
    let restored=0;
    for(const f of current) {
        if(f.source!=='ttang'||complete(f)||times(f).some(Boolean)||!f.id||!f.airline
            ||![f.departure?.airport,f.arrival?.airport,f.departure?.date,f.arrival?.date].every(Boolean))continue;
        const candidates=(old.get(key(f))||[]).filter(p=>!product(p)||product(p)===product(f));
        if(!candidates.length)continue;
        const exact=candidates.filter(p=>product(p)&&product(p)===product(f));
        const eligible=exact.length?exact:candidates;
        if(!exact.length&&new Set(groups.get(key(f)).map(product)).size>1)continue;
        if(new Set(eligible.map(p=>JSON.stringify(times(p)))).size!==1)continue;
        const prev=eligible[0];
        [f.departure.time,f.departure.arrivalTime,f.arrival.time,f.arrival.arrivalTime]=times(prev);
        const prior=prev.ttangTimeProvenance;
        f.ttangTimeProvenance=prior?{...prior}:{kind:exact.length?'product-cache':'legacy-cache',sourceFlightId:prev.id,
            ...(prev.detailCheckedAt?{checkedAt:prev.detailCheckedAt}:{})};
        if(exact.length&&prev.detailCheckedAt)f.detailCheckedAt=prev.detailCheckedAt;
        restored++;
    }
    return restored;
}
