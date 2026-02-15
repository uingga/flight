import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE_PATH = path.join(process.cwd(), 'data', 'crawl-log.json');
const ADMIN_KEY = process.env.ADMIN_KEY || 'tikit2026';

export async function GET(request: NextRequest) {
    const key = request.nextUrl.searchParams.get('key');

    if (key !== ADMIN_KEY) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        if (!fs.existsSync(LOG_FILE_PATH)) {
            return NextResponse.json({ entries: [] });
        }

        const data = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(data);

        return NextResponse.json(parsed);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to read crawl log' }, { status: 500 });
    }
}
