'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './inventory.css';
import './initial-stock.css';

type Warehouse = { id: string; name: string; branch?: { name: string } };
type Balance = { id: string; warehouseId: string; onHand: number; reserved: number; quarantined: number; safetyStock: number; reorderPoint: number; warehouse: { name: string } };
type Variant = { id: string; sku: string; name: string; salePrice: string; balances: Balance[] };
type Product = { id: string; name: string; variants: Variant[] };
type InventoryRow = { product: string; variant: Variant; balance?: Balance };
type CurrentUser = { permissions: string[] };
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export default function InventoryPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const [productsResponse, warehousesResponse, userResponse] = await Promise.all([
      fetch(`${apiUrl}/catalog/products`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/inventory/warehouses`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/auth/me`, { headers, cache: 'no-store' }),
    ]);
    if ([productsResponse, warehousesResponse, userResponse].some((response) => response.status === 401)) { localStorage.removeItem('erp_access_token'); router.replace('/login'); return; }
    if (!productsResponse.ok || !warehousesResponse.ok || !userResponse.ok) throw new Error('Không thể tải dữ liệu tồn kho');
    const [productRows, warehouseRows, currentUser] = await Promise.all([productsResponse.json() as Promise<Product[]>, warehousesResponse.json() as Promise<Warehouse[]>, userResponse.json() as Promise<CurrentUser>]);
    setProducts(productRows); setWarehouses(warehouseRows); setPermissions(currentUser.permissions);
    setWarehouseId((current) => current && warehouseRows.some((item) => item.id === current) ? current : warehouseRows[0]?.id ?? '');
  }, [router]);
  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Lỗi kết nối')).finally(() => setLoading(false)); }, [load]);

  const canInitialize = permissions.includes('*') || permissions.includes('inventory.initialize');
  const missingVariants = useMemo(() => products.flatMap((product) => product.variants.filter((variant) => !variant.balances.some((balance) => balance.warehouseId === warehouseId)).map((variant) => ({ ...variant, productName: product.name }))), [products, warehouseId]);
  const rows = useMemo<InventoryRow[]>(() => products.flatMap((product) => product.variants.flatMap((variant) => variant.balances.length ? variant.balances.map((balance) => ({ product: product.name, variant, balance })) : [{ product: product.name, variant }])).filter((row) => `${row.product} ${row.variant.sku} ${row.variant.name}`.toLowerCase().includes(search.toLowerCase())), [products, search]);
  const totals = rows.reduce((sum, row) => ({ onHand: sum.onHand + (row.balance?.onHand ?? 0), available: sum.available + Math.max(0, (row.balance?.onHand ?? 0) - (row.balance?.reserved ?? 0) - (row.balance?.quarantined ?? 0) - (row.balance?.safetyStock ?? 0)), low: sum.low + (((row.balance?.onHand ?? 0) - (row.balance?.reserved ?? 0) - (row.balance?.quarantined ?? 0) - (row.balance?.safetyStock ?? 0)) <= (row.balance?.reorderPoint ?? 0) ? 1 : 0) }), { onHand: 0, available: 0, low: 0 });

  async function submitInitialStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${apiUrl}/inventory/initial-stock`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ warehouseId, variantId: form.get('variantId'), quantity: Number(form.get('quantity')), note: form.get('note') }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message[0] : payload.message ?? 'Không thể nhập tồn đầu kỳ');
      setNotice('Đã ghi nhận tồn đầu kỳ và lưu người thao tác trong nhật ký hệ thống.'); event.currentTarget.reset(); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể nhập tồn đầu kỳ'); } finally { setSaving(false); }
  }

  return <main className="inventory-page">
    <header className="inventory-header"><div><p>VẬN HÀNH KHO</p><h1>Tồn kho tập trung</h1><span>Theo dõi tồn thực tế, giữ chỗ và điểm đặt hàng lại theo từng SKU.</span></div><div><a href="/inventory/stocktakes">Kiểm kê thực tế</a><a href="/inventory/transactions">Sổ giao dịch</a><a href="/">← Tổng quan</a></div></header>
    {error && <div className="inventory-message error">{error}</div>}{notice && <div className="inventory-message success">{notice}</div>}
    {canInitialize && <form className="initial-stock-panel" onSubmit={submitInitialStock}><div><h2>Nhập tồn đầu kỳ</h2><p>Chỉ áp dụng một lần cho SKU chưa có bản ghi tại kho. Tài khoản và thời gian thao tác được lưu tự động.</p></div><label>Kho<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} required><option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.branch?.name ? ` · ${warehouse.branch.name}` : ''}</option>)}</select></label><label>Sản phẩm / SKU<select name="variantId" required defaultValue=""><option value="" disabled>Chọn SKU chưa có tồn</option>{missingVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.sku} · {variant.productName} · {variant.name}</option>)}</select></label><label>Số lượng<input name="quantity" type="number" min="1" step="1" required /></label><label>Ghi chú<input name="note" maxLength={250} placeholder="Nguồn số liệu đầu kỳ" /></label><button disabled={saving || !missingVariants.length}>{saving ? 'Đang lưu…' : 'Ghi nhận tồn đầu kỳ'}</button>{!missingVariants.length && warehouseId && <small>Kho này không còn SKU nào chưa nhập tồn đầu kỳ.</small>}</form>}
    <section className="inventory-metrics"><article><span>Tồn thực tế</span><strong>{totals.onHand}</strong></article><article><span>Có thể bán</span><strong>{totals.available}</strong></article><article className="danger"><span>SKU sắp hết</span><strong>{totals.low}</strong></article><article><span>Tổng dòng kho</span><strong>{rows.length}</strong></article></section>
    <section className="inventory-panel"><div className="inventory-toolbar"><div><h2>Danh sách SKU</h2><span>Cập nhật từ kho và các kênh bán</span></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm sản phẩm hoặc SKU…" /></div>
      {loading ? <div className="inventory-state">Đang tải dữ liệu…</div> : <div className="inventory-table-wrap"><table><thead><tr><th>Sản phẩm / SKU</th><th>Kho</th><th>Tồn thực tế</th><th>Đã giữ</th><th>Có thể bán</th><th>Điểm đặt lại</th><th>Trạng thái</th></tr></thead><tbody>{rows.map(({ product, variant, balance }) => { const available = (balance?.onHand ?? 0) - (balance?.reserved ?? 0) - (balance?.quarantined ?? 0) - (balance?.safetyStock ?? 0); const low = available <= (balance?.reorderPoint ?? 0); return <tr key={`${variant.id}-${balance?.id ?? 'none'}`}><td><b>{product}</b><small>{variant.sku} · {variant.name}</small></td><td>{balance?.warehouse.name ?? 'Chưa nhập tồn đầu kỳ'}</td><td>{balance?.onHand ?? 0}</td><td>{balance?.reserved ?? 0}</td><td><strong>{available}</strong></td><td>{balance?.reorderPoint ?? 0}</td><td><span className={low ? 'stock-status low' : 'stock-status good'}>{balance ? (low ? 'Sắp hết' : 'Ổn định') : 'Chưa khởi tạo'}</span></td></tr>; })}</tbody></table></div>}
    </section>
  </main>;
}
