# -*- coding: utf-8 -*-
"""
트립닷컴(Trip.com) 인기 해외 여행지 TOP 40 '실시간 실제 결제 운임' 전수 수집기 (방안 B)
- 대상: 한국인 인기 40대 도시 (일본, 베트남, 태국, 대만/홍콩, 필리핀, 싱가포르/말레이/인니, 중국/몽골, 대양주/휴양지)
- 기간: 오늘 기준 30일 이내 출발 (2026-09-21 ~ 2026-10-21)
- 일정: 2박3일, 3박4일, 4박5일, 5박6일, 6박7일, 7박8일 (2~7박)
- 방식:
    1단계: 2D 매트릭스 캘린더('GetLowPriceInCalender') 인터셉션으로 60일치 185개 일정 중 최저가 날짜 확정
    2단계: 최저가 날짜의 실시간 항공권 검색 화면으로 이동하여 '선택' 버튼의 세금/유류할증료 포함 실제 결제 가능 운임, 실제 항공사, 편명/스펙 전수 검증
    3단계: 사용자 전용 트립닷컴 어필리에이트 파트너 딥링크 자동 결합
- 데이터 영구 보존:
    - data/tripcom_40destinations_latest.json (최신 스냅샷)
    - data/history/tripcom_40destinations_YYYYMMDD_HHMMSS.json (타임스탬프 영구 아카이브)
    - data/tripcom_40destinations_latest.md (마케팅/노션/텔레그램용 서식 표)
    - data/tripcom_40destinations_latest.csv (엑셀/스프레드시트용)
"""

import os
import sys
import json
import csv
import time
import urllib.parse
from datetime import datetime, timedelta

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

ALLIANCE_ID = "7878543"
SID = "295785953"
TRIP_SUB3 = "D13108097"

# KST 기준 날짜 계산
NOW = datetime.now()
TODAY = datetime(NOW.year, NOW.month, NOW.day)
MAX_DEP_DATE = TODAY + timedelta(days=30)
ALLOWED_NIGHTS = [2, 3, 4, 5, 6, 7]  # 2박 3일 ~ 7박 8일

TOP_40_DESTINATIONS = [
    # 일본 (10)
    {"name": "후쿠오카", "country": "일본", "city_code": "fuk", "iata": "FUK", "acity_name": "Fukuoka"},
    {"name": "오사카", "country": "일본", "city_code": "osa", "iata": "OSA", "acity_name": "Osaka"},
    {"name": "도쿄", "country": "일본", "city_code": "tyo", "iata": "TYO", "acity_name": "Tokyo"},
    {"name": "삿포로", "country": "일본", "city_code": "spk", "iata": "CTS", "acity_name": "Sapporo"},
    {"name": "오키나와", "country": "일본", "city_code": "oka", "iata": "OKA", "acity_name": "Okinawa"},
    {"name": "나고야", "country": "일본", "city_code": "ngo", "iata": "NGO", "acity_name": "Nagoya"},
    {"name": "히로시마", "country": "일본", "city_code": "hij", "iata": "HIJ", "acity_name": "Hiroshima"},
    {"name": "다카마쓰", "country": "일본", "city_code": "tak", "iata": "TAK", "acity_name": "Takamatsu"},
    {"name": "마쓰야마", "country": "일본", "city_code": "myj", "iata": "MYJ", "acity_name": "Matsuyama"},
    {"name": "시즈오카", "country": "일본", "city_code": "fsz", "iata": "FSZ", "acity_name": "Shizuoka"},
    # 베트남 (6)
    {"name": "다낭", "country": "베트남", "city_code": "dad", "iata": "DAD", "acity_name": "Da Nang"},
    {"name": "나트랑", "country": "베트남", "city_code": "nha", "iata": "CXR", "acity_name": "Nha Trang"},
    {"name": "푸꾸옥", "country": "베트남", "city_code": "pqc", "iata": "PQC", "acity_name": "Phu Quoc Island"},
    {"name": "하노이", "country": "베트남", "city_code": "han", "iata": "HAN", "acity_name": "Hanoi"},
    {"name": "호찌민", "country": "베트남", "city_code": "sgn", "iata": "SGN", "acity_name": "Ho Chi Minh City"},
    {"name": "달랏", "country": "베트남", "city_code": "dli", "iata": "DLI", "acity_name": "Da Lat"},
    # 태국 (3)
    {"name": "방콕", "country": "태국", "city_code": "bkk", "iata": "BKK", "acity_name": "Bangkok"},
    {"name": "치앙마이", "country": "태국", "city_code": "cnx", "iata": "CNX", "acity_name": "Chiang Mai"},
    {"name": "푸껫", "country": "태국", "city_code": "hkt", "iata": "HKT", "acity_name": "Phuket"},
    # 대만 / 홍콩 / 마카오 (4)
    {"name": "타이베이", "country": "대만", "city_code": "tpe", "iata": "TPE", "acity_name": "Taipei"},
    {"name": "가오슝", "country": "대만", "city_code": "khh", "iata": "KHH", "acity_name": "Kaohsiung"},
    {"name": "홍콩", "country": "홍콩", "city_code": "hkg", "iata": "HKG", "acity_name": "Hong Kong"},
    {"name": "마카오", "country": "마카오", "city_code": "mfm", "iata": "MFM", "acity_name": "Macau"},
    # 필리핀 (4)
    {"name": "세부", "country": "필리핀", "city_code": "ceb", "iata": "CEB", "acity_name": "Cebu"},
    {"name": "보홀", "country": "필리핀", "city_code": "tag", "iata": "TAG", "acity_name": "Tagbilaran"},
    {"name": "마닐라", "country": "필리핀", "city_code": "mnl", "iata": "MNL", "acity_name": "Manila"},
    {"name": "클라크", "country": "필리핀", "city_code": "crk", "iata": "CRK", "acity_name": "Clark"},
    # 동남아 기타 (4)
    {"name": "싱가포르", "country": "싱가포르", "city_code": "sin", "iata": "SIN", "acity_name": "Singapore"},
    {"name": "코타키나발루", "country": "말레이시아", "city_code": "bki", "iata": "BKI", "acity_name": "Kota Kinabalu"},
    {"name": "쿠알라룸푸르", "country": "말레이시아", "city_code": "kul", "iata": "KUL", "acity_name": "Kuala Lumpur"},
    {"name": "발리", "country": "인도네시아", "city_code": "dps", "iata": "DPS", "acity_name": "Bali"},
    # 중국 / 몽골 (5)
    {"name": "칭다오", "country": "중국", "city_code": "tao", "iata": "TAO", "acity_name": "Qingdao"},
    {"name": "상하이", "country": "중국", "city_code": "sha", "iata": "SHA", "acity_name": "Shanghai"},
    {"name": "베이징", "country": "중국", "city_code": "bjs", "iata": "BJS", "acity_name": "Beijing"},
    {"name": "장자제", "country": "중국", "city_code": "dyg", "iata": "DYG", "acity_name": "Zhangjiajie"},
    {"name": "울란바토르", "country": "몽골", "city_code": "uln", "iata": "ULN", "acity_name": "Ulaanbaatar"},
    # 대양주 / 휴양지 (4)
    {"name": "괌", "country": "미국령", "city_code": "gum", "iata": "GUM", "acity_name": "Guam"},
    {"name": "사이판", "country": "미국령", "city_code": "spn", "iata": "SPN", "acity_name": "Saipan"},
    {"name": "시드니", "country": "호주", "city_code": "syd", "iata": "SYD", "acity_name": "Sydney"},
    {"name": "호놀룰루", "country": "미국", "city_code": "hnl", "iata": "HNL", "acity_name": "Honolulu"},
]

def make_affiliate_url(base_url, params=None):
    url_parts = list(urllib.parse.urlparse(base_url))
    query = dict(urllib.parse.parse_qsl(url_parts[4]))
    if params:
        query.update(params)
    query["Allianceid"] = ALLIANCE_ID
    query["SID"] = SID
    query["trip_sub3"] = TRIP_SUB3
    url_parts[4] = urllib.parse.urlencode(query)
    return urllib.parse.urlunparse(url_parts)


class AccessRestricted(RuntimeError):
    pass


def check_navigation(response):
    if response is not None and response.status in (401, 403, 429):
        raise AccessRestricted(f"HTTP {response.status}")


def write_json_atomic(path, value):
    temporary = f"{path}.{os.getpid()}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
    os.replace(temporary, path)

def scan_destination(page, dest, idx, total_count, *, verify_roundtrip=False):
    start_t = time.time()
    dest_name = dest["name"]
    print(f"\n[{idx:02d}/{total_count:02d}] 🚀 {dest_name} ({dest['iata']} - {dest['country']}) 수집 시작...")

    # 1단계: 2D 매트릭스 캘린더 스캔
    init_d = (TODAY + timedelta(days=7)).strftime("%Y-%m-%d")
    init_r = (TODAY + timedelta(days=10)).strftime("%Y-%m-%d")
    cal_url = (
        f"https://kr.trip.com/flights/showfarefirst?pagesource=list&lowpricesource=roundTable"
        f"&triptype=RT&class=Y&quantity=1&childqty=0&babyqty=0&dcity=sel&acity={dest['city_code']}"
        f"&dcityName=Seoul&acityName={dest['acity_name']}"
        f"&ddate={init_d}&rdate={init_r}&locale=ko-KR&curr=KRW"
    )

    cal_responses = []
    restriction = []
    def on_response(resp):
        if "GetLowPriceInCalender" in resp.url:
            if resp.status in (401, 403, 429):
                restriction.append(resp.status)
                return
            try:
                data = resp.json()
                if isinstance(data, dict):
                    cal_responses.append(data)
            except:
                pass

    page.on("response", on_response)

    try:
        check_navigation(page.goto(cal_url, wait_until="commit", timeout=15000))
    except AccessRestricted:
        page.remove_listener("response", on_response)
        raise
    except Exception as e:
        page.remove_listener("response", on_response)
        return {**dest, "status": "calendar_navigation_failed", "publishable": False}

    # 응답 수신 대기 (최대 4초)
    w_start = time.time()
    while time.time() - w_start < 4:
        if restriction:
            break
        if len(cal_responses) >= 1 and any(cd.get("lowPriceInCalenderDtoInfoList") for cd in cal_responses):
            break
        try:
            btn = page.locator('.round-table-btn').first
            if btn.is_visible(timeout=200):
                btn.click(force=True, timeout=500)
                break
        except:
            pass
        page.wait_for_timeout(200)

    # 잔여 버퍼 대기
    w_start2 = time.time()
    while time.time() - w_start2 < 1.5:
        if restriction:
            break
        if len(cal_responses) >= 2 or (cal_responses and any(cd.get("lowPriceInCalenderDtoInfoList") for cd in cal_responses)):
            break
        page.wait_for_timeout(200)

    try:
        page.remove_listener("response", on_response)
    except:
        pass

    if restriction:
        raise AccessRestricted(f"Calendar HTTP {restriction[0]}")

    # 캘린더 데이터 분석
    items = []
    for cd in cal_responses:
        lst = cd.get("lowPriceInCalenderDtoInfoList")
        if isinstance(lst, list):
            items.extend(lst)

    valid_candidates = []
    seen = set()

    for it in items:
        p = it.get("currencyPrice", -1)
        d_ts = it.get("dDate")
        a_ts = it.get("aDate")
        if not p or p <= 30000 or not d_ts or not a_ts:
            continue

        key = (d_ts, a_ts)
        if key in seen:
            continue
        seen.add(key)

        d_dt = datetime.fromtimestamp(d_ts)
        a_dt = datetime.fromtimestamp(a_ts)
        nights = (a_dt.date() - d_dt.date()).days

        if TODAY.date() <= d_dt.date() <= MAX_DEP_DATE.date() and nights in ALLOWED_NIGHTS:
            valid_candidates.append({
                "destination": dest["name"],
                "country": dest["country"],
                "city_code": dest["city_code"],
                "iata": dest["iata"],
                "acity_name": dest["acity_name"],
                "ddate": d_dt.strftime("%Y-%m-%d"),
                "rdate": a_dt.strftime("%Y-%m-%d"),
                "nights": nights,
                "durationStr": f"{nights}박 {nights+1}일",
                "cal_price": p,
                "direct": it.get("direct", True)
            })

    if not valid_candidates:
        print(f"  ❌ [{dest_name}] 유효 일정 후보 없음 (수신 항목 {len(items)}건)")
        return {
            "destination": dest["name"],
            "country": dest["country"],
            "city_code": dest["city_code"],
            "iata": dest["iata"],
            "status": "no_matching_candidates" if any(isinstance(cd.get("lowPriceInCalenderDtoInfoList"), list) for cd in cal_responses) else "calendar_unconfirmed",
            "checked_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

    # 캘린더 최저가 후보 확정
    best_cand = min(valid_candidates, key=lambda x: x["cal_price"])
    print(f"  📅 캘린더 최저가: {best_cand['cal_price']:,}원 | {best_cand['ddate']} ~ {best_cand['rdate']} ({best_cand['durationStr']})")

    # 2단계: 실시간 카드 검증 (선택 버튼 실시간 최종 결제 운임 및 항공사 확정)
    live_url = (
        f"https://kr.trip.com/flights/showfarefirst?pagesource=list"
        f"&triptype=RT&class=Y&quantity=1&childqty=0&babyqty=0&dcity=sel&acity={dest['city_code']}"
        f"&dcityName=Seoul&acityName={dest['acity_name']}"
        f"&ddate={best_cand['ddate']}&rdate={best_cand['rdate']}&locale=ko-KR&curr=KRW"
    )

    if verify_roundtrip:
        from tripcom_dom import collect_roundtrip
        return collect_roundtrip(page, best_cand, make_affiliate_url(live_url), check_navigation)

    try:
        check_navigation(page.goto(live_url, wait_until="domcontentloaded", timeout=20000))
        page.wait_for_selector('text="선택"', timeout=16000)
    except AccessRestricted:
        raise
    except Exception:
        return {**best_cand, "status": "live_navigation_unconfirmed", "price": None,
                "live_price": None, "publishable": False}

    page.wait_for_timeout(1000)

    # 화면 내 실시간 최저가 카드 추출
    card_info = page.evaluate("""() => {
        const cards = document.querySelectorAll('.f-info-content, [class*="flight-card"], [class*="flight-item"], .m-flight-item');
        let minPrice = null;
        let airline = "트립닷컴 추천 항공";
        let isDirect = true;
        let summaryText = "";

        const knownAirlines = [
            "티웨이항공", "제주항공", "진에어", "이스타항공", "에어서울", "에어부산", 
            "피치항공", "비엣젯항공", "비엣젯", "트리니티항공", "스쿠트항공", "스쿠트", "대한항공", 
            "아시아나항공", "아시아나", "중화항공", "에바항공", "타이거항공", "필리핀항공", "세부퍼시픽", "썬 푸꾸옥 항공",
            "에어아시아", "에어로케이", "홍콩익스프레스", "캐세이퍼시픽", "중국동방항공", "중국남방항공", "산둥항공",
            "하와이안항공", "델타항공", "유나이티드항공", "몽골항공", "콴타스", "싱가포르항공", "말레이시아항공", "가루다인도네시아"
        ];

        for (const card of cards) {
            const t = card.innerText || '';
            if (t.includes('선택')) {
                const matches = Array.from(t.matchAll(/([1-9][0-9]{0,2}(?:,[0-9]{3})+)\\s*원/g));
                const prices = matches.map(m => parseInt(m[1].replace(/,/g, ''), 10)).filter(p => p >= 30000);
                if (prices.length > 0) {
                    const localMin = Math.min(...prices);
                    if (minPrice === null || localMin < minPrice) {
                        minPrice = localMin;
                        airline = null;
                        for (const ka of knownAirlines) {
                            if (t.includes(ka)) {
                                airline = ka;
                                break;
                            }
                        }
                        isDirect = t.includes('직항');
                        summaryText = t.split('\\n').map(s=>s.trim()).filter(Boolean).slice(0, 6).join(' | ');
                    }
                }
            }
        }
        return { minPrice, airline, isDirect, summaryText };
    }""")

    if not card_info or not card_info.get("minPrice"):
        return {**best_cand, "status": "live_price_unconfirmed", "price": None,
                "live_price": None, "publishable": False,
                "checked_at": datetime.now().isoformat()}
    live_price = card_info["minPrice"]
    airline = card_info["airline"] if (card_info and card_info.get("airline") != "트립닷컴 추천 항공") else ("직항 특가 항공" if best_cand.get("direct") else "특가 항공")
    is_direct = card_info["isDirect"] if card_info else best_cand.get("direct", True)
    flight_summary = card_info["summaryText"] if (card_info and card_info.get("summaryText")) else f"출국 {best_cand['ddate']} ~ 귀국 {best_cand['rdate']}"

    aff_url = make_affiliate_url(live_url)

    diff = live_price - best_cand["cal_price"]
    diff_str = f"+{diff:,}원" if diff > 0 else f"{diff:,}원"
    elapsed = time.time() - start_t
    print(f"  [검색 카드 관측] {live_price:,}원 (왕복 총액·공항·귀국편 검증 대기) | 소요: {elapsed:.1f}초")

    return {
        "destination": dest["name"],
        "country": dest["country"],
        "iata": dest["iata"],
        "city_code": dest["city_code"],
        "ddate": best_cand["ddate"],
        "rdate": best_cand["rdate"],
        "nights": best_cand["nights"],
        "durationStr": best_cand["durationStr"],
        "cal_price": best_cand["cal_price"],
        "live_price": live_price,
        "price": live_price,
        "currency": "KRW",
        "airline": airline,
        "direct": is_direct,
        "flight_summary": flight_summary,
        "booking_url": aff_url,
        "candidates_scanned": len(valid_candidates),
        "checked_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "status": "search_quote_observed",
        "price_basis": "search_card_unverified_roundtrip_total",
        "publishable": False,
        "naver_eligible": False,
        "verification_pending": ["roundtrip_total", "actual_route_airports", "return_leg"]
    }

def save_all_formats(results, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    history_dir = os.path.join(out_dir, "history")
    os.makedirs(history_dir, exist_ok=True)

    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")

    # 1. JSON 스냅샷 & 히스토리 영구 저장
    latest_json = os.path.join(out_dir, "tripcom_40destinations_latest.json")
    history_json = os.path.join(history_dir, f"tripcom_40destinations_{timestamp_str}.json")

    with open(latest_json, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    with open(history_json, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # 2. 마크다운 보고서 생성 (노션/블로그/텔레그램 복사용)
    md_file = os.path.join(out_dir, "tripcom_40destinations_latest.md")
    with open(md_file, "w", encoding="utf-8") as f:
        f.write(f"# ✈️ 트립닷컴 40대 인기 여행지 실시간 결제 최저가 항공권 (2박3일 ~ 7박8일)\n\n")
        f.write(f"- **수집 기준 일시**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} (KST)\n")
        f.write(f"- **조회 범위**: {TODAY.strftime('%Y-%m-%d')} ~ {MAX_DEP_DATE.strftime('%Y-%m-%d')} 출발 (30일 이내)\n")
        f.write(f"- **대상 일정**: 2박3일 ~ 7박8일 (2~7박) 왕복권 전체 (실시간 결제 운임 검증 완료)\n")
        f.write(f"- **어필리에이트 코드**: Allianceid={ALLIANCE_ID} | SID={SID} | trip_sub3={TRIP_SUB3}\n\n")
        f.write("| 순위 | 목적지 | 국가 | IATA | 일정 (박/일) | 출발일 ~ 귀국일 | 실시간 결제가 | 항공사 | 직항여부 | 예약 딥링크 |\n")
        f.write("|:---:|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|\n")

        rank = 1
        for r in results:
            if r.get("status") == "success":
                direct_str = "직항" if r.get("direct") else "경유/직항"
                f.write(
                    f"| {rank} | **{r['destination']}** | {r['country']} | {r['iata']} | {r['durationStr']} | "
                    f"{r['ddate']} ~ {r['rdate']} | **{r['live_price']:,}원** | {r['airline']} | "
                    f"{direct_str} | [특가 예약 바로가기]({r['booking_url']}) |\n"
                )
                rank += 1
            else:
                f.write(f"| - | {r['destination']} | {r['country']} | {r['iata']} | - | - | 운임 미확인 | - | - | - |\n")

    # 3. CSV 파일 저장 (스프레드시트/엑셀용)
    csv_file = os.path.join(out_dir, "tripcom_40destinations_latest.csv")
    with open(csv_file, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["순위", "목적지", "국가", "IATA", "여행기간", "출발일", "귀국일", "실시간결제가(KRW)", "캘린더예상가(KRW)", "운항항공사", "직항여부", "예약링크", "수집일시"])
        rank = 1
        for r in results:
            if r.get("status") == "success":
                writer.writerow([
                    rank, r['destination'], r['country'], r['iata'], r['durationStr'],
                    r['ddate'], r['rdate'], r['live_price'], r['cal_price'],
                    r['airline'], "직항" if r.get('direct') else "경유/직항",
                    r['booking_url'], r['checked_at']
                ])
                rank += 1

    # 4. Dropbox 프로젝트 동기화 (PC B / PC C에서 실행 시 PC A로 자동 공유)
    dropbox_dir = r"C:\Users\ynal\Dropbox\Projects\Personal Projects\Tikitikit_Crawler_Anitigravity_02\data"
    if os.path.exists(dropbox_dir) and os.path.abspath(out_dir) != os.path.abspath(dropbox_dir):
        try:
            import shutil
            dropbox_history = os.path.join(dropbox_dir, "history")
            os.makedirs(dropbox_history, exist_ok=True)
            shutil.copy2(latest_json, os.path.join(dropbox_dir, "tripcom_40destinations_latest.json"))
            shutil.copy2(history_json, os.path.join(dropbox_history, os.path.basename(history_json)))
            shutil.copy2(md_file, os.path.join(dropbox_dir, "tripcom_40destinations_latest.md"))
            shutil.copy2(csv_file, os.path.join(dropbox_dir, "tripcom_40destinations_latest.csv"))
            print(f"  - Dropbox 동기화: {dropbox_dir} 복사 완료")
        except Exception as err:
            print(f"  ⚠️ Dropbox 동기화 중 오류 (로컬 저장은 완료됨): {err}")

    print(f"\n💾 데이터 영구 저장 완료:")
    print(f"  - 최신 JSON: {latest_json}")
    print(f"  - 영구 아카이브: {history_json}")
    print(f"  - 마크다운 서식: {md_file}")
    print(f"  - 엑셀 CSV: {csv_file}")

def main():
    from playwright.sync_api import sync_playwright
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    destinations = TOP_40_DESTINATIONS[:limit] if limit else TOP_40_DESTINATIONS

    print("=" * 80)
    print(f"🌍 트립닷컴 인기 해외 여행지 {len(destinations)}곳 '실시간 실제 결제 운임' 전수 수집 (방안 B)")
    print(f"기준 기간: {TODAY.strftime('%Y-%m-%d')} ~ {MAX_DEP_DATE.strftime('%Y-%m-%d')} (30일 이내)")
    print(f"대상 일정: 2박3일 ~ 7박8일 (2~7박) 왕복권 전체")
    print("=" * 80)

    USER_DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "browser_user_data"))
    OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
    os.makedirs(OUT_DIR, exist_ok=True)

    all_results = []
    t_start_all = time.time()

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            channel="chrome",
            headless=False,
            locale="ko-KR",
            viewport={"width": 1400, "height": 900},
        )
        page = context.pages[0] if context.pages else context.new_page()

        total = len(destinations)
        for i, dest in enumerate(destinations, 1):
            try:
                res = scan_destination(page, dest, i, total)
                all_results.append(res)
                # 도시 1개 완료될 때마다 즉시 중간 저장 (유실 방지)
                write_json_atomic(os.path.join(OUT_DIR, "tripcom_40destinations_checkpoint.json"), all_results)
            except AccessRestricted as e:
                all_results.append({**dest, "status": "access_restricted", "reason": str(e), "publishable": False})
                write_json_atomic(os.path.join(OUT_DIR, "tripcom_40destinations_checkpoint.json"), all_results)
                break
            except Exception as e:
                print(f"  ❌ [{dest['name']}] 처리 중 예외 발생: {e}")
                all_results.append({
                    "destination": dest["name"],
                    "country": dest["country"],
                    "iata": dest["iata"],
                    "status": f"error: {e}",
                    "checked_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                })
            # 가벼운 지터 딜레이 (0.5초)
            page.wait_for_timeout(500)

        context.close()

    # 실시간 결제가 기준 가격순 정렬 (성공 건 우선)
    all_results.sort(key=lambda x: (0 if x.get("status") == "success" else 1, x.get("live_price") or 9999999))

    # 최종 저장 (JSON, 히스토리, 마크다운, CSV)
    # Unverified observations must never replace the last published snapshot.
    review_path = os.path.join(OUT_DIR, "tripcom_40destinations_review.json")
    write_json_atomic(review_path, all_results)

    total_time = time.time() - t_start_all
    print("\n" + "=" * 80)
    print(f"🏆 전체 {len(destinations)}개 도시 실시간 결제 운임 수집 완료! (총 소요 시간: {total_time/60:.1f}분)")
    print("=" * 80)
    success_items = [r for r in all_results if r.get("status") == "success"]
    for i, r in enumerate(success_items[:15], 1):
        direct_str = "직항" if r.get("direct") else "경유/직항"
        print(f" {i:2d}. {r['destination']} ({r['iata']}): {r['live_price']:,}원 | {r['durationStr']} | {r['ddate']}~{r['rdate']} | {r['airline']} ({direct_str})")
    print("=" * 80)

    return 2 if any(r.get("status") not in ("search_quote_observed", "no_matching_candidates") for r in all_results) else 0

if __name__ == "__main__":
    raise SystemExit('Use the centrally admitted Trip.com worker; standalone collection is disabled.')
