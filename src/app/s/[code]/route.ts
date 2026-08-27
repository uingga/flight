import { NextRequest, NextResponse } from 'next/server';
import { decodeShareCode } from '@/lib/share-code';

type RouteContext = {
    params: Promise<{ code: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
    const { code } = await params;
    const flightId = decodeShareCode(decodeURIComponent(code));
    if (!flightId) return NextResponse.redirect(new URL('/', request.url), 302);

    const destination = new URL(`/share/${encodeURIComponent(flightId)}`, request.url);
    request.nextUrl.searchParams.forEach((value, key) => destination.searchParams.set(key, value));

    return NextResponse.redirect(destination, 307);
}
