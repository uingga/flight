import bootstrap from './modetour-history-bootstrap.json';
import {mergeModetourOfferHistory,restoreModetourOffers} from './modetour-offer-history.mjs';
import type {Flight} from '../types/flight';
export function modetourHistory(cache: {modetourOfferHistory?: object}) {
    return mergeModetourOfferHistory(bootstrap,cache.modetourOfferHistory);
}
export function restoreModetourHistory(cache: {flights: Flight[];modetourOfferHistory?: object}): Flight[] {
    return restoreModetourOffers(cache.flights,modetourHistory(cache));
}
