import bootstrap from './modetour-history-bootstrap.json';
import {mergeFlightOfferHistory,restoreFlightOffers} from './flight-offer-history.mjs';
import type {Flight} from '../types/flight';
type Cache={flightOfferHistory?:object;modetourOfferHistory?:object};
export function flightOfferHistory(cache:Cache){return mergeFlightOfferHistory(bootstrap,cache.modetourOfferHistory,cache.flightOfferHistory);}
export function restoreFlightHistory(cache:Cache&{flights:Flight[]}):Flight[]{return restoreFlightOffers(cache.flights,flightOfferHistory(cache));}
