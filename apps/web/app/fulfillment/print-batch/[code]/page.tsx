'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import './batch-print.css';

type UserSummary = { displayName: string; email: string };
type BatchDetail = {
  batchCode: string;
  createdAt: string;
  channelAccount: { name: string; type: string };
  warehouse?: { name: string; branch: { name: string } };
  warehouseKeeper?: UserSummary;
  responsibleUser?: UserSummary;
  orderCount: number;
  totalQuantity: number;
  totals: Array<{ variantId: string; sku: string; name: string; variantName: string; quantity: number }>;
  orders: Array<{ id: string; orderNumber: string; externalOrderId?: string; items: Array<{ quantity: number }> }>;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export default function BatchPrintPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [batch, setBatch] = useState<BatchDetail>();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/fulfillment/batches/${encodeURIComponent(code)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message);
        setBatch(data);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Không thể tải phiếu bàn giao'));
  }, [code, router]);

  if (error) return <main className="batch-print state">{error}</main>;
  if (!batch) return <main className="batch-print state">Đang tải phiếu...</main>;

  return <main className="batch-print">
    <div className="print-actions"><button onClick={() => window.print()}>In phiếu</button><button onClick={() => window.close()}>Đóng</button></div>
    <header>
      <div><b>HỆ THỐNG QUẢN LÝ DOANH NGHIỆP</b><span>{batch.warehouse?.branch.name}</span></div>
      <div><strong>PHIẾU BÀN GIAO HÀNG ĐÓNG GÓI</strong><span>Số: {batch.batchCode}</span></div>
    </header>
    <section className="batch-info">
      <p><span>Kho xuất:</span><b>{batch.warehouse?.name}</b></p>
      <p><span>Gian hàng:</span><b>{batch.channelAccount.name}</b></p>
      <p><span>Ngày bàn giao:</span><b>{new Date(batch.createdAt).toLocaleString('vi-VN')}</b></p>
      <p><span>Nhân viên nhận đóng gói:</span><b>{batch.responsibleUser?.displayName}</b></p>
      <p><span>Số đơn:</span><b>{batch.orderCount}</b></p>
      <p><span>Tổng sản phẩm:</span><b>{batch.totalQuantity}</b></p>
    </section>
    <h2>Bảng tổng hợp sản phẩm</h2>
    <table>
      <thead><tr><th>STT</th><th>Sản phẩm</th><th>SKU / Phân loại</th><th>Số lượng</th></tr></thead>
      <tbody>{batch.totals.map((item, index) => <tr key={item.variantId}><td>{index + 1}</td><td>{item.name}</td><td>{item.sku}<small>{item.variantName}</small></td><td><b>{item.quantity}</b></td></tr>)}</tbody>
      <tfoot><tr><td colSpan={3}>Tổng số lượng</td><td><b>{batch.totalQuantity}</b></td></tr></tfoot>
    </table>
    <h2>Danh sách đơn thuộc lượt xuất</h2>
    <div className="orders-list">{batch.orders.map((order, index) => <div key={order.id}><span>{index + 1}</span><b>{order.orderNumber}</b><small>{order.externalOrderId ? `Mã sàn: ${order.externalOrderId}` : 'Đơn nội bộ'}</small><strong>{order.items.reduce((sum, item) => sum + item.quantity, 0)} SP</strong></div>)}</div>
    <p className="commitment">Hai bên đã kiểm đếm đủ số lượng trên phiếu. Nhân viên nhận chịu trách nhiệm bảo quản, phân chia đúng đơn và đóng gói kể từ thời điểm ký nhận; không cần xác nhận lại trên hệ thống.</p>
    <section className="signatures">
      <div><b>THỦ KHO GIAO</b><span>(Ký và ghi rõ họ tên)</span><i></i><strong>{batch.warehouseKeeper?.displayName}</strong></div>
      <div><b>NHÂN VIÊN NHẬN ĐÓNG GÓI</b><span>(Ký và ghi rõ họ tên)</span><i></i><strong>{batch.responsibleUser?.displayName}</strong></div>
    </section>
  </main>;
}
