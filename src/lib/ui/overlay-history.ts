'use client';

type OverlayState = Record<string, unknown> & {
    tikitikitOverlay?: string;
};

function currentUrl() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/** 현재 URL을 유지한 채 뒤로가기로 닫을 수 있는 UI 레이어를 연다. */
export function showOverlayWithHistory(
    overlay: string,
    show: () => void,
    state: OverlayState = {},
) {
    const currentState = (window.history.state || {}) as OverlayState;
    if (currentState.tikitikitOverlay !== overlay) {
        window.history.pushState(
            { ...currentState, ...state, tikitikitOverlay: overlay },
            '',
            currentUrl(),
        );
    }
    show();
}

/** 최상단 이력 레이어는 popstate가 확인된 뒤 닫아 UI와 URL의 순서를 맞춘다. */
export function dismissOverlayWithHistory(overlay: string, dismiss: () => void) {
    if (window.history.state?.tikitikitOverlay === overlay) {
        window.history.back();
        return;
    }
    dismiss();
}

export function historyOverlay() {
    return typeof window === 'undefined'
        ? null
        : (window.history.state?.tikitikitOverlay as string | undefined) || null;
}
