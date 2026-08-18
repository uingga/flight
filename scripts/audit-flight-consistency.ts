/**
 * audit-flight-consistency.ts — 항공권 캐시 정합성 감사
 *
 * 여러 여행사가 같은 노선·날짜를 팔 때 시각과 항공사가 서로 맞는지 대조한다.
 * 어긋나는 레코드는 판매처 표기 오류일 가능성이 높다.
 * (2026-08 DROP 02에서 땡처리닷컴이 파라타항공 저녁편에 썬푸꾸옥 편명을 붙여
 *  놓은 사례를 발견해 만든 검사다.)
 *
 * 검사 항목
 *  1. airline-conflict  : 같은 노선·날짜에 30분 이내로 뜨는 편인데 항공사명이 다름
 *  2. schedule-mismatch : 자기 항공사의 그 노선 운항 시간대에서 벗어나 있고,
 *                         오히려 다른 항공사의 시간대와 일치 (항공사 오기재 의심)
 *  3. flightno-airline  : 같은 편명이 서로 다른 항공사명으로 기록됨
 *  4. flightno-time     : 같은 편명인데 출발시각이 30분 넘게 다름
 *  5. missing-airport   : 공항 코드가 없어 노선 대조 자체가 불가
 *  6. missing-time      : 출발/도착 시각 없음
 *  7. suspicious-price  : 같은 노선·날짜에서 다른 판매처 중앙값의 절반 미만
 *
 * 같은 항공사가 하루 여러 편을 띄우는 노선이 많아, 단순히 "같은 노선·항공사인데
 * 시각이 다르다"는 식의 검사는 오탐만 낸다. 그래서 날짜를 무시하고 노선별
 * 운항 시간대 프로파일을 만든 뒤, 프로파일에서 벗어난 레코드만 본다.
 *
 * Usage:
 *   npx tsx scripts/audit-flight-consistency.ts              # 사람이 읽는 요약
 *   npx tsx scripts/audit-flight-consistency.ts --json       # 기계용 JSON
 *   npx tsx scripts/audit-flight-consistency.ts --source ttang
 */

import fs from 'node:fs';
import path from 'node:path';
import { normalizeAirline as canonicalAirline } from '../src/lib/utils/flight-helpers';

interface Place { city?: string; airport?: string; date?: string; time?: string; arrivalTime?: string }
interface Flight {
    id: string; source: string; airline?: string; price: number;
    departure: Place; arrival: Place; flightNumber?: string; seats?: string;
}

type Severity = 'high' | 'medium' | 'low';
interface Finding {
    kind: string; severity: Severity; id: string; source: string;
    route: string; date: string; detail: string; peers?: string[];
}

const CACHE = path.join(process.cwd(), 'data', 'all-flights-cache.json');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const sourceIndex = args.indexOf('--source');
const sourceFilter = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;

const airportOf = (p?: Place) => p?.airport || p?.city?.match(/\(([A-Z]{3})\)/)?.[1] || '';
const dateOf = (v?: string) => (v || '').replace(/\./g, '-').replace(/\([^)]*\)/g, '').trim().slice(0, 10);
const minutes = (t?: string) => {
    const m = (t || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// 자정을 넘나드는 시각 차이는 짧은 쪽으로 센다 (23:50 vs 00:10 = 20분)
const clockGap = (a: number, b: number) => {
    const raw = Math.abs(a - b);
    return Math.min(raw, 1440 - raw);
};
const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
// 표시가가 아닌 실결제가 기준 (땡처리닷컴은 발권수수료 2만원 별도)
const effectivePrice = (f: Flight) => f.price + (f.source === 'ttang' ? 20_000 : 0);
// 사이트 표시와 같은 규칙으로 항공사명을 통일한다 (사명 변경·띄어쓰기 별칭 포함).
// 이걸 쓰지 않으면 "티웨이항공"과 "트리니티항공"이 서로 다른 항공사로 잡혀 오탐이 쏟아진다.
const normalizeAirline = (name?: string) =>
    (canonicalAirline(name || '') || '').replace(/\s+/g, '').toLowerCase();

const raw = JSON.parse(fs.readFileSync(CACHE, 'utf-8'));
const allFlights: Flight[] = Array.isArray(raw) ? raw : raw.flights || [];
const flights = sourceFilter ? allFlights.filter(f => f.source === sourceFilter) : allFlights;

const findings: Finding[] = [];
const routeLabel = (f: Flight) => `${airportOf(f.departure) || '?'}-${airportOf(f.arrival) || '?'}`;

// ── 1) 기본 필드 누락 ──
for (const f of flights) {
    if (!airportOf(f.departure) || !airportOf(f.arrival)) {
        findings.push({
            kind: 'missing-airport', severity: 'medium', id: f.id, source: f.source,
            route: `${f.departure?.city || '?'}→${f.arrival?.city || '?'}`, date: dateOf(f.departure?.date),
            detail: '공항 코드가 없어 노선 대조와 최저가 매칭에서 제외됨',
        });
    }
    if (!f.departure?.time || !f.arrival?.time) {
        findings.push({
            kind: 'missing-time', severity: 'low', id: f.id, source: f.source,
            route: routeLabel(f), date: dateOf(f.departure?.date),
            detail: `출발시각=${f.departure?.time || '없음'} 귀국편시각=${f.arrival?.time || '없음'}`,
        });
    }
}

// ── 2) 노선+날짜로 묶어 소스 간 대조 ──
const groups = new Map<string, Flight[]>();
for (const f of flights) {
    const dep = airportOf(f.departure), arr = airportOf(f.arrival);
    const d = dateOf(f.departure?.date), r = dateOf(f.arrival?.date);
    if (!dep || !arr || !d) continue;
    const key = `${dep}-${arr}_${d}_${r}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
}

let comparedGroups = 0;
for (const [key, group] of groups) {
    const sources = new Set(group.map(f => f.source));
    if (sources.size < 2) continue; // 대조할 상대가 없음
    comparedGroups++;
    const [route, depDate] = key.split('_');

    // 2-1) 30분 이내에 뜨는 같은 노선 편인데 항공사가 다름 → 항공사 표기 오류 의심
    //      (판매처마다 표기 시각이 몇 분씩 어긋나므로 정확히 같은 분만 보면 놓친다)
    const timed = group.filter(f => minutes(f.departure?.time) !== null && normalizeAirline(f.airline));
    const reported = new Set<string>();
    for (const f of timed) {
        const t = minutes(f.departure!.time)!;
        const near = timed.filter(g => g !== f && clockGap(minutes(g.departure!.time)!, t) <= 30);
        const others = near.filter(g => normalizeAirline(g.airline) !== normalizeAirline(f.airline));
        const same = near.filter(g => normalizeAirline(g.airline) === normalizeAirline(f.airline));
        // 같은 시간대를 두 곳 이상이 다른 항공사로 적었고, 내 편을 거드는 곳은 없을 때만
        if (others.length >= 2 && same.length === 0 && !reported.has(f.id)) {
            reported.add(f.id);
            findings.push({
                kind: 'airline-conflict', severity: 'high', id: f.id, source: f.source,
                route, date: depDate,
                detail: `${f.departure!.time} 출발편을 "${f.airline}"으로 기록 — 같은 시간대를 다른 판매처 ${others.length}곳은 "${others[0].airline}"으로 기록`,
                peers: others.map(p => `${p.source}:${p.id}`),
            });
        }
    }

    // 2-2) 유독 싼 표 → 가격 파싱 오류 의심 (수수료 포함 실결제가로 비교)
    if (group.length >= 3) {
        const prices = group.map(effectivePrice);
        const med = median(prices);
        for (const f of group) {
            const p = effectivePrice(f);
            if (med > 0 && p < med * 0.5) {
                findings.push({
                    kind: 'suspicious-price', severity: 'medium', id: f.id, source: f.source,
                    route, date: depDate,
                    detail: `${p.toLocaleString('ko-KR')}원 — 같은 노선·날짜 ${group.length}건 중앙값 ${med.toLocaleString('ko-KR')}원의 절반 미만`,
                });
            }
        }
    }
}

// ── 3) 노선별 항공사 운항 시간대 프로파일 ──
// 날짜를 무시하고 (노선, 항공사)별 출발시각을 모은다. 어떤 표의 시각이 자기 항공사
// 시간대에는 없고 같은 노선 다른 항공사 시간대와 맞아떨어지면 항공사 오기재를 의심한다.
// DROP 02에서 파라타항공 저녁편에 썬푸꾸옥 편명이 붙었던 것이 이 유형이다.
const profile = new Map<string, Map<string, Flight[]>>(); // route → airline → flights
for (const f of flights) {
    const dep = airportOf(f.departure), arr = airportOf(f.arrival);
    const airline = normalizeAirline(f.airline);
    if (!dep || !arr || !airline || minutes(f.departure?.time) === null) continue;
    const route = `${dep}-${arr}`;
    if (!profile.has(route)) profile.set(route, new Map());
    const byAirline = profile.get(route)!;
    if (!byAirline.has(airline)) byAirline.set(airline, []);
    byAirline.get(airline)!.push(f);
}

for (const [route, byAirline] of profile) {
    if (byAirline.size < 2) continue; // 비교할 다른 항공사가 없음
    for (const [airline, own] of byAirline) {
        for (const f of own) {
            const t = minutes(f.departure!.time)!;
            // 같은 항공사의 다른 표(다른 날짜 포함)가 이 시간대를 뒷받침하는가
            const backed = own.some(g => g !== f && clockGap(minutes(g.departure!.time)!, t) <= 30);
            if (backed) continue;
            if (own.length < 2) continue; // 그 항공사 표가 이것뿐이면 판단 근거가 없다
            // 같은 노선의 다른 항공사가 이 시간대를 쓰는가
            for (const [otherAirline, others] of byAirline) {
                if (otherAirline === airline) continue;
                const matches = others.filter(g => clockGap(minutes(g.departure!.time)!, t) <= 30);
                const sources = new Set(matches.map(g => g.source));
                if (matches.length >= 2 && sources.size >= 2) {
                    findings.push({
                        kind: 'schedule-mismatch', severity: 'high', id: f.id, source: f.source,
                        route, date: dateOf(f.departure?.date),
                        detail: `${f.departure!.time} 출발을 "${f.airline}"으로 기록했지만, 이 노선에서 그 항공사의 다른 표 ${own.length - 1}건은 모두 다른 시간대다. 이 시간대는 "${matches[0].airline}"의 운항 시간대와 일치한다`,
                        peers: matches.slice(0, 3).map(g => `${g.source}:${g.id}`),
                    });
                    break;
                }
            }
        }
    }
}

// ── 4) 편명 불변식 — 같은 편명이면 항공사도 출발시각도 같아야 한다 ──
const flightNoOf = (f: Flight): string => {
    if (f.flightNumber) return f.flightNumber.split('/')[0].trim().toUpperCase();
    const fromId = f.id.match(/^[a-z]+-([A-Z]{2}\d{3,4})/)?.[1];
    return fromId ? fromId.toUpperCase() : '';
};
const byFlightNo = new Map<string, Flight[]>();
for (const f of flights) {
    const no = flightNoOf(f);
    if (!no) continue;
    const route = `${airportOf(f.departure)}-${airportOf(f.arrival)}`;
    const key = `${no}_${route}`;
    if (!byFlightNo.has(key)) byFlightNo.set(key, []);
    byFlightNo.get(key)!.push(f);
}
for (const [key, list] of byFlightNo) {
    if (list.length < 2) continue;
    const [no, route] = key.split('_');

    const airlines = new Map<string, Flight[]>();
    for (const f of list) {
        const a = normalizeAirline(f.airline);
        if (!a) continue;
        if (!airlines.has(a)) airlines.set(a, []);
        airlines.get(a)!.push(f);
    }
    if (airlines.size > 1) {
        const ranked = [...airlines.entries()].sort((a, b) => b[1].length - a[1].length);
        for (const [, minority] of ranked.slice(1)) {
            if (minority.length >= ranked[0][1].length) continue;
            for (const f of minority) {
                findings.push({
                    kind: 'flightno-airline', severity: 'high', id: f.id, source: f.source,
                    route, date: dateOf(f.departure?.date),
                    detail: `편명 ${no}을 "${f.airline}"으로 기록 — 같은 편명의 다른 표 ${ranked[0][1].length}건은 "${ranked[0][1][0].airline}"`,
                    peers: ranked[0][1].slice(0, 3).map(g => `${g.source}:${g.id}`),
                });
            }
        }
    }

    const times = list.map(f => minutes(f.departure?.time)).filter((t): t is number => t !== null);
    if (times.length >= 3) {
        const med = median(times);
        for (const f of list) {
            const t = minutes(f.departure?.time);
            if (t !== null && clockGap(t, med) > 30) {
                findings.push({
                    kind: 'flightno-time', severity: 'high', id: f.id, source: f.source,
                    route, date: dateOf(f.departure?.date),
                    detail: `편명 ${no}의 출발시각을 ${f.departure!.time}로 기록 — 같은 편명 ${times.length - 1}건의 중앙값은 ${String(Math.floor(med / 60)).padStart(2, '0')}:${String(Math.floor(med % 60)).padStart(2, '0')}`,
                });
            }
        }
    }
}

// ── 출력 ──
if (asJson) {
    console.log(JSON.stringify({
        checkedAt: new Date().toISOString(),
        totalFlights: flights.length,
        comparableGroups: comparedGroups,
        findings,
    }, null, 2));
} else {
    const bySeverity = (s: Severity) => findings.filter(f => f.severity === s);
    console.log(`\n항공권 정합성 감사 — 총 ${flights.length}건, 소스 간 대조 가능한 노선 묶음 ${comparedGroups}개\n`);

    const byKind = new Map<string, Finding[]>();
    for (const f of findings) {
        if (!byKind.has(f.kind)) byKind.set(f.kind, []);
        byKind.get(f.kind)!.push(f);
    }
    if (findings.length === 0) {
        console.log('발견된 문제 없음\n');
    } else {
        for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
            console.log(`── ${kind} (${list.length}건, ${list[0].severity})`);
            const bySource = new Map<string, number>();
            for (const f of list) bySource.set(f.source, (bySource.get(f.source) || 0) + 1);
            console.log(`   판매처별: ${[...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
            for (const f of list.slice(0, 5)) {
                console.log(`   • [${f.source}] ${f.route} ${f.date} — ${f.detail}`);
                console.log(`     ${f.id}`);
            }
            if (list.length > 5) console.log(`   … 외 ${list.length - 5}건`);
            console.log('');
        }
        console.log(`요약: high ${bySeverity('high').length} / medium ${bySeverity('medium').length} / low ${bySeverity('low').length}\n`);
    }
}

// high 심각도가 있으면 종료 코드 1 — CI에서 게이트로 쓸 수 있다
process.exit(findings.some(f => f.severity === 'high') ? 1 : 0);
