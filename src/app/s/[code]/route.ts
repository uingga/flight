import { NextRequest, NextResponse } from 'next/server';
import { decodeShareCode } from '@/lib/share-code';

type RouteContext = {
    params: Promise<{ code: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
    const { code } = await params;
    const flightId = decodeShareCode(decodeURIComponent(code));
    if (!flightId) return NextResponse.redirect(new URL('/', request.url), 302);

    return NextResponse.redirect(
        new URL(`/share/${encodeURIComponent(flightId)}`, request.url),
        307,
    );
}
