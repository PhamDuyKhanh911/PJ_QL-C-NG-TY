'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './customers.css';

type Customer = { id: string; displayName: string; phone?: string; email?: string; orderCount: number; totalSpent: string; afterSaleCount: number; lastOrderAt?: string; identityCount: number; channels: Array<{ id: string; name: string; type: string }> };
type Detail = { id: string; displayName: string; phone?: string; email?: string; orders: Array<{ id: string; orderNumber: string; status: string; total: string; orderedAt: string; channelAccount: { name: string }; items: Array<{ quantity: number; variant: { sku: string; product: { name: string } } }> }>; identities: Array<{ id: string; displayName?: string; conversations: Array<{ id: string; lastMessageAt?: string; channelAccount: { name: string; type: string }; messages: Array<{ content: string }> }> }> };
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const currency = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const headers = useCallback(() => ({ Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` }), []);
  const load = useCallback(async (term = '') => {
    const token = localStorage.getItem('erp_access_token'); if (!token) { router.replace('/login'); return; }
    const response = await fetch(`${api}/customers?limit=100&search=${encodeURIComponent(term)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) { router.replace('/login'); return; }
    if (response.status === 403) throw new Error('Tài khoản chưa được cấp quyền xem khách hàng');
    if (!response.ok) throw new Error('Không thể tải danh sách khách hàng');
    const payload = await response.json(); setCustomers(payload.data);
  }, [router]);
  useEffect(() => { load().catch((reason) => setError(reason.message)); }, [load]);
  async function open(id: string) { const response = await fetch(`${api}/customers/${id}`, { headers: headers() }); if (!response.ok) { setError('Không thể tải hồ sơ khách hàng'); return; } setSelected(await response.json()); }
  const metrics = useMemo(() => ({ total: customers.length, repeat: customers.filter((item) => item.orderCount > 1).length, omnichannel: customers.filter((item) => item.channels.length > 1 || item.identityCount > 1).length, value: customers.reduce((sum, item) => sum + Number(item.totalSpent), 0) }), [customers]);

  return <main className="customers-page">
    <header className="customers-header"><div><p>CRM HỢP NHẤT</p><h1>Khách hàng đa kênh</h1><span>Hồ sơ tập trung từ đơn hàng và hội thoại TikTok, Shopee, Facebook, POS.</span></div><a href="/">← Tổng quan</a></header>
    <section className="customer-metrics"><article><span>Khách hàng</span><strong>{metrics.total}</strong></article><article><span>Mua lại</span><strong>{metrics.repeat}</strong></article><article><span>Đa kênh</span><strong>{metrics.omnichannel}</strong></article><article><span>Tổng giá trị</span><strong>{currency.format(metrics.value)}</strong></article></section>
    {error && <div className="customer-error">{error}</div>}
    <section className="customer-layout"><article className="customer-list"><div className="customer-toolbar"><div><h2>Danh sách khách hàng</h2><span>{customers.length} hồ sơ</span></div><form onSubmit={(event) => { event.preventDefault(); load(search).catch((reason) => setError(reason.message)); }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên, số điện thoại, email…"/><button>Tìm kiếm</button></form></div><div className="customer-table"><table><thead><tr><th>Khách hàng</th><th>Kênh liên kết</th><th>Đơn hàng</th><th>Chi tiêu</th><th>Hủy/hoàn</th><th>Lần mua gần nhất</th></tr></thead><tbody>{customers.map((item) => <tr key={item.id} onClick={() => open(item.id)} className={selected?.id === item.id ? 'selected' : ''}><td><b>{item.displayName}</b><small>{item.phone ?? item.email ?? 'Chưa có liên hệ'}</small></td><td><div className="channel-tags">{item.channels.length ? item.channels.map((channel) => <i key={channel.id}>{channel.type === 'FACEBOOK_MESSENGER' ? 'FB' : channel.type === 'TIKTOK_SHOP' ? 'TikTok' : channel.type}</i>) : <i>Offline</i>}</div></td><td>{item.orderCount}</td><td><b>{currency.format(Number(item.totalSpent))}</b></td><td>{item.afterSaleCount}</td><td>{item.lastOrderAt ? new Date(item.lastOrderAt).toLocaleDateString('vi-VN') : '—'}</td></tr>)}</tbody></table></div></article>
      <aside className="customer-detail">{selected ? <><div className="profile-avatar">{selected.displayName.split(' ').slice(-2).map((word) => word[0]).join('')}</div><h2>{selected.displayName}</h2><span>{selected.phone ?? 'Chưa có số điện thoại'} · {selected.email ?? 'Chưa có email'}</span><section><h3>Danh tính & hội thoại</h3>{selected.identities.map((identity) => <div className="identity" key={identity.id}><b>{identity.displayName ?? selected.displayName}</b>{identity.conversations.map((conversation) => <p key={conversation.id}>{conversation.channelAccount.name}<small>{conversation.messages[0]?.content ?? 'Chưa có tin nhắn'}</small></p>)}</div>)}</section><section><h3>Đơn gần đây</h3>{selected.orders.length ? selected.orders.slice(0, 8).map((order) => <div className="recent-order" key={order.id}><b>{order.orderNumber}</b><span>{currency.format(Number(order.total))}</span><small>{order.channelAccount.name} · {order.status}</small></div>) : <p>Chưa có đơn hàng</p>}</section></> : <div className="empty-profile">Chọn một khách hàng để xem hồ sơ 360°.</div>}</aside>
    </section>
  </main>;
}
