'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './alerts.css';

type Severity = 'CRITICAL' | 'WARNING' | 'INFO';
type AlertItem = { id: string; type: string; severity: Severity; title: string; detail: string; count: number; occurredAt: string; ownerLabel: string; actionLabel: string; href: string };
type AlertResponse = { generatedAt: string; summary: { total: number; critical: number; warning: number; inventory: number; seller: number; returns: number }; items: AlertItem[] };

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const typeLabels: Record<string, string> = { ALL: 'Tất cả nhóm', INVENTORY: 'Tồn kho', RECONCILIATION: 'Đối chiếu seller', INTEGRATION: 'Đồng bộ dữ liệu', CONNECTION: 'Kết nối seller', RETURN: 'Hàng hoàn' };
const severityLabels: Record<string, string> = { ALL: 'Mọi mức độ', CRITICAL: 'Khẩn cấp', WARNING: 'Cần xử lý', INFO: 'Thông tin' };

export default function AlertsPage() {
  const router = useRouter();
  const [data, setData] = useState<AlertResponse | null>(null);
  const [severity, setSeverity] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    setLoading(true); setError('');
    const params = new URLSearchParams({ severity, type });
    if (search.trim()) params.set('search', search.trim());
    const response = await fetch(`${api}/alerts?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (response.status === 401) { localStorage.removeItem('erp_access_token'); router.replace('/login'); return; }
    if (response.status === 403) { router.replace('/'); return; }
    if (!response.ok) throw new Error('Không thể tải cảnh báo vận hành.');
    setData(await response.json()); setLoading(false);
  }, [router, search, severity, type]);

  useEffect(() => {
    const timer = setTimeout(() => load().catch((reason) => { setError(reason instanceof Error ? reason.message : 'Lỗi kết nối'); setLoading(false); }), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return <main className="alerts-page">
    <header className="alerts-header"><div><p>ĐIỀU HÀNH CHỦ ĐỘNG</p><h1>Trung tâm cảnh báo</h1><span>Một nơi theo dõi các rủi ro tồn kho, seller, đồng bộ và hàng hoàn cần xử lý.</span></div><a href="/">← Tổng quan</a></header>
    <section className="alerts-metrics">
      <article><span>Tổng cảnh báo</span><strong>{data?.summary.total ?? 0}</strong></article>
      <article className="critical"><span>Khẩn cấp</span><strong>{data?.summary.critical ?? 0}</strong></article>
      <article className="warning"><span>Cần xử lý</span><strong>{data?.summary.warning ?? 0}</strong></article>
      <article><span>Tồn kho</span><strong>{data?.summary.inventory ?? 0}</strong></article>
      <article><span>Seller &amp; đồng bộ</span><strong>{data?.summary.seller ?? 0}</strong></article>
      <article><span>Hàng hoàn</span><strong>{data?.summary.returns ?? 0}</strong></article>
    </section>
    <section className="alerts-filters">
      <label>Mức độ<select value={severity} onChange={(event) => setSeverity(event.target.value)}>{Object.entries(severityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Nhóm cảnh báo<select value={type} onChange={(event) => setType(event.target.value)}>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="search">Tìm nhanh<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SKU, đơn hàng, seller…" /></label>
      <div className="freshness"><span>Cập nhật tự động</span><b>{data ? new Date(data.generatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</b></div>
    </section>
    {error && <div className="alerts-error">{error}</div>}
    <section className="alerts-panel">
      <div className="alerts-panel-title"><div><h2>Việc cần xử lý</h2><p>Cảnh báo khẩn cấp được đưa lên trước; mỗi dòng dẫn thẳng đến màn hình xử lý.</p></div><span>{loading ? 'Đang kiểm tra…' : `${data?.items.length ?? 0} kết quả`}</span></div>
      {!loading && data?.items.length === 0 && <div className="alerts-empty"><b>Không có cảnh báo phù hợp</b><span>Hệ thống chưa phát hiện vấn đề theo bộ lọc hiện tại.</span></div>}
      <div className="alerts-list">{data?.items.map((item) => <article className={item.severity.toLowerCase()} key={item.id}>
        <div className="severity-mark"><i></i><span>{severityLabels[item.severity]}</span></div>
        <div className="alert-body"><div><em>{typeLabels[item.type] ?? item.type}</em>{item.count > 1 && <small>{item.count} mục</small>}</div><h3>{item.title}</h3><p>{item.detail}</p><time>{new Date(item.occurredAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</time></div>
        <div className="alert-owner"><span>Đơn vị phụ trách</span><b>{item.ownerLabel}</b></div>
        <a href={item.href}>{item.actionLabel} →</a>
      </article>)}</div>
    </section>
  </main>;
}
