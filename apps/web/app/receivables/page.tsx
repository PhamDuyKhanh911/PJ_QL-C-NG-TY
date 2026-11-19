'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './receivables.css';

type MoneyBucket = { orders: number; amount: string };
type ReceivableRow = {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  orderedAt: string;
  ageDays: number;
  channel: { id: string; code: string; name: string; type: string };
  grossAmount: string;
  expectedAmount: string;
  receivedAmount: string;
  outstandingAmount: string;
  overpaidAmount: string;
  collectionStatus: 'UNRECONCILED' | 'PARTIAL' | 'OVERDUE' | 'PAID' | 'OVERPAID';
};

type Receivables = {
  generatedAt: string;
  policy: { overdueAfterDays: number; ageingFrom: string };
  totals: {
    orders: number;
    openOrders: number;
    overdueOrders: number;
    grossAmount: string;
    expectedAmount: string;
    receivedAmount: string;
    outstandingAmount: string;
    overpaidAmount: string;
  };
  aging: { current: MoneyBucket; warning: MoneyBucket; overdue: MoneyBucket; critical: MoneyBucket };
  byChannel: Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    orders: number;
    openOrders: number;
    expectedAmount: string;
    receivedAmount: string;
    outstandingAmount: string;
  }>;
  rows: ReceivableRow[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const money = (value: string | number) => new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
}).format(Number(value));

const statusLabel: Record<ReceivableRow['collectionStatus'], string> = {
  UNRECONCILED: 'Chưa đối soát',
  PARTIAL: 'Thu thiếu',
  OVERDUE: 'Quá hạn',
  PAID: 'Đã thu đủ',
  OVERPAID: 'Thu thừa',
};

export default function ReceivablesPage() {
  const router = useRouter();
  const [data, setData] = useState<Receivables>();
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [channelId, setChannelId] = useState('ALL');
  const [status, setStatus] = useState('OPEN');

  useEffect(() => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/reconciliation/receivables`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (response.status === 401) {
          localStorage.removeItem('erp_access_token');
          router.replace('/login');
          return;
        }
        if (!response.ok) throw new Error('Không thể tải dữ liệu công nợ');
        setData(await response.json());
      })
      .catch((requestError) => setError(requestError.message));
  }, [router]);

  const rows = useMemo(() => (data?.rows ?? []).filter((row) => {
    const matchesSearch = !search || `${row.orderNumber} ${row.channel.name}`.toLowerCase().includes(search.toLowerCase());
    const matchesChannel = channelId === 'ALL' || row.channel.id === channelId;
    const matchesStatus = status === 'ALL'
      || (status === 'OPEN' && row.collectionStatus !== 'PAID')
      || row.collectionStatus === status;
    return matchesSearch && matchesChannel && matchesStatus;
  }), [data, search, channelId, status]);

  const agingCards = data ? [
    { label: '0–7 ngày', note: 'Trong thời gian chờ', value: data.aging.current, tone: 'current' },
    { label: '8–14 ngày', note: 'Cần nhắc đối soát', value: data.aging.warning, tone: 'warning' },
    { label: '15–30 ngày', note: 'Đã quá hạn', value: data.aging.overdue, tone: 'overdue' },
    { label: 'Trên 30 ngày', note: 'Ưu tiên xử lý', value: data.aging.critical, tone: 'critical' },
  ] : [];

  return (
    <main className="receivables-page">
      <header>
        <div>
          <p>TÀI CHÍNH ĐA KÊNH</p>
          <h1>Công nợ và dòng tiền phải thu</h1>
          <span>Theo dõi khoản còn thiếu từ từng seller và đơn offline sau khi giao hàng.</span>
        </div>
        <nav><a href="/reconciliation">Đối soát</a><a href="/">Tổng quan</a></nav>
      </header>

      {error && <div className="receivables-error">{error}</div>}
      {!data && !error && <div className="loading">Đang tổng hợp công nợ...</div>}
      {data && (
        <>
          <section className="summary-cards">
            <article><span>Phải thu sau hoàn & phí</span><strong>{money(data.totals.expectedAmount)}</strong><small>{data.totals.orders} đơn đã giao</small></article>
            <article className="received"><span>Đã thực nhận</span><strong>{money(data.totals.receivedAmount)}</strong><small>Tiền đã về tài khoản/quầy</small></article>
            <article className="open"><span>Còn phải thu</span><strong>{money(data.totals.outstandingAmount)}</strong><small>{data.totals.openOrders} đơn còn mở</small></article>
            <article className="late"><span>Nợ quá hạn</span><strong>{data.totals.overdueOrders}</strong><small>Quá {data.policy.overdueAfterDays} ngày</small></article>
            <article><span>Thu thừa cần kiểm tra</span><strong>{money(data.totals.overpaidAmount)}</strong><small>Đối chiếu lại kỳ thanh toán</small></article>
          </section>

          <section className="aging-grid">
            {agingCards.map((card) => (
              <article className={card.tone} key={card.label}>
                <div><b>{card.label}</b><span>{card.note}</span></div>
                <div><strong>{money(card.value.amount)}</strong><small>{card.value.orders} đơn</small></div>
              </article>
            ))}
          </section>

          <section className="receivables-panel">
            <div className="panel-heading">
              <div><h2>Công nợ theo seller</h2><span>Không gộp chéo tiền giữa các gian hàng</span></div>
            </div>
            <div className="channel-strip">
              {data.byChannel.map((channel) => (
                <button key={channel.id} className={channelId === channel.id ? 'active' : ''} onClick={() => setChannelId(channelId === channel.id ? 'ALL' : channel.id)}>
                  <span>{channel.name}</span>
                  <strong>{money(channel.outstandingAmount)}</strong>
                  <small>{channel.openOrders}/{channel.orders} đơn còn mở</small>
                </button>
              ))}
            </div>
          </section>

          <section className="receivables-panel">
            <div className="panel-heading with-filters">
              <div><h2>Chi tiết phải thu</h2><span>Cập nhật {new Date(data.generatedAt).toLocaleString('vi-VN')}</span></div>
              <div className="filters">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã đơn hoặc seller" />
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="OPEN">Còn phải xử lý</option>
                  <option value="ALL">Tất cả trạng thái</option>
                  <option value="UNRECONCILED">Chưa đối soát</option>
                  <option value="PARTIAL">Thu thiếu</option>
                  <option value="OVERDUE">Quá hạn</option>
                  <option value="PAID">Đã thu đủ</option>
                  <option value="OVERPAID">Thu thừa</option>
                </select>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Đơn hàng</th><th>Seller</th><th>Tuổi nợ</th><th>Phải thu</th><th>Đã nhận</th><th>Còn thiếu</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.orderId}>
                      <td><b>{row.orderNumber}</b><small>{new Date(row.orderedAt).toLocaleDateString('vi-VN')}</small></td>
                      <td><b>{row.channel.name}</b><small>{row.channel.type.replaceAll('_', ' ')}</small></td>
                      <td>{row.ageDays} ngày</td>
                      <td>{money(row.expectedAmount)}</td>
                      <td>{money(row.receivedAmount)}</td>
                      <td className={Number(row.outstandingAmount) > 0 ? 'money-open' : ''}>{money(row.outstandingAmount)}</td>
                      <td><span className={`collection-status ${row.collectionStatus.toLowerCase()}`}>{statusLabel[row.collectionStatus]}</span></td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={7} className="empty">Không có khoản công nợ phù hợp bộ lọc.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
