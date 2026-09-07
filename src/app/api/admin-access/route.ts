import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const adminKey = process.env.ADMIN_KEY;
    const authorized = Boolean(adminKey && request.headers.get('x-admin-key') === adminKey);

    return NextResponse.json({ authorized }, {
        status: authorized ? 200 : 401,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}
