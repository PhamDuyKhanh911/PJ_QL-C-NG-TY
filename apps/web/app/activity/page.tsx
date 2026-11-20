'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './activity.css';

type Person = { id: string; displayName: string; email: string; active?: boolean };
type ActivityItem = { id: string; category: string; action: string; title: string; detail: string; occurredAt: string; actor: Person | null; responsibleUser: Person | null; reference: string | null; risk: 'HIGH' | 'MEDIUM' | 'NORMAL' };
type ActivityResponse = { items: ActivityItem[]; summary: { total: number; today: number; highRisk: number; actors: number }; range: { from: string; to: string } };

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const categories: Record<string, string> = { ALL: 'Tất cả hoạt động', INVENTORY: 'Kho hàng', FULFILLMENT: 'Xuất kho', CHANNEL: 'Kênh bán', PURCHASING: 'Nhập hàng', ADMINISTRATION: 'Tài khoản & phân quyền', BACKUP: 'Sao lưu dữ liệu' };

export default function ActivityPage() {
  const router = useRouter();
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [actors, setActors] = useState<Person[]>([]);
  const [category, setCategory] = useState('ALL');
  const [userId, setUserId] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    setLoading(true); setError('');
    const params = new URLSearchParams({ category, limit: '200' });
    if (userId) params.set('userId', userId);
    if (search.trim()) params.set('search', search.trim());
    if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
    if (to) params.set('to', new Date(`${to}T23:59:59.999`).toISOString());
    const headers = { Authorization: `Bearer ${token}` };
    const [activityResponse, actorsResponse] = await Promise.all([fetch(`${api}/activity?${params}`, { headers, cache: 'no-store' }), fetch(`${api}/activity/actors`, { headers, cache: 'no-store' })]);
    if (activityResponse.status === 401) { localStorage.removeItem('erp_access_token'); router.replace('/login'); return; }
    if (activityResponse.status === 403) { router.replace('/'); return; }
    if (!activityResponse.ok || !actorsResponse.ok) throw new Error('Không thể tải nhật ký hoạt động.');
    setData(await activityResponse.json()); setActors(await actorsResponse.json()); setLoading(false);
  }, [category, from, router, search, to, userId]);

  useEffect(() => { const timer = setTimeout(() => load().catch((reason) => { setError(reason instanceof Error ? reason.message : 'Lỗi kết nối'); setLoading(false); }), 250); return () => clearTimeout(timer); }, [load]);

  return <main className="activity-page">
    <header className="activity-header"><div><p>KIỂM SOÁT VẬN HÀNH</p><h1>Nhật ký hoạt động</h1><span>Theo dõi ai đã thao tác, việc gì đã thay đổi và ai đang chịu trách nhiệm nhận hàng.</span></div><a href="/">← Tổng quan</a></header>
    <section className="activity-metrics"><article><span>Hoạt động đang hiển thị</span><strong>{data?.summary.total ?? 0}</strong></article><article><span>Phát sinh hôm nay</span><strong>{data?.summary.today ?? 0}</strong></article><article><span>Cần chú ý</span><strong className="danger">{data?.summary.highRisk ?? 0}</strong></article><article><span>Nhân viên thực hiện</span><strong>{data?.summary.actors ?? 0}</strong></article></section>
    <section className="activity-filters"><label>Nhóm hoạt động<select value={category} onChange={(event) => setCategory(event.target.value)}>{Object.entries(categories).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Nhân viên<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Tất cả nhân viên</option>{actors.map((actor) => <option value={actor.id} key={actor.id}>{actor.displayName}{actor.active === false ? ' · đã khóa' : ''}</option>)}</select></label><label>Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Đến ngày<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label className="search">Tìm kiếm<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mã đơn, SKU, seller…" /></label></section>
    {error && <div className="activity-error">{error}</div>}
    <section className="activity-panel"><div className="activity-panel-title"><div><h2>Dòng thời gian trách nhiệm</h2><p>Dữ liệu lấy trực tiếp từ giao dịch kho, phiếu xuất, đồng bộ seller và nhật ký quản trị.</p></div><span>{loading ? 'Đang tải…' : `${data?.items.length ?? 0} kết quả`}</span></div>
      {!loading && data?.items.length === 0 && <div className="activity-empty">Không có hoạt động phù hợp bộ lọc.</div>}
      <div className="activity-timeline">{data?.items.map((item) => <article key={item.id}>
        <div className={`activity-mark ${item.risk.toLowerCase()}`}></div>
        <div className="activity-time"><b>{new Date(item.occurredAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</b><span>{new Date(item.occurredAt).toLocaleDateString('vi-VN')}</span></div>
        <div className="activity-content"><div><em>{categories[item.category] ?? item.category}</em>{item.risk === 'HIGH' && <i>Cần chú ý</i>}</div><h3>{item.title}</h3><p>{item.detail}</p>{item.reference && <small>Tham chiếu: {item.reference}</small>}</div>
        <div className="activity-people"><span>Người thực hiện</span><b>{item.actor?.displayName ?? 'Hệ thống tự động'}</b>{item.actor?.email && <small>{item.actor.email}</small>}{item.responsibleUser && <><span className="responsible">Người nhận trách nhiệm</span><b>{item.responsibleUser.displayName}</b></>}</div>
      </article>)}</div>
    </section>
  </main>;
}
