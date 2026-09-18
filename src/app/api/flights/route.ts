import type { NextRequest } from 'next/server';
import { createPublicFlightsResponse } from '@/lib/server/public-flights-response';

export function GET(request: NextRequest) {
    return createPublicFlightsResponse(request.nextUrl.searchParams);
}
