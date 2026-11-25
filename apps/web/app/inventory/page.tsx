'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './inventory.css';

type Balance = { id: string; onHand: number; reserved: number; quarantined: number; safetyStock: number; reorderPoint: number; warehouse: { name: string } };
type Variant = { id: string; sku: string; name: string; salePrice: string; balances: Balance[] };
type Product = { id: string; name: string; variants: Variant[] };
type InventoryRow = { product: string; variant: Variant; balance?: Balance };

export default function InventoryPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/catalog/products`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (response.status === 401) { localStorage.removeItem('erp_access_token'); router.replace('/login'); return []; }
        if (!response.ok) throw new Error('Không thể tải danh sách tồn kho');
        return response.json();
      })
      .then(setProducts)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Lỗi kết nối'))
      .finally(() => setLoading(false));
  }, [router]);

  const rows = useMemo<InventoryRow[]>(() => {
    const result: InventoryRow[] = [];
    for (const product of products) {
      for (const variant of product.variants) {
        if (variant.balances.length === 0) result.push({ product: product.name, variant });
        for (const balance of variant.balances) result.push({ product: product.name, variant, balance });
      }
    }
    return result.filter((row) => `${row.product} ${row.variant.sku} ${row.variant.name}`.toLowerCase().includes(search.toLowerCase()));
  }, [products, search]);

  const totals = rows.reduce((sum, row) => ({
    onHand: sum.onHand + (row.balance?.onHand ?? 0),
    available: sum.available + Math.max(0, (row.balance?.onHand ?? 0) - (row.balance?.reserved ?? 0) - (row.balance?.quarantined ?? 0) - (row.balance?.safetyStock ?? 0)),
    low: sum.low + (((row.balance?.onHand ?? 0) - (row.balance?.reserved ?? 0) - (row.balance?.quarantined ?? 0) - (row.balance?.safetyStock ?? 0)) <= (row.balance?.reorderPoint ?? 0) ? 1 : 0),
  }), { onHand: 0, available: 0, low: 0 });

  return <main className="inventory-page">
    <header className="inventory-header"><div><p>VẬN HÀNH KHO</p><h1>Tồn kho tập trung</h1><span>Theo dõi tồn thực tế, giữ chỗ và điểm đặt hàng lại theo từng SKU.</span></div><div><a href="/inventory/stocktakes">Kiểm kê thực tế</a><a href="/inventory/channel-reconciliation">Đối chiếu tồn sàn</a><a href="/">← Tổng quan</a></div></header>
    <section className="inventory-metrics"><article><span>Tồn thực tế</span><strong>{totals.onHand}</strong></article><article><span>Có thể bán</span><strong>{totals.available}</strong></article><article className="danger"><span>SKU sắp hết</span><strong>{totals.low}</strong></article><article><span>Tổng SKU</span><strong>{rows.length}</strong></article></section>
    <section className="inventory-panel"><div className="inventory-toolbar"><div><h2>Danh sách SKU</h2><span>Cập nhật từ kho và các kênh bán</span></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm sản phẩm hoặc SKU…" /></div>
      {loading ? <div className="inventory-state">Đang tải dữ liệu…</div> : error ? <div className="inventory-state error">{error}</div> : <div className="inventory-table-wrap"><table><thead><tr><th>Sản phẩm / SKU</th><th>Kho</th><th>Tồn thực tế</th><th>Đã giữ</th><th>Có thể bán</th><th>Điểm đặt lại</th><th>Trạng thái</th></tr></thead><tbody>{rows.map(({product,variant,balance}) => { const available=(balance?.onHand??0)-(balance?.reserved??0)-(balance?.quarantined??0)-(balance?.safetyStock??0); const low=available<=(balance?.reorderPoint??0); return <tr key={`${variant.id}-${balance?.id??'none'}`}><td><b>{product}</b><small>{variant.sku} · {variant.name}</small></td><td>{balance?.warehouse.name??'Chưa phân kho'}</td><td>{balance?.onHand??0}</td><td>{balance?.reserved??0}</td><td><strong>{available}</strong></td><td>{balance?.reorderPoint??0}</td><td><span className={low?'stock-status low':'stock-status good'}>{low?'Sắp hết':'Ổn định'}</span></td></tr>})}</tbody></table></div>}
    </section>
  </main>;
}
