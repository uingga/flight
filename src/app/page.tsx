import Link from 'next/link';
import Dashboard from '@/components/Dashboard';
import { loadActiveFlights, groupByCity } from '@/lib/flight-static';
import styles from './home-city-links.module.css';

// 대시보드는 클라이언트에서 그려지므로 JS를 실행하지 않는 검색·AI 크롤러에게는
// 빈 화면이다. 빌드 시점 최저가 요약과 도시별 페이지 링크를 서버에서 렌더링해
// 크롤러와 사용자 모두 실제 데이터에 닿을 수 있게 한다. (AEO/GEO 1단계)
function HomeCityLinks() {
    const cities = groupByCity(loadActiveFlights());
    if (cities.length === 0) return null;
    const cheapest = [...cities].sort((a, b) => a.minPrice - b.minPrice).slice(0, 3);
    return (
        <section className={styles.section}>
            <h2>도시별 땡처리 항공권</h2>
            <p className={styles.summary}>
                지금 {cities.length}개 도시의 땡처리 항공권이 판매 중입니다. 왕복 최저가는{' '}
                {cheapest.map((c, i) => (
                    <span key={c.city}>
                        {i > 0 && ', '}
                        {c.city} {c.minPrice.toLocaleString('ko-KR')}원
                    </span>
                ))}
                부터입니다. 가격과 좌석은 하루 7번 갱신됩니다.
            </p>
            <ul className={styles.links}>
                {cities.slice(0, 24).map(c => (
                    <li key={c.city}>
                        <Link href={`/flights/${encodeURIComponent(c.city)}`}>
                            {c.city} {c.minPrice.toLocaleString('ko-KR')}원~
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export default function Home() {
    return (
        <main>
            <Dashboard />
            <HomeCityLinks />
        </main>
    );
}

// 리디자인을 운영 메인으로 바꿀 때는 Dashboard와 나란히 CityLinks를 두지 않는다.
// <main><RedesignDashboard><HomeCityLinks /></RedesignDashboard></main> 구조를 사용하면
// main 중첩 없이 서버 렌더링 링크가 리디자인 푸터 바로 앞에 들어간다.
