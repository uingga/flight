import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import styles from '../tips.module.css';

interface TipData {
    title: string;
    emoji: string;
    desc: string;
    content: React.ReactNode;
}

const tips: Record<string, TipData> = {
    'cheap-flights-101': {
        title: '땡처리 항공권, 이렇게 싸도 되나요?',
        emoji: '✈️',
        desc: '땡처리가 싼 이유와 가격 비교 절약법',
        content: (
            <>
                <p style={{ textAlign: 'center' }}>항공권 검색할 때, 여행사마다 가격이 다른 거 알고 계셨나요?</p>
                <p style={{ textAlign: 'center' }}>같은 날짜, 같은 비행기, 심지어 같은 좌석인데도 어디서 예매하느냐에 따라 <b>10만 원 이상</b> 차이가 납니다.</p>
                <p style={{ textAlign: 'center' }}>특히 출발이 임박한 좌석은 여행사가 재고 처리를 위해 원가 이하로 내놓기도 하는데요, 이게 바로 여행의 치트키, <b>&apos;땡처리 항공권&apos;</b>입니다.</p>

                <hr className={styles.divider} />

                <h2>✈️ 땡처리가 말도 안 되게 싼 이유</h2>
                <p>대형 여행사들은 패키지 상품을 위해 미리 대량의 좌석을 사둡니다. 하지만 출발일이 다가왔는데도 자리가 남으면 어떻게 될까요?</p>
                <p>비행기가 뜨는 순간 그 좌석은 휴지조각이 되기 때문에, 여행사는 엄청난 손해를 감수하고서라도 &apos;특가&apos;로 물량을 풉니다.</p>
                <p><b>문제는 이 특가들이 여행사마다 다르고, 몇 시간 만에 순식간에 마감된다는 겁니다.</b></p>

                <hr className={styles.divider} />

                <h2 style={{ textAlign: 'center' }}>💰 실제로 이 정도 차이가 납니다</h2>
                <p style={{ textAlign: 'center' }}>가장 인기 있는 노선 중 하나인 <b>부산→나가사키 (2박 3일)</b> 기준입니다.</p>
                <p style={{ textAlign: 'center' }}>일반 항공권 검색: <b>약 37만 원~</b></p>
                <p style={{ textAlign: 'center' }}>티키티킷 임박 특가: <span className={styles.highlight}>12만 원</span></p>
                <p style={{ textAlign: 'center' }}>항공사도 같고 구간도 같은데 <b>무려 25만 원 차이</b>가 납니다.</p>

                <div className={styles.infoBox}>
                    <p><b>💡 아낀 돈으로 여행의 질을 바꿔보세요!</b></p>
                    <p>한 사람당 25만 원을 아꼈다면, 나가사키에서 프라이빗 노천탕이 있는 고급 료칸으로 숙소를 업그레이드할 수 있습니다. 4인 가족 여행이라면 항공권에서만 100만 원 가까운 경비를 절약하게 되는 셈이죠.</p>
                </div>
            </>
        ),
    },
    'regional-airports': {
        title: '지방공항이 인천보다 싼 노선 총정리',
        emoji: '🗺️',
        desc: '부산·청주·대구 출발이 더 싼 노선 비교',
        content: (
            <>
                <p style={{ textAlign: 'center' }}>해외여행 갈 때 습관적으로 인천공항만 검색하고 계시지는 않나요?</p>
                <p style={{ textAlign: 'center' }}>출발 공항을 지방 공항으로 바꿔보면 왕복 항공권 비용을 <span className={styles.highlight}>수십만 원 가까이 아낄 수 있는 경우</span>가 정말 많습니다.</p>

                <hr className={styles.divider} />

                <h2>💡 왜 지방 공항 출발이 더 쌀까?</h2>
                <p>지방 공항은 인천공항에 비해 취항 노선이 적다고 생각하기 쉽지만, 최근 저가항공사(LCC)들이 지방 공항 출발 국제선을 앞다투어 늘렸습니다.</p>
                <p>문제는 항공편은 늘어났는데 평일이나 비수기에는 좌석을 채우지 못하는 상황. 이럴 때 여행사들의 &apos;빈자리&apos;들이 <b>땡처리 특가</b>로 시장에 풀리게 됩니다.</p>

                <hr className={styles.divider} />

                <h2>🎯 공항별 땡처리 핵심 노선</h2>
                <p><b>1. 부산(김해) 출발 ✈️ 일본 / 홍콩 / 대만</b></p>
                <p>김해공항은 지리적으로 일본과 가장 가깝습니다. (후쿠오카 비행 50분) 왕복 10만 원 초반대의 특가가 수시로 쏟아집니다.</p>
                <p><b>2. 청주 / 대구 출발 ✈️ 다낭 / 방콕 / 세부 등 동남아</b></p>
                <p>충청권/경상권 여행자들에게 최적의 선택지입니다. 인천보다 훨씬 덜 붐비는 공항에서 빠르게 수속을 마치고 싼값에 동남아 휴양지로 떠날 수 있습니다.</p>

                <div className={styles.infoBox}>
                    <p><b>🙋‍♀️ 이런 분들에게 강력 추천!</b></p>
                    <p><b>지방 거주자:</b> 인천공항까지 가는 교통비와 긴 이동 시간을 아낄 수 있습니다.</p>
                    <p><b>수도권 거주 꿀팁:</b> 성수기에 인천 출발이 50~60만 원까지 치솟을 때, KTX를 타고 지방으로 내려가서 20만 원대 특가를 타는 것이 전체 예산 면에서 훨씬 이득일 때가 많습니다.</p>
                </div>

                <div className={styles.warningBox}>
                    <p><b>⚠️ 주의:</b> 모든 노선이 싼 건 아닙니다. 예를 들어 다낭은 인천 출발이 청주·부산보다 오히려 쌉니다. <b>노선별로 확인</b>하는 게 핵심입니다.</p>
                </div>
            </>
        ),
    },
    'faq-10': {
        title: '땡처리 항공권 Q&A 10가지',
        emoji: '❓',
        desc: '환불, 수하물, 유아 동반 등 자주 묻는 질문',
        content: (
            <>
                <p style={{ textAlign: 'center' }}>땡처리 항공권에 관심은 있는데 막상 예매하려니 궁금한 게 많으시죠?</p>
                <p style={{ textAlign: 'center' }}><b>&quot;환불 돼?&quot; &quot;수하물은?&quot; &quot;아이도 탈 수 있어?&quot;</b></p>
                <p style={{ textAlign: 'center' }}>가장 많이 받는 질문 10개, 한번에 정리해봤어요 👇</p>

                <hr className={styles.divider} />

                <div className={styles.qaBlock}>
                    <p className={styles.question}><b>Q.</b> 땡처리 항공권이 정확히 뭔가요?</p>
                    <div className={styles.answer}>
                        <p>여행사가 패키지 상품용으로 미리 사둔 좌석 중 <b>출발일까지 못 판 잔여석</b>을 특가로 파는 거예요. 그래서 <b>같은 비행기, 같은 좌석인데 정가보다 훨씬 싸게</b> 살 수 있습니다.</p>
                    </div>
                </div>

                <div className={styles.qaBlock}>
                    <p className={styles.question}><b>Q.</b> 일반 항공권이랑 뭐가 다른가요?</p>
                    <div className={styles.answer}>
                        <p>비행기 자체는 <b>완전히 동일</b>합니다. 같은 항공사, 같은 기종, 같은 좌석이에요.</p>
                        <p>다른 점은:</p>
                        <p>· 출발일이 <b>임박</b>한 경우가 많음 (보통 1~4주 이내)</p>
                        <p>· 날짜/시간 <b>변경이 어렵거나 불가</b>한 경우가 많음</p>
                        <p>· 대신 가격이 <b>정가 대비 30~70% 저렴</b></p>
                    </div>
                </div>

                <div className={styles.qaBlock}>
                    <p className={styles.question}><b>Q.</b> 환불이나 날짜 변경이 가능한가요?</p>
                    <div className={styles.answer}>
                        <p><b>여행사와 상품에 따라 다릅니다.</b></p>
                        <p>· <b>환불 불가</b>인 상품이 많지만, 일부는 수수료를 내고 환불 가능</p>
                        <p>· 날짜 변경은 대부분 <b>불가</b> (새로 예매해야 함)</p>
                        <p>· 예매 전에 반드시 <b>환불 조건을 확인</b>하세요</p>
                        <div className={styles.tipBox}>
                            <p><b>💡 팁:</b> 예매 페이지에서 &quot;환불 규정&quot; 또는 &quot;취소 수수료&quot;를 꼭 확인하세요. 보통 출발 7일 전까지는 수수료가 적고, 3일 이내는 환불 불가인 경우가 많아요.</p>
                        </div>
                    </div>
                </div>

                <div className={styles.qaBlock}>
                    <p className={styles.question}><b>Q.</b> 위탁수하물이 포함되어 있나요?</p>
                    <div className={styles.answer}>
                        <p>땡처리 항공권은 여행사가 패키지용으로 미리 확보한 좌석이라, <b>대부분 위탁수하물이 포함</b>되어 있습니다.</p>
                        <p>· <b>대형항공사</b> (대한항공, 아시아나 등): 위탁수하물 <b>23kg 포함</b></p>
                        <p>· <b>저가항공</b> (제주항공, 진에어 등): 대부분 포함이지만, 일부 초특가 상품은 <b>별도 구매</b>가 필요할 수 있음</p>
                        <p>예매 시 수하물 포함 여부를 한번 확인해두면 안심이에요.</p>
                    </div>
                </div>

                <div className={styles.qaBlock}>
                    <p className={styles.question}><b>Q.</b> 출발 며칠 전까지 예매할 수 있나요?</p>
                    <div className={styles.answer}>
                        <p>여행사마다 다르지만, 보통 <b>출발 1~2일 전까지</b> 예매 가능합니다. 일부 여행사는 <b>출발 당일</b>까지 판매하기도 해요.</p>
                        <p>다만 좌석이 한정되어 있어서, 괜찮다 싶으면 빨리 결정하는 게 좋습니다.</p>
                    </div>
                </div>

                <div className={styles.qaBlock}>
                    <p className={styles.question}><b>Q.</b> 아이(유아/소아)도 같이 탈 수 있나요?</p>
                    <div className={styles.answer}>
                        <p><b>네, 가능합니다!</b></p>
                        <p>· <b>유아 (만 2세 미만):</b> 좌석 없이 보호자 무릎에 앉힘. 성인 요금의 10% 수준</p>
                        <p>· <b>소아 (만 2~11세):</b> 좌석 필요. 성인 요금의 75% 수준</p>
                    </div>
                </div>

                <div className={styles.qaBlock}>
                    <p className={styles.question}><b>Q.</b> 비자가 필요한 나라도 있나요?</p>
                    <div className={styles.answer}>
                        <p>· <b>비자 없이 가능:</b> 일본, 대만, 홍콩, 괌, 태국, 싱가포르, 필리핀 등</p>
                        <p>· <b>비자 또는 사전 등록 필요:</b> 중국, 베트남 (e-비자), 캄보디아 (e-비자) 등</p>
                        <p>출발이 임박한 경우, <b>무비자 국가 위주</b>로 보는 게 현실적이에요.</p>
                    </div>
                </div>

                <div className={styles.qaBlock}>
                    <p className={styles.question}><b>Q.</b> 좌석 지정이 가능한가요?</p>
                    <div className={styles.answer}>
                        <p>땡처리 항공권은 여행사가 일괄 구매한 좌석이라 <b>좌석 지정이 불가능한 경우가 많습니다.</b></p>
                        <p>· 좌석은 보통 <b>자동 배정</b>되며, 체크인 시 확인 가능</p>
                        <p>· 일부 항공사는 체크인 시 <b>빈 좌석으로 변경</b> 가능한 경우도 있음</p>
                        <p>가족끼리 나란히 앉고 싶다면 체크인 시 카운터에 요청해보세요.</p>
                    </div>
                </div>

                <div className={styles.qaBlock}>
                    <p className={styles.question}><b>Q.</b> 왜 여행사마다 가격이 다른가요?</p>
                    <div className={styles.answer}>
                        <p>여행사마다 항공사와 <b>계약 조건이 다르기 때문</b>이에요. 남는 좌석 수, 판매 목표, 마감 기한이 다르니까 <b>같은 비행기인데 가격이 다릅니다.</b></p>
                    </div>
                </div>

                <div className={styles.qaBlock}>
                    <p className={styles.question}><b>Q.</b> 어디서 비교하면 편한가요?</p>
                    <div className={styles.answer}>
                        <p>여행사 5곳을 직접 돌아다니면서 비교하기엔 솔직히 너무 귀찮죠 😅</p>
                        <p><b>티키티킷</b>은 모두투어, 노랑풍선, 땡처리닷컴 등 여러 여행사의 땡처리 항공권을 한 화면에서 비교할 수 있어요.</p>
                    </div>
                </div>

                <hr className={styles.divider} />

                <div className={styles.infoBox}>
                    <p><b>📌 정리하면:</b></p>
                    <p>✅ 비행기는 일반 항공권과 <b>완전히 동일</b></p>
                    <p>✅ 가격은 <b>30~70% 저렴</b></p>
                    <p>✅ 환불/변경은 <b>제한적</b> → 예매 전 확인 필수</p>
                    <p>✅ 수하물은 <b>항공사별로 다름</b> → LCC면 별도 구매</p>
                    <p>✅ 유아/소아 <b>동반 가능</b></p>
                    <p>✅ 여행사마다 가격 다름 → <b>비교가 핵심</b></p>
                </div>
            </>
        ),
    },
    'japan-cherry-blossom': {
        title: '일본 벚꽃 시즌 항공권 특가 가이드 🌸',
        emoji: '🌸',
        desc: '도시별 개화 시기 + 추천 코스 + 특가 노선',
        content: (
            <>
                <p style={{ textAlign: 'center' }}>해마다 이맘때가 되면 일본 벚꽃 여행 계획 세우시는 분들 많으시죠?</p>
                <p style={{ textAlign: 'center' }}><b>도시별 개화 시기 + 추천 코스 + 땡처리 항공권 특가</b>까지 한번에 정리해볼게요 👇</p>

                <hr className={styles.divider} />

                <h2>🌸 일본 벚꽃 개화 캘린더</h2>
                <p>일본 벚꽃은 <b>남쪽에서 북쪽</b>으로 올라가며 핍니다. 같은 3월이라도 도시마다 타이밍이 완전히 달라요.</p>

                <table className={styles.table}>
                    <thead><tr><th>도시</th><th>개화 시작</th><th>만개 시기</th><th>추천 방문일</th></tr></thead>
                    <tbody>
                        <tr><td>🌸 후쿠오카</td><td>3월 중순</td><td>3월 하순</td><td>3/22~4/2</td></tr>
                        <tr><td>🌸 나가사키</td><td>3월 중순</td><td>3월 하순</td><td>3/23~4/3</td></tr>
                        <tr><td>🌸 오사카</td><td>3월 하순</td><td>4월 초</td><td>3/28~4/7</td></tr>
                        <tr><td>🌸 교토</td><td>3월 하순</td><td>4월 초</td><td>3/29~4/8</td></tr>
                        <tr><td>🌸 도쿄</td><td>3월 하순</td><td>4월 초</td><td>3/26~4/5</td></tr>
                    </tbody>
                </table>

                <div className={styles.tipBox}>
                    <p><b>💡 꿀팁:</b> 만개일 기준 <b>앞뒤 3~4일</b>이 가장 예쁜 시기입니다. 만개 직후 비가 오면 하루 만에 질 수도 있어서, <b>개화~7부 개화 시점</b>에 맞추면 벚꽃도 보고 리스크도 줄일 수 있어요.</p>
                </div>

                <hr className={styles.divider} />

                <h2>✈️ 도시별 추천 코스 + 특가 노선</h2>

                <div className={styles.cityCard}>
                    <h3>1. 후쿠오카 — 가장 빨리, 가장 싸게 🏆</h3>
                    <p><b>개화:</b> 3월 중순 ~ 3월 하순</p>
                    <p>한국에서 가장 가깝고(비행 1시간), 벚꽃도 일본에서 가장 먼저 핍니다.</p>
                    <p>🌸 <b>벚꽃 명소:</b> 마이즈루 공원, 니시 공원, 오호리 공원</p>
                    <p>🍜 <b>덤:</b> 하카타 라멘, 모츠나베, 야타이(포장마차) 거리</p>
                    <p><b>특가:</b> 부산→후쿠오카 왕복 <span className={styles.highlight}>18~28만원대</span></p>
                </div>

                <div className={styles.cityCard}>
                    <h3>2. 오사카·교토 — 벚꽃의 정석 📸</h3>
                    <p><b>개화:</b> 3월 하순 ~ 4월 초</p>
                    <p>역사적인 절과 성곽 + 벚꽃 조합이 압도적.</p>
                    <p>🌸 <b>오사카 명소:</b> 오사카성 공원, 조폐국 벚꽃길</p>
                    <p>🌸 <b>교토 명소:</b> 철학의 길, 기요미즈데라, 아라시야마</p>
                    <p><b>특가:</b> 인천→오사카 왕복 <span className={styles.highlight}>30~50만원대</span></p>
                </div>

                <div className={styles.cityCard}>
                    <h3>3. 나가사키·사세보 — 숨은 보석 💎</h3>
                    <p><b>개화:</b> 3월 중순 ~ 3월 하순</p>
                    <p>관광객이 적고, 가격도 저렴합니다.</p>
                    <p>🌸 <b>벚꽃 명소:</b> 글로버 가든, 니시야마 공원, 하우스텐보스</p>
                    <p><b>특가:</b> 부산→나가사키 왕복 <span className={styles.highlight}>18~25만원대</span></p>
                </div>

                <hr className={styles.divider} />

                <h2>💰 벚꽃 시즌 항공권 싸게 사는 팁</h2>
                <div className={styles.infoBox}>
                    <p><b>1. 출발지를 바꿔보세요</b> — 인천 대신 부산 출발로 바꾸면 20만원대에 나오는 경우가 있어요.</p>
                    <p><b>2. 만개일 직전을 노리세요</b> — 개화~7부 개화 시점에 가면 가격도 싸고 벚꽃도 충분히 예뻐요.</p>
                    <p><b>3. 후쿠오카·나가사키부터 확인하세요</b> — 벚꽃이 가장 먼저 피고, 항공권도 저렴하게 나오는 편입니다.</p>
                    <p><b>4. 평일 출발이 핵심</b> — 금~일 출발은 주중 대비 5~10만원 비쌉니다.</p>
                </div>
            </>
        ),
    },
    'southeast-asia-seasons': {
        title: '동남아 우기·건기 따져서 싸게 가는 법',
        emoji: '🌏',
        desc: '시기별 가격 차이와 추천 여행지',
        content: (
            <>
                <p style={{ textAlign: 'center' }}>동남아 여행, 아무 때나 가면 될 것 같지만</p>
                <p style={{ textAlign: 'center' }}><b>우기·건기</b>에 따라 항공권 가격이 <span className={styles.highlight}>2배 이상</span> 차이 나기도 합니다.</p>
                <p style={{ textAlign: 'center' }}>시기만 잘 맞추면 날씨도 좋고, 항공권도 싸게 갈 수 있어요 👇</p>

                <hr className={styles.divider} />

                <h2>🌦️ 동남아 우기·건기 한눈에 보기</h2>
                <p>동남아는 나라마다 우기·건기 시기가 다릅니다. 같은 달이라도 어디를 가느냐에 따라 날씨가 완전히 달라요.</p>

                <table className={styles.table}>
                    <thead><tr><th>목적지</th><th>건기 (추천)</th><th>우기 (비수기)</th></tr></thead>
                    <tbody>
                        <tr><td>🇹🇭 방콕·치앙마이</td><td>11월~2월</td><td>6월~10월</td></tr>
                        <tr><td>🇻🇳 다낭·호이안</td><td>3월~8월</td><td>9월~12월</td></tr>
                        <tr><td>🇻🇳 호치민·푸꾸옥</td><td>12월~4월</td><td>5월~11월</td></tr>
                        <tr><td>🇵🇭 세부·보라카이</td><td>12월~5월</td><td>6월~11월</td></tr>
                        <tr><td>🇮🇩 발리</td><td>4월~10월</td><td>11월~3월</td></tr>
                        <tr><td>🇸🇬 싱가포르</td><td>2월~4월</td><td>11월~1월</td></tr>
                    </tbody>
                </table>

                <div className={styles.tipBox}>
                    <p><b>💡 핵심:</b> 우기라고 해서 하루 종일 비가 오는 건 아닙니다. 보통 <b>오후에 1~2시간 스콜</b>(소나기)이 내리고 그 외에는 맑아요. 우기에 가면 항공권이 확 싸지는 대신 습도가 좀 높아요.</p>
                </div>

                <hr className={styles.divider} />

                <h2>💰 우기 vs 건기 가격 차이</h2>
                <div className={styles.infoBox}>
                    <p><b>건기 (성수기):</b> 항공권 30~50만원대, 호텔도 비쌈</p>
                    <p><b>우기 (비수기):</b> 항공권 <span className={styles.highlight}>15~25만원대</span>, 호텔 50% 할인도 흔함</p>
                    <p>같은 목적지인데 <b>시기만 바꿔도 왕복 10~20만원</b> 차이가 납니다.</p>
                </div>

                <hr className={styles.divider} />

                <h2>📅 월별 추천 여행지</h2>

                <div className={styles.cityCard}>
                    <h3>1~2월: 태국·세부가 최고 🏆</h3>
                    <p>한국은 한겨울, 동남아는 건기 피크. <b>방콕·치앙마이·세부</b>가 날씨도 좋고 가격도 적당해요.</p>
                </div>

                <div className={styles.cityCard}>
                    <h3>3~5월: 다낭·발리 시즌 시작 🌴</h3>
                    <p><b>다낭</b>은 3월부터 건기 시작, <b>발리</b>는 4월부터 건기. 벚꽃 시즌에 일본이 붐빌 때 동남아로 눈을 돌리면 가성비가 좋아요.</p>
                </div>

                <div className={styles.cityCard}>
                    <h3>6~8월: 발리 건기 피크 + 다낭 🏖️</h3>
                    <p>한국 여름휴가 시즌. <b>발리·다낭</b>은 건기라 날씨 완벽하지만 한국 성수기라 가격이 올라요. 7월 초·8월 말 같은 <b>어깨 시즌</b>을 노리면 절약 가능!</p>
                </div>

                <div className={styles.cityCard}>
                    <h3>11~12월: 태국·호치민 건기 시작 ✨</h3>
                    <p>연말 여행으로 <b>방콕·호치민·푸꾸옥</b> 추천. 건기 시작이라 날씨 좋고, 크리스마스 전에 잡으면 가격도 합리적이에요.</p>
                </div>

                <hr className={styles.divider} />

                <h2>✈️ 동남아 항공권 싸게 사는 팁</h2>
                <div className={styles.infoBox}>
                    <p><b>1. 우기 초입을 노리세요</b> — 우기 시작 직후(6월 초 등)는 비도 적고 가격은 이미 떨어져 있어요.</p>
                    <p><b>2. 다낭은 한국과 반대</b> — 한국 여름(6~8월)이 다낭 건기. 한국 겨울(11~12월)이 다낭 우기. 이걸 알면 가격 차이를 이용할 수 있어요.</p>
                    <p><b>3. LCC 직항을 비교하세요</b> — 동남아는 LCC 직항이 많아서 여행사별 가격 차이가 큽니다.</p>
                    <p><b>4. 평일 출발은 기본</b> — 금~일 출발 대비 화~목 출발이 5~15만원 저렴합니다.</p>
                </div>
            </>
        ),
    },
    'cheap-tickets-2026': {
        title: '비행기 표 싸게 사는 법 2026 총정리',
        emoji: '💰',
        desc: '시기, 출발지, 비교 전략까지 한 번에',
        content: (
            <>
                <p style={{ textAlign: 'center' }}>항공권, 같은 비행기인데 <b>어디서, 언제 사느냐에 따라 수십만 원</b> 차이가 나는 거 아시나요?</p>
                <p style={{ textAlign: 'center' }}>2026년 기준으로 실제로 효과 있는 방법만 정리했습니다 👇</p>

                <hr className={styles.divider} />

                <h2>📌 핵심 원칙 3가지</h2>
                <div className={styles.infoBox}>
                    <p><b>1. 출발일 기준으로 전략이 달라진다</b></p>
                    <p>· 출발 1~2주 전: <b>땡처리 특가</b>가 쏟아지는 타이밍</p>
                    <p>· 출발 1~3개월 전: <b>얼리버드 프로모션</b>을 노려야 할 때</p>
                    <p>· 출발 3~7일 전: 좌석이 거의 마감 → 오히려 비싸질 수 있음</p>
                </div>

                <div className={styles.infoBox}>
                    <p><b>2. 출발 공항을 바꿔보면 답이 보인다</b></p>
                    <p>인천만 검색하지 말고 <b>부산, 청주, 대구</b>도 확인하세요.</p>
                    <p>같은 목적지인데 <b>출발지만 바꿔도 10~20만 원</b> 차이 나는 노선이 많습니다.</p>
                    <p>KTX 타고 내려가도 남는 경우가 실제로 있어요.</p>
                </div>

                <div className={styles.infoBox}>
                    <p><b>3. 여행사별 비교는 필수</b></p>
                    <p>같은 비행기라도 여행사마다 계약 조건이 달라서 가격이 다릅니다.</p>
                    <p>최소 <b>3곳 이상</b> 비교하는 습관이 돈을 아끼는 시작이에요.</p>
                </div>

                <hr className={styles.divider} />

                <h2>🎯 상황별 추천 전략</h2>

                <div className={styles.cityCard}>
                    <h3>급하게 떠나고 싶을 때</h3>
                    <p><b>땡처리 항공권</b>이 정답입니다. 출발 1~2주 전, 여행사들의 잔여석이 특가로 풀립니다.</p>
                    <p>날짜와 목적지에 유연하다면 <b>정가 대비 40~60% 절약</b>도 가능해요.</p>
                </div>

                <div className={styles.cityCard}>
                    <h3>여유 있게 계획할 때</h3>
                    <p>항공사 <b>얼리버드 세일</b>을 노리세요. 대한항공, 아시아나, LCC 모두 정기적으로 프로모션을 합니다.</p>
                    <p>보통 <b>2~3개월 전</b>에 잡으면 가장 합리적인 가격대가 나와요.</p>
                </div>

                <div className={styles.cityCard}>
                    <h3>평일 출발이 가능할 때</h3>
                    <p>금~일 출발 vs 화~목 출발, <b>같은 노선인데 5~15만 원</b> 차이가 나는 경우가 다반사.</p>
                    <p>하루만 조정해도 큰 차이가 납니다.</p>
                </div>
            </>
        ),
    },
    'is-it-really-cheap': {
        title: '땡처리, 무조건 싸다고요? 진짜 싼 건지 확인하는 법',
        emoji: '🔍',
        desc: '땡처리 함정을 피하는 3가지 체크포인트',
        content: (
            <>
                <p style={{ textAlign: 'center' }}>"땡처리 = 무조건 싸다"고 생각하시나요?</p>
                <p style={{ textAlign: 'center' }}><b>그렇지 않은 경우가 생각보다 많습니다.</b></p>
                <p style={{ textAlign: 'center' }}>지금부터 함정을 피하는 방법을 알려드릴게요 👇</p>

                <hr className={styles.divider} />

                <h2>⚠️ 이런 경우 주의하세요</h2>

                <div className={styles.cityCard}>
                    <h3>1. "땡처리"라는 이름만 붙인 경우</h3>
                    <p>여행사 입장에서 "땡처리"라고 쓰면 클릭이 올라갑니다.</p>
                    <p>그래서 <b>실질적 할인 없이 이름만 붙이는 경우</b>가 있어요.</p>
                    <p>네이버 최저가와 비교해보면 오히려 <b>일반 예매가 더 싼 경우</b>도 흔합니다.</p>
                </div>

                <div className={styles.cityCard}>
                    <h3>2. 성수기 땡처리</h3>
                    <p>벚꽃 시즌, 여름 휴가철, 연휴 — 정상가 자체가 높은 시기입니다.</p>
                    <p>여기서 30% 할인해봤자, <b>비수기 정상가보다 비싼 경우</b>가 다반사.</p>
                    <p>성수기 오사카 땡처리 32만 원 vs 비수기 정상가 18만 원 — 어디가 싸죠?</p>
                </div>

                <div className={styles.cityCard}>
                    <h3>3. 출발일이 아직 먼 경우</h3>
                    <p>진짜 땡처리다운 가격은 <b>출발 1~2주 전</b>에 나옵니다.</p>
                    <p>출발이 한 달 넘게 남은 건 아직 가격을 안 내린 거예요.</p>
                </div>

                <hr className={styles.divider} />

                <h2>✅ 진짜 싼 건지 확인하는 체크리스트</h2>
                <div className={styles.infoBox}>
                    <p><b>☑️ 네이버 최저가와 비교했는가?</b></p>
                    <p>티키티킷의 "네이버 가격비교" 버튼으로 한 번에 확인하세요.</p>
                    <p>&nbsp;</p>
                    <p><b>☑️ 같은 날짜, 다른 여행사도 비교했는가?</b></p>
                    <p>여행사마다 같은 좌석에 다른 가격을 매깁니다.</p>
                    <p>&nbsp;</p>
                    <p><b>☑️ 출발일이 정말 임박한 건가?</b></p>
                    <p>출발 1~2주 이내 = 진짜 땡처리 확률 높음. 한 달 이상 = 의심해볼 필요 있음.</p>
                </div>
            </>
        ),
    },
};

const tipSlugs = Object.keys(tips);

export function generateStaticParams() {
    return tipSlugs.map(slug => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
    const tip = tips[params.slug];
    if (!tip) return { title: '팁을 찾을 수 없습니다' };
    return {
        title: tip.title,
        description: tip.desc,
        alternates: { canonical: `/tips/${params.slug}` },
        robots: { index: false, follow: true },
    };
}

export default function TipPage({ params }: { params: { slug: string } }) {
    const tip = tips[params.slug];
    if (!tip) notFound();

    const otherTips = tipSlugs.filter(s => s !== params.slug);

    return (
        <div className={styles.tipsPage}>
            <Link href="/tips" className={styles.backLink}>← 여행 꿀팁 목록</Link>

            <article className={styles.article}>
                <h1 className={styles.articleTitle}>{tip.emoji} {tip.title}</h1>
                <div className={styles.articleBody}>
                    {tip.content}
                </div>

                <div className={styles.ctaSection}>
                    <p>더 이상 여러 여행사 사이트를 돌아다니며 시간을 낭비하지 마세요.</p>
                    <p>여행사마다 따로 올라오는 땡처리 항공권, <b>티키티킷</b>에서 한곳에 모아 비교해보세요.</p>
                    <Link href="/" className={styles.ctaButton}>지금 특가 확인하기 →</Link>
                </div>
            </article>

            <div className={styles.moreTips}>
                <h3 className={styles.moreTipsTitle}>다른 팁도 보기</h3>
                <div className={styles.moreTipsList}>
                    {otherTips.map(slug => (
                        <Link key={slug} href={`/tips/${slug}`} className={styles.moreTipLink}>
                            <span>{tips[slug].emoji}</span>
                            <span>{tips[slug].title}</span>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
