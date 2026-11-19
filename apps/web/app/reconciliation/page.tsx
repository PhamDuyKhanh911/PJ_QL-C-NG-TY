'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './reconciliation.css';

type Channel = {
  id: string;
  name: string;
  type: string;
  eligibleOrders: number;
  reconciledOrders: number;
  pendingOrders: number;
  mismatchOrders: number;
  grossRevenue: string;
  paidAmount: string;
  refundAmount: string;
  deliveryCost: string;
  totalExpense: string;
  costAmount: string;
  netRevenue: string;
  differenceAmount: string;
};

type Settlement = {
  id: string;
  status: string;
  grossAmount: string;
  refundAmount: string;
  platformFee: string;
  shippingFee: string;
  expectedNetAmount: string;
  paidAmount: string;
  differenceAmount: string;
  settledAt?: string;
  order: { orderNumber: string };
};

type Summary = {
  totals: {
    eligibleOrders: number;
    reconciledOrders: number;
    pendingOrders: number;
    mismatchOrders: number;
    grossRevenue: string;
    paidAmount: string;
    refundAmount: string;
    deliveryCost: string;
    totalExpense: string;
    costAmount: string;
    netRevenue: string;
    differenceAmount: string;
  };
  byChannel: Channel[];
  recentSettlements: Settlement[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const money = (value: string | number) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value));

export default function ReconciliationPage() {
  const router = useRouter();
  const [data, setData] = useState<Summary>();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) {
      router.replace('/login');
      return;
    }

    fetch(`${apiUrl}/reconciliation/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace('/login');
          return;
        }
        if (!response.ok) throw new Error('Không thể tải dữ liệu đối soát');
        setData(await response.json());
      })
      .catch((requestError) => setError(requestError.message));
  }, [router]);

  return (
    <main className="recon-page">
      <header>
        <div>
          <p>TÀI CHÍNH ĐA KÊNH</p>
          <h1>Đối soát doanh thu & tiền về</h1>
          <span>Online dùng chi phí tổng; offline chỉ theo dõi thêm chi phí vận chuyển.</span>
        </div>
        <a href="/reports">← Báo cáo</a>
      </header>

      {error && <div className="recon-error">{error}</div>}
      {data && (
        <>
          <section className="metrics">
            <article><span>Doanh thu đã đối soát</span><strong>{money(data.totals.grossRevenue)}</strong></article>
            <article><span>Tiền hoàn</span><strong>{money(data.totals.refundAmount)}</strong></article>
            <article><span>Chi phí tổng</span><strong>{money(data.totals.costAmount)}</strong></article>
            <article><span>Doanh thu sau hoàn & phí</span><strong>{money(data.totals.netRevenue)}</strong></article>
            <article><span>Tiền thực nhận</span><strong>{money(data.totals.paidAmount)}</strong></article>
          </section>

          <section className="recon-panel">
            <div className="title">
              <div>
                <h2>Doanh thu và thực nhận theo gian hàng</h2>
                <span>Mỗi seller được đối soát độc lập</span>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Gian hàng</th>
                    <th>Đơn đã giao</th>
                    <th>Chưa tiền về</th>
                    <th>Doanh thu đối soát</th>
                    <th>Tiền hoàn</th>
                    <th>Chi phí</th>
                    <th>Sau hoàn & phí</th>
                    <th>Thực nhận</th>
                    <th>Chênh lệch</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byChannel.map((row) => (
                    <tr key={row.id}>
                      <td><b>{row.name}</b><small>{row.type.replaceAll('_', ' ')}</small></td>
                      <td>{row.eligibleOrders}</td>
                      <td><span className={row.pendingOrders ? 'badge warn' : 'badge'}>{row.pendingOrders}</span></td>
                      <td>{money(row.grossRevenue)}</td>
                      <td>{money(row.refundAmount)}</td>
                      <td>{money(row.costAmount)}<small>{row.type === 'OFFLINE_STORE' ? 'Vận chuyển' : 'Chi phí tổng'}</small></td>
                      <td>{money(row.netRevenue)}</td>
                      <td><b>{money(row.paidAmount)}</b></td>
                      <td className={Number(row.differenceAmount) !== 0 ? 'negative' : ''}>{money(row.differenceAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="recon-panel">
            <div className="title">
              <div>
                <h2>Giao dịch đối soát gần nhất</h2>
                <span>Không liệt kê chi tiết từng loại phí sàn</span>
              </div>
            </div>
            <div className="settlements">
              {data.recentSettlements.map((row) => {
                const cost = Number(row.platformFee) + Number(row.shippingFee);
                return (
                  <article key={row.id}>
                    <div><b>{row.order.orderNumber}</b><span>{row.settledAt ? new Date(row.settledAt).toLocaleDateString('vi-VN') : 'Chưa thanh toán'}</span></div>
                    <div><span>Doanh thu</span><b>{money(row.grossAmount)}</b></div>
                    <div><span>Hoàn / Chi phí</span><b>{money(Number(row.refundAmount) + cost)}</b></div>
                    <div><span>Thực nhận</span><b>{money(row.paidAmount)}</b></div>
                    <i className={row.status.toLowerCase()}>{row.status === 'MATCHED' ? 'Đã khớp' : row.status === 'MISMATCH' ? 'Lệch' : 'Chờ tiền'}</i>
                  </article>
                );
              })}
              {!data.recentSettlements.length && <div className="empty">Chưa có dữ liệu thanh toán được đồng bộ.</div>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
