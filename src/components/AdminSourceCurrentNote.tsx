import type { CurrentSourceState } from '@/lib/admin-source-current';
const time = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export default function AdminSourceCurrentNote({ state }: { state: CurrentSourceState | null }) {
    if (!state) return null;
    return <div data-source-current-state={state.kind}>
        <p>{state.message}</p>
        {state.nextEligibleAt && <p>다음 조회: {time(state.nextEligibleAt)} 이후 정규 회차</p>}
        {state.previousFailure && <details><summary>이전 실행 오류 · {time(state.previousFailure.at)}</summary>
            <p>{state.previousFailure.detail === 'remote_worker_identity_mismatch'
                ? '작업자 응답 식별 불일치. 원본의 매물 없음으로 확인된 결과가 아닙니다.' : state.previousFailure.detail}</p>
            <p>지난 실행의 기록이며, 현재 회차의 실패를 뜻하지 않습니다.</p>
        </details>}
    </div>;
}
