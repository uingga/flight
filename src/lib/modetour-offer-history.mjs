// Listing visibility is not product discovery. Retain small offer records until departure.
const date = value => String(value || '').replace(/\./g, '-').slice(0, 10);
const text = value => String(value || '').normalize('NFKC').toUpperCase().replace(/[\s()\[\]{}._/-]+/g, '');
const timestamp = value => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value+'T00:00:00+09:00' : value || '') || 0;
const earliest = (a,b) => !timestamp(a) ? b : !timestamp(b) ? a : timestamp(a)<=timestamp(b) ? a : b;
export function modetourOfferKey(flight) {
    if(flight?.source!=='modetour'||!flight.id)return null;
    const numbers=String(flight.flightNumber||'').split(/[\s,/|]+/).filter(Boolean);
    return JSON.stringify([flight.id,text(flight.departure?.airport||flight.departure?.city),text(flight.arrival?.airport||flight.arrival?.city),
        date(flight.departure?.date),date(flight.arrival?.date),text(flight.airline),
        text(flight.modetourDetail?.departureFlightNo||numbers[0]),text(flight.modetourDetail?.returnFlightNo||numbers[1])]);
}
export function mergeModetourOfferRecord(a,b) {
    if(!a)return structuredClone(b);if(!b)return structuredClone(a);
    const newer=timestamp(a.news.observedAt)>timestamp(b.news.observedAt)?a:b;
    const older=newer===a?b:a;
    const news={...newer.news,firstSeenAt:earliest(a.news.firstSeenAt,b.news.firstSeenAt),lowestPrice:Math.min(a.news.lowestPrice,b.news.lowestPrice)};
    // A reversal to an already observed price is not a new price drop.
    if(news.drop && (news.drop.to>news.lowestPrice || (older.news.lowestPrice<=news.drop.to
        && timestamp(older.news.observedAt)<timestamp(news.drop.at) && older.news.drop?.at!==news.drop.at)))delete news.drop;
    return {...newer,firstSeen:earliest(a.firstSeen,b.firstSeen),news};
}
export function mergeModetourOfferHistory(...histories) {
    const result={};
    for(const history of histories)for(const [key,row] of Object.entries(history||{}))result[key]=mergeModetourOfferRecord(result[key],row);
    return result;
}
export function rememberModetourOffers(history,flights,observedAt) {
    const result=mergeModetourOfferHistory(history);
    for(const f of flights){const key=modetourOfferKey(f);if(!key||!(f.price>0))continue;
        const first=f.firstSeen||date(observedAt);
        const news=f.recommendationNews||{firstSeenAt:new Date(timestamp(first)||timestamp(observedAt)).toISOString(),observedAt:f.priceCheckedAt||observedAt,price:f.price,lowestPrice:f.price};
        result[key]=mergeModetourOfferRecord(result[key],{firstSeen:first,departureDate:date(f.departure?.date),news});
    }
    const today=new Date(timestamp(observedAt)+9*3600000).toISOString().slice(0,10);
    for(const [key,row] of Object.entries(result))if(row.departureDate<today)delete result[key];
    return result;
}
export function restoreModetourOffers(flights,history) {
    return flights.map(f=>{const key=modetourOfferKey(f),saved=key&&history?.[key];if(!saved)return f;
        const current=f.recommendationNews?{firstSeen:f.firstSeen,departureDate:date(f.departure?.date),news:f.recommendationNews}:null;
        const row=current?mergeModetourOfferRecord(saved,current):saved;
        return {...f,firstSeen:row.firstSeen,recommendationNews:{...row.news,firstSeenAt:row.news.firstSeenAt}};
    });
}
