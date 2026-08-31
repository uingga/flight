import type { ReactNode } from 'react';
import MobileRedesignPreview from '@/app/preview/mobile-redesign/MobileRedesignPreview';
import type { Flight } from '@/types/flight';

interface RedesignDashboardProps {
    children?: ReactNode;
    initialFlights?: Flight[];
    initialFlightCount?: number;
    initialLastUpdated?: string | null;
    initialTodayPickId?: string | null;
}

/**
 * 운영 메인 교체용 진입점.
 * 페이지의 유일한 main 안에서 쓰도록 루트는 div로 렌더링하고,
 * 서버 렌더링 콘텐츠(children)는 리디자인 푸터 바로 앞에 배치한다.
 */
export default function RedesignDashboard({
    children,
    initialFlights,
    initialFlightCount,
    initialLastUpdated,
    initialTodayPickId,
}: RedesignDashboardProps) {
    return (
        <MobileRedesignPreview
            previewMode={false}
            rootAs="div"
            beforeFooter={children}
            initialFlights={initialFlights}
            initialFlightCount={initialFlightCount}
            initialLastUpdated={initialLastUpdated}
            initialTodayPickId={initialTodayPickId}
        />
    );
}
