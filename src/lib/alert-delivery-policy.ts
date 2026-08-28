export type PushFailurePolicy = 'deactivate-expired-subscription' | 'keep-active';

/** Web Push의 영구 만료 응답만 구독 비활성화 대상으로 분류한다. */
export function classifyPushFailure(statusCode?: number): PushFailurePolicy {
    return statusCode === 404 || statusCode === 410
        ? 'deactivate-expired-subscription'
        : 'keep-active';
}

/** DB 요청과 분리된 순수 정책 객체. endpoint나 구독/DB 식별자를 포함하지 않는다. */
export function expiredSubscriptionUpdate(
    statusCode: number | undefined,
    updatedAt: string,
): { active: false; delivery_claimed_at: null; updated_at: string } | null {
    if (classifyPushFailure(statusCode) !== 'deactivate-expired-subscription') return null;
    return {
        active: false,
        delivery_claimed_at: null,
        updated_at: updatedAt,
    };
}
