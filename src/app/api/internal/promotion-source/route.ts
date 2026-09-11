import { handlePromotionSource } from '@/lib/server/promotion-source-handler';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request) { return handlePromotionSource(request); }
