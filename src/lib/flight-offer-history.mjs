// Listing visibility is not product discovery. Retain small offer records until departure.
const date = value => String(value || '').replace(/\./g, '-').slice(0, 10);
const text = value => String(value || '').normalize('NFKC').toUpperCase().replace(/[\s()\[\]{}._/-]+/g, '');
const timestamp = value => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value+'T00:00:00+09:00' : value || '') || 0;
const earliest = (a,b) => !timestamp(a) ? b : !timestamp(b) ? a : timestamp(a)<=timestamp(b) ? a : b;
function legacyModetourKey(flight) {
    if(flight?.source!=='modetour'||!flight.id)return null;
    const numbers=String(flight.flightNumber||'').split(/[\s,/|]+/).filter(Boolean);
    return JSON.stringify([flight.id,text(flight.departure?.airport||flight.departure?.city),text(flight.arrival?.airport||flight.arrival?.city),
        date(flight.departure?.date),date(flight.arrival?.date),text(flight.airline),
        text(flight.modetourDetail?.departureFlightNo||numbers[0]),text(flight.modetourDetail?.returnFlightNo||numbers[1])]);
}
export const OFFER_HISTORY_SOURCES=['ybtour','hanatour','modetour','onlinetour','ttang','myrealtrip'];
export const effectiveOfferPrice=f=>Number(f.price)+(f.source==='ttang'?20000:0);
export function flightOfferKey(f) {
    if(!OFFER_HISTORY_SOURCES.includes(f?.source))return null;
    if(f.source==='modetour')return legacyModetourKey(f);
    const dep=text(f.departure?.airport||f.departure?.city),arr=text(f.arrival?.airport||f.arrival?.city),out=date(f.departure?.date),back=date(f.arrival?.date),airline=text(f.airline);
    if(!dep||!arr||!airline||!/^\d{4}-\d{2}-\d{2}$/.test(out)||!/^\d{4}-\d{2}-\d{2}$/.test(back))return null;
    const numbers=String(f.flightNumber||'').split(/[\s,/|]+/).filter(Boolean);
    let product=null;
    if(['onlinetour','ttang'].includes(f.source)){if(!f.id)return null;product=f.id;}
    // Search-generated IDs and prices are not product identity for these sources.
    return JSON.stringify([f.source,product,dep,arr,out,back,airline,text(numbers[0]||f.departure?.time),text(numbers[1]||f.arrival?.time)]);
}
export function historyForSource(history,source) {
    return Object.fromEntries(Object.entries(history||{}).filter(([key,row])=>row.source===source||source==='modetour'&&!row.source&&key.startsWith('["modetour-')));
}
export function mergeFlightOfferRecord(a,b) {
    if(!a)return structuredClone(b);if(!b)return structuredClone(a);
    const newer=timestamp(a.news.observedAt)>timestamp(b.news.observedAt)?a:b;
    const older=newer===a?b:a;
    const news={...newer.news,firstSeenAt:earliest(a.news.firstSeenAt,b.news.firstSeenAt),lowestPrice:Math.min(a.news.lowestPrice,b.news.lowestPrice)};
    // A reversal to an already observed price is not a new price drop.
    if(news.drop && (news.drop.to>news.lowestPrice || (older.news.lowestPrice<=news.drop.to
        && timestamp(older.news.observedAt)<timestamp(news.drop.at) && older.news.drop?.at!==news.drop.at)))delete news.drop;
    if(news.priceDrop && (news.priceDrop.to>news.lowestPrice || (older.news.lowestPrice<=news.priceDrop.to
        && timestamp(older.news.observedAt)<timestamp(news.priceDrop.at) && older.news.priceDrop?.at!==news.priceDrop.at)))news.priceDrop=null;
    return {...newer,firstSeen:earliest(a.firstSeen,b.firstSeen),news};
}
export function mergeFlightOfferHistory(...histories) {
    const result={};
    for(const history of histories)for(const [key,row] of Object.entries(history||{}))result[key]=mergeFlightOfferRecord(result[key],row);
    return result;
}
export function rememberFlightOffers(history,flights,observedAt) {
    const result=mergeFlightOfferHistory(history);
    for(const f of flights){const key=flightOfferKey(f);if(!key||!(f.price>0))continue;
        const first=f.firstSeen||date(observedAt);
        const price=effectiveOfferPrice(f);
        const news=f.recommendationNews||{firstSeenAt:new Date(timestamp(first)||timestamp(observedAt)).toISOString(),observedAt:f.priceCheckedAt||observedAt,price,lowestPrice:price};
        result[key]=mergeFlightOfferRecord(result[key],{source:f.source,firstSeen:first,departureDate:date(f.departure?.date),news});
    }
    const today=new Date(timestamp(observedAt)+9*3600000).toISOString().slice(0,10);
    for(const [key,row] of Object.entries(result))if(row.departureDate<today)delete result[key];
    return result;
}
export function restoreFlightOffers(flights,history) {
    return flights.map(f=>{const key=flightOfferKey(f),saved=key&&history?.[key];if(!saved)return f;
        const current=f.recommendationNews?{firstSeen:f.firstSeen,departureDate:date(f.departure?.date),news:f.recommendationNews}:null;
        const row=current?mergeFlightOfferRecord(saved,current):saved;
        return {...f,firstSeen:row.firstSeen,recommendationNews:{...row.news,firstSeenAt:row.news.firstSeenAt}};
    });
}

/** Pure source-observation transform. No requests, scheduling or storage side effects. */
export function recordFlightOfferNews(previous, next, observedAt, retainedHistory={}) {
    const observed = Date.parse(observedAt);
    if (!Number.isFinite(observed)) throw new Error('Invalid recommendation observation time');
    const retained=retainedHistory;
    const before=new Map(restoreFlightOffers(previous,retained).filter(f=>flightOfferKey(f)).map(f=>[flightOfferKey(f),f]));
    return next.map(flight => {
        const saved=retained[flightOfferKey(flight) || ''];
        const old = before.get(flightOfferKey(flight)) || (saved ? {...flight,price:saved.news.price,firstSeen:saved.firstSeen,recommendationNews:saved.news} : undefined);
        const prior = old?.recommendationNews;
        const price = effectiveOfferPrice(flight);
        if (!Number.isFinite(price) || price <= 0) return flight;
        if (prior && observed <= Date.parse(prior.observedAt)) {
            return { ...flight, firstSeen:old?.firstSeen || flight.firstSeen, recommendationNews: prior };
        }
        const previousPrice = prior?.price ?? (old ? effectiveOfferPrice(old) : price);
        const floor = prior?.lowestPrice ?? previousPrice;
        const currentDay = new Date(observed + 9 * 3600000).toISOString().slice(0,10);
        const suppliedFirst = !old && flight.firstSeen === currentDay ? observed : timestamp(old?.firstSeen || flight.firstSeen);
        const first = prior?.firstSeenAt || new Date(suppliedFirst
            || (old ? timestamp(old.priceCheckedAt) : 0) || observed).toISOString();
        const news = {
            firstSeenAt: first, observedAt, price, lowestPrice: Math.min(floor, price),
        };
        // Keep the insight event separate: a 10,000 KRW decline need not earn ranking's 5% bonus.
        news.priceDrop = null;
        if (price === previousPrice) {
            const retainedDrop = prior?.priceDrop === undefined ? prior?.drop : prior.priceDrop;
            if (retainedDrop?.to === price) news.priceDrop = retainedDrop;
        }
        if (old && price < floor && previousPrice - price >= 10_000) {
            news.priceDrop = { at: observedAt, from: previousPrice, to: price };
            const priorTime = prior?.observedAt || old.priceCheckedAt;
            if (timestamp(priorTime) && timestamp(priorTime) < observed) news.priceDrop.previousObservedAt = priorTime;
        }
        if (prior?.drop && price === previousPrice && price === prior.drop.to) news.drop = prior.drop;
        // Require a new observed low to prevent an increase/reversal earning the same bonus again.
        if (old && price < floor && previousPrice - price >= 10_000
            && (previousPrice - price) / previousPrice >= 0.05) {
            news.drop = { at: observedAt, from: previousPrice, to: price };
        }
        return { ...flight, firstSeen:old?.firstSeen || flight.firstSeen, recommendationNews: news };
    });
}
