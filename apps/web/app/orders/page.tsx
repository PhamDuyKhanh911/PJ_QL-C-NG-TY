'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './orders.css';

type Order = {
  id: string;
  orderNumber: string;
  externalOrderId?: string;
  externalStatus?: string;
  externalStatusUpdatedAt?: string;
  status: string;
  total: string;
  orderedAt: string;
  channelAccount: { name: string; type: string };
  customer?: { displayName: string };
  items: Array<{ quantity: number; variant: { sku: string; product: { name: string } } }>;
  fulfillmentEvents: Array<{ action: string; note?: string; createdAt: string }>;
};
type Metrics = { total: number; cancelled: number; delivered: number; returned: number; exchanged: number; cancellationRate: number; returnRate: number; exchangeRate: number };

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const statusLabel: Record<string, string> = {
  PENDING: 'Chờ xác nhận', CONFIRMED: 'Chờ thủ kho xuất', PACKING: 'Đang đóng gói', SHIPPED: 'Đang giao',
  DELIVERED: 'Đã giao', CANCELLED: 'Đã hủy', RETURNED: 'Đã hoàn', PARTIALLY_RETURNED: 'Hoàn một phần',
};
const externalLabel: Record<string, string> = {
  CREATED: 'Đơn mới', CONFIRMED: 'Đã xác nhận', READY_TO_SHIP: 'Chờ bàn giao', PROCESSING: 'Đang xử lý',
  SHIPPED: 'Sàn báo đang giao', IN_TRANSIT: 'Đang vận chuyển', IN_DELIVERY: 'Đang giao', DELIVERED: 'Sàn báo đã giao',
  COMPLETED: 'Hoàn tất', CANCELLED: 'Sàn đã hủy', CANCELED: 'Sàn đã hủy', RETURN_REQUESTED: 'Sàn yêu cầu hoàn',
};
const externalAhead = new Set(['SHIPPED', 'IN_TRANSIT', 'IN_DELIVERY', 'DELIVERED', 'COMPLETED']);

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [metrics, setMetrics] = useState<Metrics>();
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const [ordersResponse, metricsResponse] = await Promise.all([
      fetch(`${api}/sales/orders?limit=100`, { headers, cache: 'no-store' }),
      fetch(`${api}/sales/metrics`, { headers, cache: 'no-store' }),
    ]);
    if (ordersResponse.status === 401 || metricsResponse.status === 401) { localStorage.removeItem('erp_access_token'); router.replace('/login'); return; }
    if (!ordersResponse.ok || !metricsResponse.ok) throw new Error('Không thể tải dữ liệu đơn hàng');
    const ordersPayload = await ordersResponse.json();
    setOrders(ordersPayload.data);
    setMetrics(await metricsResponse.json());
  }, [router]);

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Lỗi kết nối')).finally(() => setLoading(false));
  }, [load]);

  const visible = filter === 'ALL' ? orders : filter === 'WAREHOUSE_MISMATCH'
    ? orders.filter(needsWarehouseConfirmation)
    : orders.filter((order) => order.status === filter);
  const mismatchCount = useMemo(() => orders.filter(needsWarehouseConfirmation).length, [orders]);
  const formatMoney = (value: string) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value));
  const formatRate = (value = 0) => `${(value * 100).toFixed(1)}%`;

  return <main className="orders-page">
    <header className="orders-header"><div><p>QUẢN LÝ BÁN HÀNG</p><h1>Đơn hàng đa kênh</h1><span>Tách biệt trạng thái sàn và trạng thái xuất kho để tránh thất thoát hàng.</span></div><nav><a href="/integrations">Nhật ký tích hợp</a><a href="/fulfillment">Xuất kho</a><a href="/">← Tổng quan</a></nav></header>
    <section className="orders-metrics"><article><span>Tổng đơn</span><strong>{metrics?.total ?? 0}</strong></article><article><span>Đã giao</span><strong>{metrics?.delivered ?? 0}</strong></article><article className={mismatchCount ? 'danger' : ''}><span>Chờ thủ kho đối chiếu</span><strong>{mismatchCount}</strong></article><article className="warning"><span>Tỷ lệ hủy</span><strong>{formatRate(metrics?.cancellationRate)}</strong></article><article className="warning"><span>Tỷ lệ hoàn</span><strong>{formatRate(metrics?.returnRate)}</strong></article><article><span>Tỷ lệ đổi</span><strong>{formatRate(metrics?.exchangeRate)}</strong></article></section>
    {mismatchCount > 0 && <div className="warehouse-warning"><b>{mismatchCount} đơn có trạng thái sàn đi trước kho.</b><span>Hệ thống chưa trừ tồn và chưa coi là đã xuất cho đến khi thủ kho xác nhận tại màn hình Xuất kho.</span><button onClick={() => setFilter('WAREHOUSE_MISMATCH')}>Xem các đơn</button></div>}
    <section className="orders-panel"><div className="orders-toolbar"><div><h2>Danh sách đơn hàng</h2><span>{visible.length} đơn trong bộ lọc hiện tại</span></div><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">Tất cả trạng thái</option><option value="WAREHOUSE_MISMATCH">Sàn đi trước kho</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {loading ? <div className="orders-state">Đang tải đơn hàng...</div> : error ? <div className="orders-state error">{error}</div> : <div className="orders-table-wrap"><table><thead><tr><th>Mã đơn</th><th>Kênh bán</th><th>Sản phẩm</th><th>Khách hàng</th><th>Giá trị</th><th>Trạng thái kho</th><th>Trạng thái sàn</th><th>Cập nhật</th></tr></thead><tbody>{visible.map((order) => { const mismatch = needsWarehouseConfirmation(order); return <tr className={mismatch ? 'mismatch-row' : ''} key={order.id}><td><b>{order.orderNumber}</b><small>{order.externalOrderId ? `Sàn: ${order.externalOrderId}` : 'Đơn nội bộ'}</small></td><td><span className="channel-name">{order.channelAccount.name}</span><small>{order.channelAccount.type.replaceAll('_', ' ')}</small></td><td>{order.items[0]?.variant.product.name}<small>{order.items[0]?.variant.sku}{order.items.length > 1 ? ` +${order.items.length - 1} SKU` : ''}</small></td><td>{order.customer?.displayName ?? 'Khách lẻ'}</td><td><b>{formatMoney(order.total)}</b></td><td><span className={`order-status ${order.status.toLowerCase()}`}>{statusLabel[order.status] ?? order.status}</span>{mismatch && <small className="gate-note">Chưa trừ tồn thực tế</small>}</td><td>{order.externalStatus ? <><span className={`external-status ${mismatch ? 'ahead' : ''}`}>{externalLabel[order.externalStatus] ?? order.externalStatus.replaceAll('_', ' ')}</span><small>{order.externalStatusUpdatedAt ? new Date(order.externalStatusUpdatedAt).toLocaleString('vi-VN') : ''}</small></> : <span className="external-empty">Không áp dụng</span>}</td><td>{new Date(order.orderedAt).toLocaleDateString('vi-VN')}<small>{order.fulfillmentEvents[0]?.note ?? order.fulfillmentEvents[0]?.action?.replaceAll('_', ' ')}</small></td></tr>; })}</tbody></table></div>}
    </section>
  </main>;
}

function needsWarehouseConfirmation(order: Order) {
  return Boolean(order.externalStatus && externalAhead.has(order.externalStatus) && ['PENDING', 'CONFIRMED', 'PACKING'].includes(order.status));
}
