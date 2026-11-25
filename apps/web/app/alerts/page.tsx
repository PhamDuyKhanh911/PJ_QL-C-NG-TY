'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './alerts.css';
import './workflow.css';

type Severity = 'CRITICAL' | 'WARNING' | 'INFO';
type WorkflowStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
type AlertItem = { id: string; type: string; severity: Severity; title: string; detail: string; count: number; occurredAt: string; ownerLabel: string; actionLabel: string; href: string; status: WorkflowStatus; assignedTo: { id: string; displayName: string; email: string } | null; resolutionNote: string | null; isOverdue: boolean; slaHours: number; isMine: boolean };
type AlertResponse = { generatedAt: string; summary: { total: number; critical: number; warning: number; inventory: number; seller: number; returns: number; open: number; inProgress: number; resolved: number; overdue: number; mine: number }; items: AlertItem[] };

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const typeLabels: Record<string, string> = { ALL: 'Tất cả nhóm', INVENTORY: 'Tồn kho', RECONCILIATION: 'Đối chiếu seller', INTEGRATION: 'Đồng bộ dữ liệu', CONNECTION: 'Kết nối seller', RETURN: 'Hàng hoàn' };
const severityLabels: Record<string, string> = { ALL: 'Mọi mức độ', CRITICAL: 'Khẩn cấp', WARNING: 'Cần xử lý', INFO: 'Thông tin' };
const statusLabels: Record<string, string> = { ACTIVE: 'Đang cần xử lý', ALL: 'Tất cả trạng thái', OPEN: 'Chưa xử lý', IN_PROGRESS: 'Đang xử lý', RESOLVED: 'Đã hoàn tất' };

export default function AlertsPage() {
  const router = useRouter();
  const [data, setData] = useState<AlertResponse | null>(null);
  const [severity, setSeverity] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [updating, setUpdating] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    setLoading(true); setError('');
    const params = new URLSearchParams({ severity, type, status });
    if (search.trim()) params.set('search', search.trim());
    const response = await fetch(`${api}/alerts?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (response.status === 401) { localStorage.removeItem('erp_access_token'); router.replace('/login'); return; }
    if (response.status === 403) { router.replace('/'); return; }
    if (!response.ok) throw new Error('Không thể tải cảnh báo vận hành.');
    setData(await response.json()); setLoading(false);
  }, [router, search, severity, status, type]);

  useEffect(() => {
    const timer = setTimeout(() => load().catch((reason) => { setError(reason instanceof Error ? reason.message : 'Lỗi kết nối'); setLoading(false); }), 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) return;
    fetch(`${api}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((me) => setCanManage(Boolean(me?.permissions?.includes('*') || me?.permissions?.includes('alerts.manage'))))
      .catch(() => setCanManage(false));
  }, []);

  const updateStatus = async (item: AlertItem, nextStatus: WorkflowStatus) => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const note = nextStatus === 'RESOLVED' ? window.prompt('Ghi chú kết quả xử lý (có thể để trống):', item.resolutionNote ?? '') : undefined;
    if (nextStatus === 'RESOLVED' && note === null) return;
    setUpdating(item.id); setError('');
    try {
      const response = await fetch(`${api}/alerts/${encodeURIComponent(item.id)}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, ...(note !== undefined ? { note } : {}) }),
      });
      if (!response.ok) throw new Error(response.status === 403 ? 'Bạn chưa được cấp quyền xử lý cảnh báo.' : 'Không thể cập nhật cảnh báo.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Lỗi cập nhật cảnh báo');
    } finally {
      setUpdating('');
    }
  };

  return <main className="alerts-page">
    <header className="alerts-header"><div><p>ĐIỀU HÀNH CHỦ ĐỘNG</p><h1>Trung tâm cảnh báo</h1><span>Một nơi theo dõi các rủi ro tồn kho, seller, đồng bộ và hàng hoàn cần xử lý.</span></div><a href="/">← Tổng quan</a></header>
    <section className="alerts-metrics">
      <article><span>Chưa xử lý</span><strong>{data?.summary.open ?? 0}</strong></article>
      <article><span>Đang xử lý</span><strong>{data?.summary.inProgress ?? 0}</strong></article>
      <article className="critical"><span>Quá hạn SLA</span><strong>{data?.summary.overdue ?? 0}</strong></article>
      <article><span>Đã hoàn tất</span><strong>{data?.summary.resolved ?? 0}</strong></article>
      <article><span>Việc của tôi</span><strong>{data?.summary.mine ?? 0}</strong></article>
      <article className="critical"><span>Khẩn cấp</span><strong>{data?.summary.critical ?? 0}</strong></article>
    </section>
    <section className="alerts-filters">
      <label>Mức độ<select value={severity} onChange={(event) => setSeverity(event.target.value)}>{Object.entries(severityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Nhóm cảnh báo<select value={type} onChange={(event) => setType(event.target.value)}>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Trạng thái xử lý<select value={status} onChange={(event) => setStatus(event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="search">Tìm nhanh<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SKU, đơn hàng, seller…" /></label>
      <div className="freshness"><span>Cập nhật tự động</span><b>{data ? new Date(data.generatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</b></div>
    </section>
    {error && <div className="alerts-error">{error}</div>}
    <section className="alerts-panel">
      <div className="alerts-panel-title"><div><h2>Việc cần xử lý</h2><p>Cảnh báo khẩn cấp được đưa lên trước; mỗi dòng dẫn thẳng đến màn hình xử lý.</p></div><span>{loading ? 'Đang kiểm tra…' : `${data?.items.length ?? 0} kết quả`}</span></div>
      {!loading && data?.items.length === 0 && <div className="alerts-empty"><b>Không có cảnh báo phù hợp</b><span>Hệ thống chưa phát hiện vấn đề theo bộ lọc hiện tại.</span></div>}
      <div className="alerts-list">{data?.items.map((item) => <article className={item.severity.toLowerCase()} key={item.id}>
        <div className="severity-mark"><i></i><span>{severityLabels[item.severity]}</span></div>
        <div className="alert-body"><div><em>{typeLabels[item.type] ?? item.type}</em>{item.count > 1 && <small>{item.count} mục</small>}{item.isOverdue && <small className="overdue-tag">Quá hạn SLA {item.slaHours} giờ</small>}{item.isMine && <small>Việc của tôi</small>}</div><h3>{item.title}</h3><p>{item.detail}</p><time>{new Date(item.occurredAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</time></div>
        <div className="alert-owner"><span>{item.status === 'IN_PROGRESS' ? 'Người đang xử lý' : 'Đơn vị phụ trách'}</span><b>{item.assignedTo?.displayName ?? item.ownerLabel}</b><small className={`workflow-status ${item.status.toLowerCase()}`}>{statusLabels[item.status]}</small>{item.resolutionNote && <small className="resolution-note">{item.resolutionNote}</small>}</div>
        <div className="alert-actions"><a href={item.href}>{item.actionLabel} →</a>{canManage && item.status === 'OPEN' && <button disabled={updating === item.id} onClick={() => updateStatus(item, 'IN_PROGRESS')}>Nhận xử lý</button>}{canManage && item.status === 'IN_PROGRESS' && <button className="resolve" disabled={updating === item.id} onClick={() => updateStatus(item, 'RESOLVED')}>Hoàn tất</button>}{canManage && item.status === 'RESOLVED' && <button disabled={updating === item.id} onClick={() => updateStatus(item, 'OPEN')}>Mở lại</button>}</div>
      </article>)}</div>
    </section>
  </main>;
}
