'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './fulfillment.css';
import './recipient.css';

type UserSummary = { id: string; displayName: string; email: string };
type Event = {
  id: string;
  createdAt: string;
  carrierName?: string;
  trackingCode?: string;
  batchCode?: string;
  note?: string;
  performedBy?: UserSummary;
  responsibleUser?: UserSummary;
};
type Item = { quantity: number; variant: { id: string; sku: string; name: string; product: { name: string } } };
type Order = {
  id: string;
  orderNumber: string;
  status: string;
  responsibleUserId?: string;
  responsibleUser?: UserSummary;
  channelAccount: { id: string; name: string; type: string };
  warehouse?: { name: string };
  items: Item[];
  fulfillmentEvents: Event[];
};
type OnlineGroup = {
  channel: Order['channelAccount'];
  orders: Order[];
  totals: Map<string, { sku: string; name: string; quantity: number }>;
};
type BatchResult = { batchCode: string; responsibleUser: UserSummary; orderCount: number };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const labels: Record<string, string> = {
  TIKTOK_SHOP: 'TikTok Shop',
  SHOPEE: 'Shopee',
  FACEBOOK_MESSENGER: 'Facebook',
  WEBSITE: 'Website',
  OFFLINE_STORE: 'Offline',
};

export default function FulfillmentPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [handlers, setHandlers] = useState<UserSummary[]>([]);
  const [responsibleByChannel, setResponsibleByChannel] = useState<Record<string, string>>({});
  const [lastBatch, setLastBatch] = useState<{ code: string; channelName: string; responsibleName: string }>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const [ordersResponse, handlersResponse] = await Promise.all([
      fetch(`${apiUrl}/fulfillment/orders`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/fulfillment/handlers`, { headers, cache: 'no-store' }),
    ]);
    if (ordersResponse.status === 401 || handlersResponse.status === 401) {
      localStorage.removeItem('erp_access_token');
      router.replace('/login');
      return;
    }
    if (!ordersResponse.ok || !handlersResponse.ok) throw new Error('Không thể tải dữ liệu xuất kho');
    setOrders(await ordersResponse.json());
    setHandlers(await handlersResponse.json());
  }, [router]);

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Lỗi kết nối'));
  }, [load]);

  async function post<T>(path: string, body: unknown, key: string): Promise<T | undefined> {
    setBusy(key);
    setError('');
    try {
      const response = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message);
      await load();
      return data as T;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xuất kho');
      return undefined;
    } finally {
      setBusy('');
    }
  }

  async function dispatchGroup(group: OnlineGroup) {
    const responsibleUserId = responsibleByChannel[group.channel.id];
    if (!responsibleUserId) {
      setError(`Cần chọn nhân viên nhận đóng gói cho ${group.channel.name}`);
      return;
    }
    const result = await post<BatchResult>('/fulfillment/batch-dispatch', {
      channelAccountId: group.channel.id,
      responsibleUserId,
      orderIds: group.orders.map((order) => order.id),
    }, group.channel.id);
    if (result) {
      setLastBatch({ code: result.batchCode, channelName: group.channel.name, responsibleName: result.responsibleUser.displayName });
    }
  }

  const waiting = orders.filter((order) => order.status === 'CONFIRMED');
  const shipped = orders.filter((order) => order.status === 'SHIPPED');
  const offline = waiting.filter((order) => order.channelAccount.type === 'OFFLINE_STORE');
  const onlineGroups = useMemo(() => {
    const map = new Map<string, OnlineGroup>();
    for (const order of waiting.filter((item) => item.channelAccount.type !== 'OFFLINE_STORE')) {
      let group = map.get(order.channelAccount.id);
      if (!group) {
        group = { channel: order.channelAccount, orders: [], totals: new Map() };
        map.set(order.channelAccount.id, group);
      }
      group.orders.push(order);
      for (const item of order.items) {
        const old = group.totals.get(item.variant.id);
        group.totals.set(item.variant.id, {
          sku: item.variant.sku,
          name: item.variant.product.name,
          quantity: (old?.quantity ?? 0) + item.quantity,
        });
      }
    }
    return [...map.values()];
  }, [waiting]);

  return <main className="fulfillment-page">
    <header>
      <div><p>TRÁCH NHIỆM THỦ KHO</p><h1>Xác nhận xuất và bàn giao đóng gói</h1><span>Hệ thống tự cộng SKU theo từng seller; thủ kho chọn người nhận, đối chiếu và xác nhận một lần.</span></div>
      <a href="/">← Tổng quan</a>
    </header>
    <section className="metrics">
      <article><span>Đơn online chờ xuất</span><strong>{waiting.length - offline.length}</strong></article>
      <article><span>Gian hàng chờ xuất</span><strong>{onlineGroups.length}</strong></article>
      <article><span>Phiếu nội bộ</span><strong>{offline.length}</strong></article>
      <article><span>Người xác nhận</span><b>Thủ kho</b></article>
    </section>
    {error && <div className="error">{error}</div>}
    {lastBatch && <div className="batch-success"><div><b>Đã tạo phiếu {lastBatch.code}</b><span>{lastBatch.channelName} · Người nhận: {lastBatch.responsibleName}</span></div><a href={`/fulfillment/print-batch/${encodeURIComponent(lastBatch.code)}`} target="_blank" rel="noreferrer">In phiếu để hai bên ký</a></div>}

    <section className="panel">
      <div className="title"><h2>Tổng hợp xuất online theo seller</h2><span>Không trộn số lượng hoặc người nhận giữa các gian hàng</span></div>
      <div className="grid">{onlineGroups.map((group) => <article key={group.channel.id}>
        <div className="head"><div><b>{group.channel.name}</b><small>{labels[group.channel.type] ?? group.channel.type} · {group.orders.length} đơn</small></div><span>{[...group.totals.values()].reduce((sum, item) => sum + item.quantity, 0)} sản phẩm</span></div>
        <div className="products">{[...group.totals.values()].map((item) => <div key={item.sku}><span>{item.name}<small>{item.sku}</small></span><b>× {item.quantity}</b></div>)}</div>
        <label className="handover-select">Nhân viên nhận hàng để đóng gói *<select value={responsibleByChannel[group.channel.id] ?? ''} onChange={(event) => setResponsibleByChannel((current) => ({ ...current, [group.channel.id]: event.target.value }))}><option value="">Chọn nhân viên chịu trách nhiệm</option>{handlers.map((handler) => <option key={handler.id} value={handler.id}>{handler.displayName} · {handler.email}</option>)}</select></label>
        <div className="foot"><span>{group.orders.length} mã đơn đã đồng bộ</span><button disabled={!!busy || !responsibleByChannel[group.channel.id]} onClick={() => dispatchGroup(group)}>{busy === group.channel.id ? 'Đang xuất...' : 'Xác nhận xuất & tạo phiếu ký'}</button></div>
      </article>)}{!onlineGroups.length && <div className="empty">Không có đơn online chờ xuất.</div>}</div>
    </section>

    <section className="panel">
      <div className="title"><h2>Phiếu giao nội bộ</h2><span>In phiếu, hai bên ký và thủ kho xác nhận một lần</span></div>
      <div className="grid">{offline.map((order) => <article key={order.id}>
        <div className="head"><div><b>{order.orderNumber}</b><small>{order.items.length} SKU</small></div><span>{order.warehouse?.name}</span></div>
        <div className="recipient"><b>Nhân viên nhận: {order.responsibleUser?.displayName ?? 'Chưa chọn'}</b><span>{order.responsibleUser?.email}</span></div>
        <div className="products">{order.items.map((item) => <div key={item.variant.sku}><span>{item.variant.product.name}<small>{item.variant.sku}</small></span><b>× {item.quantity}</b></div>)}</div>
        <div className="foot"><a href={`/fulfillment/print/${order.id}`} target="_blank" rel="noreferrer">In phiếu xuất</a><button disabled={!!busy} onClick={() => post(`/fulfillment/orders/${order.id}/dispatch`, {}, order.id)}>{busy === order.id ? 'Đang xuất...' : 'Xác nhận đã bàn giao'}</button></div>
      </article>)}</div>
    </section>

    <section className="panel">
      <div className="title"><h2>Nhật ký đã bàn giao</h2><span>Truy vết thủ kho, người nhận và phiếu ký theo từng lượt</span></div>
      <div className="audit">{shipped.map((order) => {
        const event = order.fulfillmentEvents.at(-1);
        return <article key={order.id}>
          <div><b>{order.orderNumber}</b><small>{order.channelAccount.name}</small></div>
          <div><span>Thủ kho</span><b>{event?.performedBy?.displayName ?? '—'}</b></div>
          <div><span>Người nhận đóng gói</span><b>{event?.responsibleUser?.displayName ?? order.responsibleUser?.displayName ?? '—'}</b></div>
          <div><span>Thời gian</span><b>{event ? new Date(event.createdAt).toLocaleString('vi-VN') : '—'}</b></div>
          <div><span>Phiếu bàn giao</span>{event?.batchCode ? <a href={`/fulfillment/print-batch/${encodeURIComponent(event.batchCode)}`} target="_blank" rel="noreferrer">{event.batchCode}</a> : <b>{event?.trackingCode ?? '—'}</b>}</div>
        </article>;
      })}</div>
    </section>
  </main>;
}
