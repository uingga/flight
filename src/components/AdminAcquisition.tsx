'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { isAgencySourceCode, type AcquisitionData, type AcquisitionSource } from '@/lib/acquisition';
import { acquisitionRows, acquisitionSourceIssues } from '@/lib/acquisition-display';
import OverlayDialog from '@/components/ui/OverlayDialog';
import { dismissOverlayWithHistory, historyOverlay, showOverlayWithHistory } from '@/lib/ui/overlay-history';
import styles from './AdminAcquisition.module.css';

function SourceTable({ rows }: { rows: AcquisitionSource[] }) {
    if (!rows.length) return <p className={styles.note} role="status">조건에 맞는 출처가 없습니다.</p>;
    return <table className={styles.table}>
        <caption className={styles.srOnly}>출처별 방문 횟수와 인원, 방문 많은 순</caption>
        <colgroup><col /><col className={styles.numberColumn} /><col className={styles.numberColumn} /></colgroup>
        <thead><tr><th scope="col">출처</th><th scope="col">방문</th><th scope="col">인원</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.source}>
            <th scope="row" title={row.rawSources?.join(', ')}>{row.label}</th>
            <td>{row.sessions.toLocaleString()}회</td>
            <td>{row.users === null ? <span aria-label="인원 미확인">—</span> : `${row.users.toLocaleString()}명`}</td>
        </tr>)}</tbody>
    </table>;
}

function Help() {
    return <details className={styles.help}>
        <summary>집계 기준</summary>
        <p>방문은 세션 수, 인원은 GA4 활성 사용자 수입니다. 같은 사람이 여러 출처로 방문할 수 있으므로 인원은 합산하지 않습니다. 확인되지 않은 인원은 —로 표시합니다.</p>
        <p>같은 서비스의 주소는 한 줄로 묶고, 방문과 인원은 GA4에서 중복을 제거해 조회합니다.</p>
        <p>‘직접 방문 · 출처 미전달’은 주소 입력·북마크 외에도 출처가 전달되지 않은 앱·메신저 방문 등을 포함합니다. ‘출처 정보 없음’은 GA4 값 자체가 비어 있는 기록입니다.</p>
        <p>여행사 코드의 ‘출처 확인 필요’는 해당 여행사에서 방문했다는 뜻이 아닙니다. 실제 유입 출처를 확인하기 전까지 원본 기록을 유지합니다.</p>
        <p>‘유형 미분류’는 출처는 있지만 유형이 불분명한 방문, ‘출처 확인 불가’는 출처 정보가 없는 방문입니다. 유형을 선택하면 해당 유형에서 발생한 방문과 인원을 보여줍니다.</p>
    </details>;
}

export default function AdminAcquisition({ data }: { data?: AcquisitionData }) {
    const id = useId();
    const overlayKey = `admin-acquisition-${id}`;
    const dialogRef = useRef<HTMLElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [category, setCategory] = useState('전체');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const categories = useMemo(() => ['전체', ...Array.from(new Set(data?.groups.filter(group => group.sources.some(source => !isAgencySourceCode(source.source))).map(group => group.label) || []))], [data]);
    const selectedCategory = categories.includes(category) ? category : '전체';
    const rows = useMemo(() => acquisitionRows(data, selectedCategory), [data, selectedCategory]);
    const sourceIssues = useMemo(() => acquisitionSourceIssues(data), [data]);
    const filtered = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase();
        return rows.filter(row => `${row.label} ${row.source} ${(row.rawSources || []).join(' ')}`.toLocaleLowerCase().includes(keyword));
    }, [rows, query]);
    const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
    const currentPage = Math.min(page, pageCount);

    useEffect(() => {
        const sync = () => setOpen(historyOverlay() === overlayKey);
        window.addEventListener('popstate', sync);
        return () => window.removeEventListener('popstate', sync);
    }, [overlayKey]);
    useEffect(() => { setPage(1); }, [data]);
    const close = () => dismissOverlayWithHistory(overlayKey, () => setOpen(false));
    const changeCategory = (value: string) => { setCategory(value); setPage(1); scrollRef.current?.scrollTo({ top: 0 }); };
    const filter = (suffix: string) => <label className={styles.filter} htmlFor={`${id}-${suffix}`}>
        <span>유형</span>
        <select id={`${id}-${suffix}`} aria-label="유입 유형" value={selectedCategory} onChange={event => changeCategory(event.target.value)}>
            {categories.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
    </label>;
    const emptyMessage = !data?.available
        ? data?.message || '유입 기록을 불러오지 못했습니다.'
        : !data.groups.length ? '이 기간에 확인되는 유입 기록이 없습니다.' : null;

    return <div className={styles.panel}>
        {emptyMessage ? <p className={styles.note} role="status">{emptyMessage}</p> : <>
            <div className={styles.toolbar}>{filter('summary-filter')}<span className={styles.meta}>방문 많은 순 · {rows.length}개 출처</span></div>
            <SourceTable rows={rows} />
            <div className={styles.footer}>
                <Help />
                <button type="button" className={styles.allButton} aria-haspopup="dialog" onClick={() => {
                    setQuery(''); setPage(1);
                    showOverlayWithHistory(overlayKey, () => setOpen(true));
                }}>출처 검색 <span>{rows.length}</span><span aria-hidden="true"> ›</span></button>
            </div>
            {!!sourceIssues.length && <details className={styles.sourceIssues}>
                <summary>출처 확인이 필요한 기록 · {sourceIssues.length}개</summary>
                <p>여행사 코드가 유입처로 기록된 항목입니다. 해당 여행사에서 방문했다는 뜻이 아니므로 출처 순위에서 분리했습니다. 방문·행동 기록은 삭제하지 않으며, 실제 유입처는 추정하지 않습니다.</p>
                <SourceTable rows={sourceIssues} />
            </details>}
        </>}
        <OverlayDialog open={open} dialogRef={dialogRef} onClose={close} ariaLabelledBy={`${id}-title`}
            overlayClassName={styles.overlay} dialogClassName={styles.dialog}>
            <header className={styles.dialogHeader}>
                <h2 id={`${id}-title`}>유입 출처 전체 보기</h2>
                <button type="button" onClick={close} aria-label="유입 출처 닫기" className={styles.close}>×</button>
            </header>
            <div className={styles.controls}>
                <label className={styles.search} htmlFor={`${id}-search`}><span className={styles.srOnly}>출처 검색</span>
                    <input id={`${id}-search`} type="search" placeholder="출처 검색" value={query} onChange={event => {
                        setQuery(event.target.value); setPage(1); scrollRef.current?.scrollTo({ top: 0 });
                    }} />
                </label>
                {filter('dialog-filter')}
            </div>
            <p className={styles.resultCount} role="status">{filtered.length.toLocaleString()}개 출처 · 방문 많은 순</p>
            <div className={styles.dialogBody} ref={scrollRef}>
                {emptyMessage ? <p className={styles.note} role="status">{emptyMessage}</p>
                    : <SourceTable rows={filtered.slice((currentPage - 1) * 10, currentPage * 10)} />}
            </div>
            <nav className={styles.pagination} aria-label="출처 페이지">
                <button type="button" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); scrollRef.current?.scrollTo({ top: 0 }); }}>이전</button>
                <span>{currentPage} / {pageCount}</span>
                <button type="button" disabled={currentPage === pageCount} onClick={() => { setPage(currentPage + 1); scrollRef.current?.scrollTo({ top: 0 }); }}>다음</button>
            </nav>
        </OverlayDialog>
    </div>;
}
