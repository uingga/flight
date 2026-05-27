import { NextRequest, NextResponse } from 'next/server';

interface AlertSubscription {
    id: string;
    subscription: PushSubscriptionJSON;
    conditions: {
        route?: string;       // e.g. "오사카", "도쿄"
        maxPrice?: number;    // e.g. 200000
        region?: string;      // e.g. "일본", "동남아"
    };
    createdAt: string;
    lastSent?: string;
}

const GITHUB_OWNER = 'uingga';
const GITHUB_REPO = 'flight';
const ALERTS_PATH = 'data/alerts.json';

async function getAlertsFromGitHub(): Promise<{ alerts: AlertSubscription[]; sha: string | null }> {
    const token = process.env.GH_PAT;
    if (!token) return { alerts: [], sha: null };

    try {
        const res = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ALERTS_PATH}`,
            { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }, cache: 'no-store' }
        );
        if (!res.ok) return { alerts: [], sha: null };
        const data = await res.json();
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return { alerts: JSON.parse(content), sha: data.sha };
    } catch {
        return { alerts: [], sha: null };
    }
}

async function saveAlertsToGitHub(alerts: AlertSubscription[], sha: string | null): Promise<boolean> {
    const token = process.env.GH_PAT;
    if (!token) return false;

    const content = Buffer.from(JSON.stringify(alerts, null, 2)).toString('base64');
    const body: Record<string, unknown> = {
        message: 'chore: update alerts [skip ci]',
        content,
        branch: 'main',
    };
    if (sha) body.sha = sha;

    const res = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ALERTS_PATH}`,
        {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }
    );
    return res.ok;
}

export async function POST(request: NextRequest) {
    try {
        const { subscription, conditions } = await request.json();
        if (!subscription?.endpoint) {
            return NextResponse.json({ error: 'subscription required' }, { status: 400 });
        }

        const id = Buffer.from(subscription.endpoint).toString('base64').slice(-20);
        const { alerts, sha } = await getAlertsFromGitHub();

        // 같은 endpoint가 있으면 업데이트
        const existing = alerts.findIndex(a => a.id === id);
        const newAlert: AlertSubscription = {
            id,
            subscription,
            conditions: conditions || {},
            createdAt: new Date().toISOString(),
        };

        if (existing >= 0) {
            alerts[existing] = newAlert;
        } else {
            alerts.push(newAlert);
        }

        const saved = await saveAlertsToGitHub(alerts, sha);
        if (!saved) {
            return NextResponse.json({ error: 'failed to save' }, { status: 500 });
        }

        return NextResponse.json({ ok: true, id });
    } catch (error) {
        console.error('Alert API error:', error);
        return NextResponse.json({ error: 'internal error' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { endpoint } = await request.json();
        if (!endpoint) {
            return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
        }

        const id = Buffer.from(endpoint).toString('base64').slice(-20);
        const { alerts, sha } = await getAlertsFromGitHub();
        const filtered = alerts.filter(a => a.id !== id);

        if (filtered.length === alerts.length) {
            return NextResponse.json({ ok: true, message: 'not found' });
        }

        await saveAlertsToGitHub(filtered, sha);
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('Alert DELETE error:', error);
        return NextResponse.json({ error: 'internal error' }, { status: 500 });
    }
}
