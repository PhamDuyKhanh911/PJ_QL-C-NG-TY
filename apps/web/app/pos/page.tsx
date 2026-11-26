'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './pos.css';

type Warehouse = { id: string; name: string; branch?: { name: string } };
type Balance = { warehouseId: string; onHand: number; reserved: number; quarantined: number; safetyStock: number; warehouse: { name: string } };
type Variant = { id: string; sku: string; name: string; salePrice: string; balances: Balance[] };
type Product = { name: string; variants: Variant[] };
type Channel = { id: string; name: string; type: string };
type Handler = { id: string; displayName: string; email: string };
type CurrentUser = { permissions: string[] };
type ProductVariant = Variant & { productName: string; balance?: Balance; available: number };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export default function PosPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [channel, setChannel] = useState<Channel>();
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [responsibleUserId, setResponsible] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [stockDrafts, setStockDrafts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const [productsResponse, channelsResponse, handlersResponse, warehousesResponse, userResponse] = await Promise.all([
      fetch(`${apiUrl}/catalog/products`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/channels`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/fulfillment/handlers`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/inventory/warehouses`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/auth/me`, { headers, cache: 'no-store' }),
    ]);
    if ([productsResponse, channelsResponse, handlersResponse, warehousesResponse, userResponse].some((response) => response.status === 401)) {
      localStorage.removeItem('erp_access_token'); router.replace('/login'); return;
    }
    if (!productsResponse.ok || !channelsResponse.ok || !handlersResponse.ok || !userResponse.ok) {
      throw new Error('Không thể tải dữ liệu phiếu xuất. Tài khoản cần quyền xem sản phẩm và bán hàng.');
    }
    const [productRows, channelRows, staffRows, currentUser] = await Promise.all([
      productsResponse.json() as Promise<Product[]>, channelsResponse.json() as Promise<Channel[]>, handlersResponse.json() as Promise<Handler[]>, userResponse.json() as Promise<CurrentUser>,
    ]);
    const warehouseRows: Warehouse[] = warehousesResponse.ok
      ? await warehousesResponse.json()
      : [...new Map(productRows.flatMap((product) => product.variants.flatMap((variant) => variant.balances.map((balance) => [balance.warehouseId, { id: balance.warehouseId, name: balance.warehouse.name }] as const)))).values()];
    setProducts(productRows);
    setChannel(channelRows.find((item) => item.type === 'OFFLINE_STORE'));
    setHandlers(staffRows);
    setWarehouses(warehouseRows);
    setPermissions(currentUser.permissions);
    setResponsible((current) => current || staffRows[0]?.id || '');
    setWarehouseId((current) => current && warehouseRows.some((warehouse) => warehouse.id === current) ? current : warehouseRows[0]?.id || '');
  }, [router]);

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Không thể tải phiếu xuất')); }, [load]);

  const variants = useMemo<ProductVariant[]>(() => products.flatMap((product) => product.variants.map((variant) => {
    const balance = variant.balances.find((item) => item.warehouseId === warehouseId);
    return { ...variant, productName: product.name, balance, available: balance ? Math.max(0, balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock) : 0 };
  })).filter((variant) => `${variant.productName} ${variant.sku} ${variant.name}`.toLowerCase().includes(search.trim().toLowerCase())), [products, search, warehouseId]);

  const selected = variants.filter((variant) => (quantities[variant.id] ?? 0) > 0 && variant.available > 0);
  const total = selected.reduce((sum, variant) => sum + Number(variant.salePrice) * quantities[variant.id], 0);
  const canAdjust = permissions.includes('*') || permissions.includes('inventory.adjust');

  async function initializeStock(variant: ProductVariant) {
    const quantity = Math.floor(stockDrafts[variant.id] ?? 0);
    if (!warehouseId) { setError('Cần chọn kho trước khi nhập tồn'); return; }
    if (quantity < 1) { setError('Số lượng nhập tồn phải lớn hơn 0'); return; }
    setBusy(`stock-${variant.id}`); setError(''); setNotice('');
    try {
      const response = await fetch(`${apiUrl}/inventory/adjustments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId, variantId: variant.id, quantity, reason: 'Nhập tồn đầu kỳ trước khi lập phiếu xuất' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message.join(', ') : payload.message ?? 'Không thể nhập tồn');
      setStockDrafts((current) => ({ ...current, [variant.id]: 0 }));
      setNotice(`Đã nhập ${quantity} sản phẩm ${variant.sku} vào kho. Có thể chọn số lượng xuất.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể nhập tồn'); }
    finally { setBusy(''); }
  }

  async function submit() {
    if (!channel) { setError('Chưa có kênh bán Offline đang hoạt động'); return; }
    if (!warehouseId) { setError('Cần chọn kho xuất hàng'); return; }
    if (!selected.length) { setError('Cần nhập số lượng xuất cho ít nhất một sản phẩm đang có tồn'); return; }
    if (!responsibleUserId) { setError('Cần chọn nhân viên nhận hàng để đóng gói'); return; }
    setBusy('submit'); setError(''); setNotice('');
    try {
      const response = await fetch(`${apiUrl}/sales/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelAccountId: channel.id, warehouseId, responsibleUserId, discount: 0, items: selected.map((variant) => ({ variantId: variant.id, quantity: quantities[variant.id] })) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Không thể tạo phiếu');
      router.push('/fulfillment');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tạo phiếu'); }
    finally { setBusy(''); }
  }

  return <main className="pos-page">
    <header><div><p>XUẤT NỘI BỘ</p><h1>Phiếu giao hàng cho nhân viên đóng gói</h1><span>Chọn kho, nhiều SKU và một nhân viên chịu trách nhiệm đơn hàng.</span></div><a href="/">← Tổng quan</a></header>
    {error && <div className="pos-error">{error}</div>}{notice && <div className="pos-notice">{notice}</div>}
    <div className="pos-layout">
      <section className="pos-panel"><h2>1. Kho xuất & nhân viên nhận hàng</h2><div className="form"><label>Kho xuất hàng *<select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setQuantities({}); }}><option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.branch?.name ? ` · ${warehouse.branch.name}` : ''}</option>)}</select></label><label>Nhân viên chịu trách nhiệm *<select value={responsibleUserId} onChange={(event) => setResponsible(event.target.value)}><option value="">Chọn nhân viên</option>{handlers.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>)}</select></label></div></section>
      <section className="pos-panel"><div className="pos-products-title"><div><h2>2. Sản phẩm trên phiếu</h2><span>{variants.length} SKU · SKU hết tồn vẫn hiển thị để có thể nhập tồn đầu kỳ</span></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm sản phẩm hoặc SKU" /></div>
        <div className="sku-list">{variants.map((variant) => <article className={variant.available <= 0 ? 'out-of-stock' : ''} key={variant.id}><div><b>{variant.productName}</b><small>{variant.sku} · {variant.name}</small><small>{variant.balance ? `Tồn thực tế ${variant.balance.onHand} · Có thể xuất ${variant.available}` : 'Chưa có tồn tại kho đã chọn'}</small></div><span>{Number(variant.salePrice).toLocaleString('vi-VN')}đ</span>{variant.available > 0 ? <label className="dispatch-quantity">SL xuất<input aria-label={`Số lượng xuất ${variant.sku}`} type="number" min="0" max={variant.available} value={quantities[variant.id] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [variant.id]: Math.min(variant.available, Math.max(0, Number(event.target.value))) }))} /></label> : canAdjust ? <div className="initial-stock"><input aria-label={`Tồn đầu kỳ ${variant.sku}`} type="number" min="1" placeholder="Tồn đầu kỳ" value={stockDrafts[variant.id] || ''} onChange={(event) => setStockDrafts((current) => ({ ...current, [variant.id]: Math.max(0, Number(event.target.value)) }))} /><button disabled={Boolean(busy)} onClick={() => initializeStock(variant)}>{busy === `stock-${variant.id}` ? 'Đang nhập…' : 'Nhập tồn'}</button></div> : <em className="stock-required">Cần thủ kho nhập tồn</em>}</article>)}</div>
        {!variants.length && <div className="pos-empty">Chưa có SKU sản phẩm. Hãy tạo sản phẩm và SKU tại mục Sản phẩm.</div>}
      </section>
      <aside className="summary"><h2>Phiếu giao nội bộ</h2><div><span>Kho xuất</span><b>{warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ?? 'Chưa chọn'}</b></div><div><span>Người nhận</span><b>{handlers.find((user) => user.id === responsibleUserId)?.displayName ?? 'Chưa chọn'}</b></div>{selected.map((variant) => <div key={variant.id}><span>{variant.sku} × {quantities[variant.id]}</span><b>{(Number(variant.salePrice) * quantities[variant.id]).toLocaleString('vi-VN')}đ</b></div>)}<footer><span>Tổng giá trị</span><strong>{total.toLocaleString('vi-VN')}đ</strong></footer><button disabled={Boolean(busy)} onClick={submit}>{busy === 'submit' ? 'Đang tạo…' : 'Tạo phiếu chờ thủ kho xuất'}</button></aside>
    </div>
  </main>;
}
