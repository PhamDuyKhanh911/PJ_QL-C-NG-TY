'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './orders.css';

type Order = { id: string; orderNumber: string; status: string; total: string; orderedAt: string; channelAccount: { name: string; type: string }; customer?: { displayName: string }; items: Array<{ quantity: number; variant: { sku: string; product: { name: string } } }> };
type Metrics = { total: number; cancelled: number; delivered: number; returned: number; exchanged: number; cancellationRate: number; returnRate: number; exchangeRate: number };

const statusLabel: Record<string, string> = { PENDING: 'Chờ xác nhận', CONFIRMED: 'Đã xác nhận', PACKING: 'Đang đóng gói', SHIPPED: 'Đang giao', DELIVERED: 'Đã giao', CANCELLED: 'Đã hủy', RETURNED: 'Đã hoàn', PARTIALLY_RETURNED: 'Hoàn một phần' };

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [metrics, setMetrics] = useState<Metrics>();
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/sales/orders?limit=100`, { headers }),
      fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/sales/metrics`, { headers }),
    ]).then(async ([ordersResponse, metricsResponse]) => {
      if (ordersResponse.status === 401 || metricsResponse.status === 401) { router.replace('/login'); return; }
      if (!ordersResponse.ok || !metricsResponse.ok) throw new Error('Không thể tải dữ liệu đơn hàng');
      const ordersPayload = await ordersResponse.json();
      setOrders(ordersPayload.data);
      setMetrics(await metricsResponse.json());
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Lỗi kết nối')).finally(() => setLoading(false));
  }, [router]);

  const visible = filter === 'ALL' ? orders : orders.filter((order) => order.status === filter);
  const formatMoney = (value: string) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value));
  const formatRate = (value = 0) => `${(value * 100).toFixed(1)}%`;

  return <main className="orders-page">
    <header className="orders-header"><div><p>QUẢN LÝ BÁN HÀNG</p><h1>Đơn hàng đa kênh</h1><span>Tập trung đơn TikTok, Shopee và cửa hàng offline.</span></div><a href="/">← Tổng quan</a></header>
    <section className="orders-metrics"><article><span>Tổng đơn</span><strong>{metrics?.total ?? 0}</strong></article><article><span>Đã giao</span><strong>{metrics?.delivered ?? 0}</strong></article><article className="warning"><span>Tỷ lệ hủy</span><strong>{formatRate(metrics?.cancellationRate)}</strong></article><article className="warning"><span>Tỷ lệ hoàn</span><strong>{formatRate(metrics?.returnRate)}</strong></article><article><span>Tỷ lệ đổi</span><strong>{formatRate(metrics?.exchangeRate)}</strong></article></section>
    <section className="orders-panel"><div className="orders-toolbar"><div><h2>Danh sách đơn hàng</h2><span>{visible.length} đơn trong bộ lọc hiện tại</span></div><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">Tất cả trạng thái</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
      {loading ? <div className="orders-state">Đang tải đơn hàng…</div> : error ? <div className="orders-state error">{error}</div> : <div className="orders-table-wrap"><table><thead><tr><th>Mã đơn</th><th>Kênh bán</th><th>Sản phẩm</th><th>Khách hàng</th><th>Giá trị</th><th>Ngày tạo</th><th>Trạng thái</th></tr></thead><tbody>{visible.map((order)=><tr key={order.id}><td><b>{order.orderNumber}</b></td><td><span className="channel-name">{order.channelAccount.name}</span><small>{order.channelAccount.type.replace('_',' ')}</small></td><td>{order.items[0]?.variant.product.name}<small>{order.items[0]?.variant.sku}{order.items.length>1?` +${order.items.length-1} SKU`:''}</small></td><td>{order.customer?.displayName??'Khách lẻ'}</td><td><b>{formatMoney(order.total)}</b></td><td>{new Date(order.orderedAt).toLocaleDateString('vi-VN')}</td><td><span className={`order-status ${order.status.toLowerCase()}`}>{statusLabel[order.status]??order.status}</span></td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
