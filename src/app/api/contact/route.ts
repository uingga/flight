import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { CONTACT_TYPES, isContactType, validContactImage, CONTACT_IMAGE_LIMIT } from '@/lib/contact';
import {
    getRequestFingerprint,
    hashAuthValue,
    isSameOriginRequest,
    normalizeEmail,
} from '@/lib/server/account-auth';
import { supabaseRest } from '@/lib/server/supabase-rest';

const MAX_BODY_BYTES = 1_450_000;

function json(body: Record<string, unknown>, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store, private' },
    });
}

function cleanSingleLine(value: unknown, maxLength: number) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

async function takeRateLimit(scope: string, keyHash: string, windowSeconds: number, limit: number) {
    return supabaseRest<boolean>('rpc/tikitikit_take_rate_limit', {
        method: 'POST',
        body: JSON.stringify({
            p_scope: scope,
            p_key_hash: keyHash,
            p_window_seconds: windowSeconds,
            p_limit: limit,
        }),
    });
}

async function readBody(request: NextRequest) {
    const declaredSize = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) return { tooLarge: true } as const;
    const reader = request.body?.getReader();
    if (!reader) return { invalid: true } as const;
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let raw = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        if (bytesRead > MAX_BODY_BYTES) {
            await reader.cancel();
            return { tooLarge: true } as const;
        }
        raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    try {
        return { input: JSON.parse(raw) as Record<string, unknown> } as const;
    } catch {
        return { invalid: true } as const;
    }
}

export async function POST(request: NextRequest) {
    if (!isSameOriginRequest(request)) return json({ error: '잘못된 요청입니다.' }, 403);
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        return json({ error: '잘못된 요청입니다.' }, 415);
    }

    try {
        const parsed = await readBody(request);
        if ('tooLarge' in parsed) return json({ error: '요청이 너무 큽니다.' }, 413);
        if ('invalid' in parsed) return json({ error: '잘못된 요청입니다.' }, 400);

        const rawName = parsed.input.name;
        const rawEmail = parsed.input.email;
        const rawMessage = parsed.input.message;
        const name = cleanSingleLine(rawName, 80);
        const emailText = typeof rawEmail === 'string' ? rawEmail.trim() : '';
        const email = emailText ? normalizeEmail(emailText) : null;
        const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';
        const category = parsed.input.category ?? 'question';
        const attachment = parsed.input.attachment || null;
        if (!isContactType(category)) return json({ error: '문의 유형을 확인해주세요.' }, 400);
        if (attachment) {
            if (!validContactImage(attachment)) return json({ error: '1MB 이하 PNG 또는 JPG 이미지만 첨부할 수 있어요.' }, 400);
            const bytes = Buffer.from(attachment.split(',')[1], 'base64');
            const png = attachment.startsWith('data:image/png;') && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
            const jpeg = attachment.startsWith('data:image/jpeg;') && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
            if ((!png && !jpeg) || bytes.length > CONTACT_IMAGE_LIMIT) return json({ error: '이미지 파일을 확인해주세요.' }, 400);
        }

        // 입력 검증
        if (!message) {
            return json({ error: '문의 내용을 입력해주세요.' }, 400);
        }
        if (message.length > 2000) {
            return json({ error: '문의 내용은 2000자 이내로 작성해주세요.' }, 400);
        }
        if (typeof rawName === 'string' && rawName.trim().length > 80) {
            return json({ error: '이름은 80자 이내로 입력해주세요.' }, 400);
        }
        if (emailText && !email) {
            return json({ error: '이메일 주소를 확인해주세요.' }, 400);
        }

        // 이메일 설정 - GMAIL_APP_PASS 우선, EMAIL_PASS 폴백
        const emailUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
        const emailPass = (process.env.GMAIL_APP_PASS || process.env.EMAIL_PASS || '').replace(/\s/g, '');

        const requestHash = getRequestFingerprint(request);
        const globalHash = hashAuthValue('contact-rate', 'global');
        const localRateChecks = await Promise.all([
            takeRateLimit('contact_ip_hour', requestHash, 60 * 60, 3),
            takeRateLimit('contact_ip_day', requestHash, 24 * 60 * 60, 10),
        ]);
        if (localRateChecks.some(allowed => !allowed)) {
            return json({ error: '문의 요청이 많습니다. 잠시 후 다시 시도해주세요.' }, 429);
        }
        const globallyAllowed = await takeRateLimit('contact_global_day', globalHash, 24 * 60 * 60, 100);
        if (!globallyAllowed) {
            return json({ error: '문의 요청이 많습니다. 잠시 후 다시 시도해주세요.' }, 429);
        }

        const id = randomUUID();
        await supabaseRest('contact_inquiries', {
            method: 'POST',
            body: JSON.stringify({ id, category, name, email, message, attachment }),
        });
        // The inbox is authoritative. Notification failure must not prompt duplicate submissions.
        if (!emailUser || !emailPass) return json({ success: true, id });
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: emailUser,
                pass: emailPass,
            },
        });

        try { await transporter.sendMail({
            from: `"티키티킷 문의" <${emailUser}>`,
            to: 'uingga@gmail.com',
            subject: `[티키티킷 문의] ${CONTACT_TYPES[category]} · ${id.slice(0, 8)}`,
            html: '<p>새 문의가 접수되었습니다. 티키티킷 어드민의 문의함에서 확인해주세요.</p>',
        }); } catch {
            console.error('Contact notification failed; inquiry is saved');
        }

        return json({ success: true, id });
    } catch (error: unknown) {
        console.error('문의 이메일 발송 실패:', error instanceof Error ? error.message : 'unknown');
        return json({ error: '전송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 500);
    }
}
