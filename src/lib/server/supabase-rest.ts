import 'server-only';

type SupabaseRestInit = Omit<RequestInit, 'headers'> & {
    headers?: HeadersInit;
};

export class SupabaseRestError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'SupabaseRestError';
        this.status = status;
    }
}

export function hasSupabaseServerConfig() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * 새 sb_secret_ 키는 apikey 헤더로만 보내야 한다. 기존 JWT service_role 키는
 * 하위 호환을 위해 Authorization 헤더도 함께 보낸다.
 */
export function getSupabaseServerHeaders(serviceKey: string): Record<string, string> {
    return {
        apikey: serviceKey,
        ...(serviceKey.startsWith('sb_secret_')
            ? {}
            : { Authorization: `Bearer ${serviceKey}` }),
    };
}

/**
 * Supabase의 service role 키는 이 서버 모듈 안에서만 사용한다.
 * 호출부에는 상태 코드만 전달하고 응답 본문(사용자 정보가 포함될 수 있음)은 로그에 남기지 않는다.
 */
export async function supabaseRest<T>(resource: string, init: SupabaseRestInit = {}): Promise<T> {
    const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) {
        throw new SupabaseRestError(503, 'Account storage is not configured');
    }

    const headers = new Headers(init.headers);
    Object.entries(getSupabaseServerHeaders(serviceKey)).forEach(([name, value]) => {
        headers.set(name, value);
    });
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
        ...init,
        headers,
        cache: 'no-store',
    });

    if (!response.ok) {
        throw new SupabaseRestError(response.status, `Account storage request failed (${response.status})`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}
