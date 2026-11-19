'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './reconciliation.css';

type Status = 'ALL' | 'MATCHED' | 'MISMATCH' | 'UNMAPPED';
type Row = {
  id: string;
  externalProductId?: string;
  externalSkuId: string;
  reportedAvailable: number;
  expectedAvailable: number | null;
  difference: number | null;
  status: Exclude<Status, 'ALL'>;
  observedAt: string;
  source?: string;
  channelAccount: { name: string; type: string };
  variant: { sku: string; name: string; product: { name: string } } | null;
};
type Result = { rows: Row[]; summary: { total: number; matched: number; mismatch: number; unmapped: number } };

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const statusText = { MATCHED: 'Khớp', MISMATCH: 'Chênh lệch', UNMAPPED: 'Chưa ghép SKU' } as const;

export default function ChannelInventoryReconciliationPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('ALL');
  const [result, setResult] = useState<Result>({ rows: [], summary: { total: 0, matched: 0, mismatch: 0, unmapped: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    setLoading(true);
    const response = await fetch(`${api}/channels/inventory-reconciliation?status=${status}`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) { localStorage.removeItem('erp_access_token'); router.replace('/login'); return; }
    if (!response.ok) throw new Error('Không thể tải dữ liệu đối chiếu tồn sàn');
    setResult(await response.json());
    setLoading(false);
  }, [router, status]);
  useEffect(() => { load().catch((reason) => { setError(reason.message); setLoading(false); }); }, [load]);
  return <main className="channel-stock-page">
    <header className="channel-stock-header"><div><p>KIỂM SOÁT TỒN ĐA KÊNH</p><h1>Đối chiếu tồn kho trên sàn</h1><span>So sánh tồn có thể bán trong ERP với ảnh chụp tồn mới nhất từ từng seller.</span></div><div><a href="/channels">Kênh bán</a><a href="/inventory">← Tồn kho</a></div></header>
    <div className="channel-stock-rule"><b>Nguyên tắc an toàn:</b> dữ liệu webhook chỉ dùng để đối chiếu và cảnh báo. Hệ thống không tự sửa tồn thực tế trong ERP.</div>
    <section className="channel-stock-metrics"><button onClick={() => setStatus('ALL')} className={status === 'ALL' ? 'active' : ''}><span>Tổng SKU theo dõi</span><strong>{result.summary.total}</strong></button><button onClick={() => setStatus('MISMATCH')} className={status === 'MISMATCH' ? 'active danger' : 'danger'}><span>Đang chênh lệch</span><strong>{result.summary.mismatch}</strong></button><button onClick={() => setStatus('UNMAPPED')} className={status === 'UNMAPPED' ? 'active warning' : 'warning'}><span>Chưa ghép SKU</span><strong>{result.summary.unmapped}</strong></button><button onClick={() => setStatus('MATCHED')} className={status === 'MATCHED' ? 'active success' : 'success'}><span>Đã khớp</span><strong>{result.summary.matched}</strong></button></section>
    {error && <div className="channel-stock-error">{error}</div>}
    <section className="channel-stock-panel"><div className="panel-title"><div><h2>{status === 'ALL' ? 'Kết quả mới nhất' : statusText[status]}</h2><span>Mỗi seller và SKU chỉ hiển thị lần ghi nhận mới nhất.</span></div><button onClick={() => load()} disabled={loading}>Làm mới</button></div>
      {loading ? <div className="channel-stock-empty">Đang tải dữ liệu…</div> : result.rows.length === 0 ? <div className="channel-stock-empty">Chưa có dữ liệu trong nhóm này. Dữ liệu sẽ xuất hiện khi seller gửi webhook tồn kho.</div> : <div className="channel-stock-table"><table><thead><tr><th>Seller</th><th>Sản phẩm / SKU</th><th>Tồn ERP</th><th>Tồn trên sàn</th><th>Chênh lệch</th><th>Ghi nhận</th><th>Trạng thái</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.id}><td><b>{row.channelAccount.name}</b><small>{row.channelAccount.type}</small></td><td><b>{row.variant?.product.name ?? 'Chưa ghép sản phẩm'}</b><small>{row.variant ? `${row.variant.sku} · ${row.variant.name}` : `SKU sàn: ${row.externalSkuId}`}</small></td><td>{row.expectedAvailable ?? '—'}</td><td><strong>{row.reportedAvailable}</strong></td><td className={(row.difference ?? 0) === 0 ? '' : 'difference'}>{row.difference === null ? '—' : row.difference > 0 ? `+${row.difference}` : row.difference}</td><td>{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.observedAt))}<small>{row.source ?? ''}</small></td><td><span className={`reconcile-status ${row.status.toLowerCase()}`}>{statusText[row.status]}</span></td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
