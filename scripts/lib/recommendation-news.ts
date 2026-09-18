import type {Flight} from '../../src/types/flight';
import {flightOfferHistory} from '../../src/lib/flight-history';
import {recordFlightOfferNews} from '../../src/lib/flight-offer-history.mjs';
/** Preserve discovery across disappearance; observation itself is not publication. */
export function recordRecommendationNews(previous:Flight[],next:Flight[],observedAt:string,retainedHistory?:object):Flight[]{
    return recordFlightOfferNews(previous,next,observedAt,retainedHistory??flightOfferHistory({}));
}
