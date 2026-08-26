import { NextRequest, NextResponse } from 'next/server';
import { GET as getLocalFlights } from '../flights/route';

const LIVE_FLIGHTS_URL = 'https://www.tikitikit.kr/api/flights';

/**
 * The long-lived redesign preview is deployed from a separate branch, while crawler
 * commits land on main. Proxying the live public feed keeps design QA on current data
 * without copying crawler commits into the preview branch after every run.
 */
export async function GET(request: NextRequest) {
    const liveUrl = new URL(LIVE_FLIGHTS_URL);
    request.nextUrl.searchParams.forEach((value, key) => liveUrl.searchParams.append(key, value));

    try {
        const response = await fetch(liveUrl, {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`live flights ${response.status}`);

        return new NextResponse(await response.text(), {
            status: response.status,
            headers: {
                'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Robots-Tag': 'noindex, nofollow',
                'X-Tikitikit-Preview-Data': 'live',
            },
        });
    } catch (error) {
        // A live-site outage should not make the preview unusable. Its branch cache is
        // older, but still more useful for layout work than an empty screen.
        console.error('Preview live flight proxy failed; using branch cache:', error);
        const fallback = await getLocalFlights(request);
        fallback.headers.set('Cache-Control', 'no-store');
        fallback.headers.set('X-Robots-Tag', 'noindex, nofollow');
        fallback.headers.set('X-Tikitikit-Preview-Data', 'branch-fallback');
        return fallback;
    }
}
