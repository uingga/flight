// Compatibility exports for existing Mode-only consumers and verified bootstrap data.
import {flightOfferKey,mergeFlightOfferRecord,mergeFlightOfferHistory,rememberFlightOffers,restoreFlightOffers} from './flight-offer-history.mjs';
export const modetourOfferKey=f=>f?.source==='modetour'?flightOfferKey(f):null;
export const mergeModetourOfferRecord=mergeFlightOfferRecord;
export const mergeModetourOfferHistory=mergeFlightOfferHistory;
export const rememberModetourOffers=(history,flights,observedAt)=>rememberFlightOffers(history,flights.filter(f=>f.source==='modetour'),observedAt);
export const restoreModetourOffers=(flights,history)=>flights.map(f=>f.source==='modetour'?restoreFlightOffers([f],history)[0]:f);
