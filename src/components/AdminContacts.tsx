'use client';
import { useCallback, useEffect, useState } from 'react';
import { CONTACT_TYPES, type ContactType } from '@/lib/contact';
import styles from './AdminContacts.module.css';

type Row = { id: string; category: ContactType; status: 'new' | 'in_progress' | 'resolved'; created_at: string; name?: string; email?: string; message?: string; attachment?: string };
const statuses = { new: '접수', in_progress: '처리 중', resolved: '처리 완료' };
export default function AdminContacts({ adminKey }: { adminKey: string }) {
    const [rows, setRows] = useState<Row[]>([]);
    const [detail, setDetail] = useState<Row | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [offset, setOffset] = useState(0);
    const load = useCallback(async () => {
        setBusy(true); setError(''); setDetail(null);
        try {
            const res = await fetch('/api/admin-contacts?offset=' + offset, { headers: { 'x-admin-key': adminKey }, cache: 'no-store' });
            const data = await res.json();
            if (!res.ok) throw Error(data.error);
            setRows(data.rows);
        } catch (e) { setError(e instanceof Error ? e.message : '불러오기 실패'); }
        finally { setBusy(false); }
    }, [adminKey, offset]);
    useEffect(() => { void load(); }, [load]);
    async function open(id: string) {
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/admin-contacts?id=' + id, { headers: { 'x-admin-key': adminKey }, cache: 'no-store' });
            const data = await res.json();
            if (!res.ok) throw Error(data.error);
            setDetail(data.rows[0] || null);
        } catch (e) { setError(e instanceof Error ? e.message : '불러오기 실패'); }
        finally { setBusy(false); }
    }
    async function update(status: Row['status']) {
        if (!detail || (status === 'resolved' && !window.confirm('답변을 마쳤나요? 처리 완료하면 이름·이메일·본문·첨부가 삭제되며 복원할 수 없습니다.'))) return;
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/admin-contacts', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey }, body: JSON.stringify({ id: detail.id, status }) });
            const data = await res.json();
            if (!res.ok) throw Error(data.error);
            await load();
        } catch (e) { setError(e instanceof Error ? e.message : '저장 실패'); }
        finally { setBusy(false); }
    }
    return <div className={styles.inbox}>
        <div className={styles.heading}><h2>문의함</h2><button disabled={busy} onClick={load}>새로고침</button></div>
        <p>문의 내용을 열어 확인하고, 답변은 이메일로 보내주세요. 처리 완료 시 본문과 개인정보를 삭제합니다.</p>
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">불러오는 중…</p>}
        {!busy && !error && !rows.length && <p>접수된 문의가 없습니다.</p>}
        {rows.map(row => <button disabled={busy} className={styles.row} key={row.id} onClick={() => open(row.id)}>
            <span>{CONTACT_TYPES[row.category]} · {row.id.slice(0, 8)}</span><span>{statuses[row.status]}</span>
            <time>{new Date(row.created_at).toLocaleString('ko-KR')}</time>
        </button>)}
        <div className={styles.heading}><button disabled={busy || !offset} onClick={() => setOffset(offset - 30)}>이전</button><button disabled={busy || rows.length < 30} onClick={() => setOffset(offset + 30)}>다음</button></div>
        {detail && <section className={styles.detail} aria-label="문의 상세">
            <div className={styles.heading}><h3>{CONTACT_TYPES[detail.category]}</h3><button onClick={() => setDetail(null)}>닫기</button></div>
            {detail.status === 'resolved' ? <p>처리가 완료되어 개인정보와 문의 내용이 삭제됐습니다.</p> : <>
                <p>{detail.name || '익명'} · {detail.email ? <a href={'mailto:' + detail.email}>{detail.email}</a> : '답변 이메일 없음'}</p>
                <p className={styles.message}>{detail.message}</p>
                {detail.attachment && <img src={detail.attachment} alt="고객이 첨부한 문의 화면" />}
                <div className={styles.heading}><button disabled={busy || detail.status === 'in_progress'} onClick={() => update('in_progress')}>처리 중으로 변경</button><button disabled={busy} onClick={() => update('resolved')}>처리 완료·개인정보 삭제</button></div>
            </>}
        </section>}
    </div>;
}
