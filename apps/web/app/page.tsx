'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './dashboard.css';

type Summary = {
  generatedAt: string;
  stats: { todayRevenue: string; processingOrders: number; unrepliedConversations: number; lowStockSkus: number };
  revenueByDay: Array<{ date: string; revenue: string }>;
  channelPerformance: Array<{ id: string; name: string; type: string; orders: number; revenue: string; issueRate: number; status: 'STABLE' | 'WATCH' }>;
  alerts: Array<{ type: string; severity: 'CRITICAL' | 'WARNING' | 'INFO'; title: string; detail: string }>;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('vi-VN');

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    fetch(`${apiUrl}/dashboard/summary`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (response.status === 401) { localStorage.removeItem('erp_access_token'); router.replace('/login'); throw new Error('Phiên đăng nhập đã hết hạn'); }
        if (!response.ok) throw new Error('Không thể tải dữ liệu tổng quan');
        return response.json();
      })
      .then(setData)
      .catch((reason) => setError(reason.message));
  }, [router]);

  const chartMax = useMemo(() => Math.max(...(data?.revenueByDay.map((item) => Number(item.revenue)) ?? [1]), 1), [data]);
  const totalRevenue = data?.revenueByDay.reduce((sum, item) => sum + Number(item.revenue), 0) ?? 0;
  const stats = data ? [
    { label: 'Doanh thu hôm nay', value: money.format(Number(data.stats.todayRevenue)), note: 'Đơn hợp lệ phát sinh trong ngày', tone: 'green' },
    { label: 'Đơn đang xử lý', value: number.format(data.stats.processingOrders), note: 'Chờ xác nhận, đóng gói hoặc đang giao', tone: 'blue' },
    { label: 'Chat chưa trả lời', value: number.format(data.stats.unrepliedConversations), note: 'Tin chưa đọc và chưa phản hồi', tone: 'orange' },
    { label: 'SKU sắp hết', value: number.format(data.stats.lowStockSkus), note: 'Đã chạm điểm đặt hàng lại', tone: 'red' },
  ] : [];

  function logout() {
    localStorage.removeItem('erp_access_token');
    localStorage.removeItem('erp_user');
    router.replace('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>Q</span><div>QUẢN TRỊ<small>Doanh nghiệp đa kênh</small></div></div>
        <nav>
          <a className="active">Tổng quan</a>
          <a href="/orders">Đơn hàng</a><a href="/fulfillment">Xuất kho</a><a href="/after-sales">Hậu mãi</a><a href="/pos">Bán hàng POS</a><a>Sản phẩm</a><a href="/inventory">Kho hàng</a><a href="/inventory/transactions">Sổ giao dịch kho</a><a href="/inventory/quarantine">Kiểm định hàng hoàn</a>
          <a href="/channels">Kênh bán hàng</a><a href="/inbox">Hộp thư chung {data && data.stats.unrepliedConversations > 0 && <b>{data.stats.unrepliedConversations}</b>}</a><a href="/assisted-sales">Chốt đơn qua chat</a><a href="/customers">Khách hàng</a>
          <a href="/purchasing">Mua hàng</a><a href="/reports">Báo cáo</a><a href="/reconciliation">Đối soát tiền về</a><a href="/reports/channels">Phát triển kênh</a><a href="/staff">Nhân viên & phân quyền</a><a>Cấu hình</a>
        </nav>
        <button className="user" onClick={logout}><i>AD</i><div>Quản trị viên<small>Đăng xuất</small></div></button>
      </aside>
      <main>
        <header><div><h1>Trung tâm điều hành</h1><p>{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'full' }).format(new Date())}</p></div><button onClick={() => router.push('/orders')}>+ Tạo đơn hàng</button></header>
        <section className="filters"><button>Hôm nay</button><button>Tất cả kênh</button><button>Tất cả chi nhánh</button><span>{data ? `Dữ liệu cập nhật ${new Date(data.generatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : 'Đang tải dữ liệu...'}</span></section>
        {error && <article className="panel error-message">{error}</article>}
        <section className="stats">{stats.map((item) => <article key={item.label}><div className={`dot ${item.tone}`}></div><p>{item.label}</p><h2>{item.value}</h2><small>{item.note}</small></article>)}</section>
        {!data && !error && <article className="panel loading">Đang tổng hợp dữ liệu vận hành...</article>}
        {data && <>
          <section className="grid">
            <article className="panel performance"><div className="panel-title"><div><h3>Hiệu quả kinh doanh</h3><p>Doanh thu online và offline trong 7 ngày</p></div><strong>{money.format(totalRevenue)}</strong></div><div className="chart"><div className="axis"><span>{money.format(chartMax)}</span><span>{money.format(chartMax / 2)}</span><span>0</span></div>{data.revenueByDay.map((item) => <div className="bar-wrap" key={item.date} title={money.format(Number(item.revenue))}><div className="bar" style={{ height: `${Math.max(5, Number(item.revenue) / chartMax * 100)}%` }}></div><span>{new Date(`${item.date}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</span></div>)}</div></article>
            <article className="panel alerts"><div className="panel-title"><div><h3>Cảnh báo cần xử lý</h3><p>Ưu tiên theo mức độ ảnh hưởng</p></div></div>{data.alerts.length ? data.alerts.map((alert) => <div className={`alert ${alert.severity === 'CRITICAL' ? 'critical' : alert.severity === 'WARNING' ? 'warning' : 'info'}`} key={alert.type}><b>{alert.title}</b><span>{alert.detail}</span></div>) : <div className="empty-state">Không có cảnh báo mới</div>}</article>
          </section>
          <article className="panel channel-table"><div className="panel-title"><div><h3>Hiệu suất theo gian hàng</h3><p>30 ngày gần nhất</p></div></div><table><thead><tr><th>Gian hàng</th><th>Kênh</th><th>Đơn hàng</th><th>Doanh thu</th><th>Tỷ lệ hủy/hoàn</th><th>Trạng thái</th></tr></thead><tbody>{data.channelPerformance.map((channel) => <tr key={channel.id}><td><strong>{channel.name}</strong></td><td>{channel.type.replaceAll('_', ' ')}</td><td>{number.format(channel.orders)}</td><td>{money.format(Number(channel.revenue))}</td><td>{(channel.issueRate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</td><td><span className={channel.status === 'STABLE' ? 'status ok' : 'status watch'}>{channel.status === 'STABLE' ? 'Ổn định' : 'Cần theo dõi'}</span></td></tr>)}</tbody></table></article>
        </>}
      </main>
    </div>
  );
}
