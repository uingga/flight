import { unstable_cache } from 'next/cache';
import { createPublicFlightsResponse } from './public-flights-response';

// Share the API's preparation without an HTTP round trip. Short revalidation keeps
// initial HTML fast while refreshing reports, manual placements and comparisons.
export const loadHomeFlightSnapshot = unstable_cache(async () => {
    const response = await createPublicFlightsResponse(new URLSearchParams('sortBy=price&sortOrder=asc'));
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error('Home flight snapshot unavailable');
    return data;
}, ['home-flight-snapshot-v2-naver-offer-gate'], { revalidate: 60 });
