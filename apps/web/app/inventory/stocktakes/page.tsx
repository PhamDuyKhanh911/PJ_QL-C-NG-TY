'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './stocktakes.css';

type Warehouse = { id: string; code: string; name: string; branch: { name: string }; _count: { balances: number } };
type Balance = { warehouseId: string; onHand: number };
type Product = { name: string; variants: Array<{ id: string; sku: string; name: string; balances: Balance[] }> };
type SelectableVariant = { id: string; sku: string; name: string; productName: string; onHand: number };
type Session = { id: string; code: string; status: 'DRAFT' | 'COMPLETED' | 'CANCELLED'; note: string | null; createdAt: string; completedAt: string | null; warehouse: Warehouse; createdBy: { displayName: string } | null; completedBy: { displayName: string } | null; summary: { total: number; counted: number; different: number; netDifference: number } };
type Item = { id: string; expectedQuantity: number; countedQuantity: number | null; note: string | null; dirty?: boolean; variant: { sku: string; name: string; product: { name: string } } };
type Detail = Omit<Session, 'summary'> & { items: Item[] };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const statusLabel = { DRAFT: 'Đang kiểm kê', COMPLETED: 'Đã chốt', CANCELLED: 'Đã hủy' };

export default function StocktakesPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  function token() { return localStorage.getItem('erp_access_token') ?? ''; }
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${apiUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(init?.headers ?? {}) } });
    if (response.status === 401) { router.replace('/login'); throw new Error('Phiên đăng nhập đã hết hạn'); }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message ?? 'Không thể xử lý yêu cầu');
    return payload;
  }

  async function load(selectId?: string) {
    const [warehouseRows, productRows, sessionRows] = await Promise.all([request('/inventory/warehouses'), request('/catalog/products'), request('/inventory/stocktakes')]);
    setWarehouses(warehouseRows); setProducts(productRows); setSessions(sessionRows);
    const target = selectId ?? detail?.id ?? sessionRows[0]?.id;
    if (target) setDetail(await request(`/inventory/stocktakes/${target}`)); else setDetail(null);
  }

  useEffect(() => { if (!token()) { router.replace('/login'); return; } load().catch((reason) => setError(reason.message)); }, [router]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('create'); setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const created = await request('/inventory/stocktakes', { method: 'POST', body: JSON.stringify({ warehouseId, variantIds: selectedVariantIds, note: data.get('note') }) });
      form.reset(); setWarehouseId(''); setSelectedVariantIds([]); setSearch(''); await load(created.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể mở phiên kiểm kê'); } finally { setBusy(''); }
  }

  function changeCount(itemId: string, value: string) {
    setDetail((current) => current ? { ...current, items: current.items.map((item) => item.id === itemId ? { ...item, countedQuantity: value === '' ? null : Number(value), dirty: true } : item) } : current);
  }

  async function saveItem(item: Item) {
    if (!detail || item.countedQuantity === null) return;
    setBusy(item.id); setError('');
    try {
      const saved = await request(`/inventory/stocktakes/${detail.id}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ countedQuantity: item.countedQuantity, note: item.note }) });
      setDetail((current) => current ? { ...current, items: current.items.map((row) => row.id === saved.id ? { ...saved, dirty: false } : row) } : current);
      setSessions((current) => current.map((session) => session.id === detail.id ? { ...session, summary: { ...session.summary, counted: detail.items.filter((row) => row.id === item.id ? true : row.countedQuantity !== null).length } } : session));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu số đếm'); } finally { setBusy(''); }
  }

  async function action(type: 'finalize' | 'cancel') {
    if (!detail) return;
    setBusy(type); setError('');
    try { await request(`/inventory/stocktakes/${detail.id}/${type}`, { method: 'POST' }); await load(detail.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể cập nhật phiên kiểm kê'); }
    finally { setBusy(''); }
  }

  const counted = detail?.items.filter((item) => item.countedQuantity !== null && !item.dirty).length ?? 0;
  const different = detail?.items.filter((item) => item.countedQuantity !== null && item.countedQuantity !== item.expectedQuantity).length ?? 0;
  const net = detail?.items.reduce((sum, item) => sum + (item.countedQuantity === null ? 0 : item.countedQuantity - item.expectedQuantity), 0) ?? 0;
  const warehouseVariants: SelectableVariant[] = products.flatMap((product) => product.variants.flatMap((variant) => {
    const balance = variant.balances.find((item) => item.warehouseId === warehouseId);
    return balance ? [{ id: variant.id, sku: variant.sku, name: variant.name, productName: product.name, onHand: balance.onHand }] : [];
  }));
  const selectedVariants = warehouseVariants.filter((variant) => selectedVariantIds.includes(variant.id));
  const searchTerm = search.trim().toLowerCase();
  const searchResults = searchTerm ? warehouseVariants.filter((variant) => !selectedVariantIds.includes(variant.id) && `${variant.sku} ${variant.name} ${variant.productName}`.toLowerCase().includes(searchTerm)).slice(0, 20) : [];

  function changeWarehouse(value: string) { setWarehouseId(value); setSelectedVariantIds([]); setSearch(''); }
  function addVariant(id: string) { setSelectedVariantIds((current) => current.includes(id) ? current : [...current, id]); setSearch(''); }
  function removeVariant(id: string) { setSelectedVariantIds((current) => current.filter((item) => item !== id)); }

  return <main className="stocktake-page">
    <header className="stocktake-header"><div><p>KIỂM SOÁT KHO</p><h1>Kiểm kê tồn thực tế</h1><span>Chỉ điều chỉnh sổ kho sau khi thủ kho nhập đủ số đếm và chốt phiên.</span></div><div><a href="/inventory/transactions">Sổ giao dịch</a><a href="/inventory">← Tồn kho</a></div></header>
    {error && <div className="stocktake-error">{error}</div>}
    <section className="stocktake-layout">
      <aside>
        <form className="create-stocktake" onSubmit={create}><h2>Mở phiên mới</h2><label>Kho kiểm kê<select value={warehouseId} onChange={(event) => changeWarehouse(event.target.value)} required><option value="" disabled>Chọn kho</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name} · {warehouse._count.balances} SKU</option>)}</select></label><div className="stocktake-picker"><label>Mã sản phẩm cần kiểm<input value={search} onChange={(event) => setSearch(event.target.value)} disabled={!warehouseId} placeholder={warehouseId ? 'Tìm tên hoặc SKU…' : 'Chọn kho trước'} /></label>{searchResults.length > 0 && <div className="stocktake-results">{searchResults.map((variant) => <button type="button" key={variant.id} onClick={() => addVariant(variant.id)}><span><b>{variant.productName}</b><small>{variant.sku} · {variant.name} · tồn {variant.onHand}</small></span><em>Thêm</em></button>)}</div>}{searchTerm && !searchResults.length && <p className="picker-empty">Không tìm thấy SKU phù hợp trong kho.</p>}<div className="stocktake-selected">{selectedVariants.map((variant) => <div key={variant.id}><span><b>{variant.sku}</b><small>{variant.productName} · {variant.name} · tồn {variant.onHand}</small></span><button type="button" onClick={() => removeVariant(variant.id)}>Bỏ</button></div>)}{warehouseId && !selectedVariants.length && <p>Chưa chọn mã sản phẩm nào.</p>}</div></div><label>Ghi chú<input name="note" placeholder="Ca kiểm kê, khu vực…" /></label><button disabled={busy === 'create' || !warehouseId || !selectedVariantIds.length}>{busy === 'create' ? 'Đang mở…' : `Mở phiên kiểm kê (${selectedVariantIds.length} SKU)`}</button></form>
        <div className="session-list"><h2>Lịch sử kiểm kê</h2>{sessions.map((session) => <button key={session.id} className={detail?.id === session.id ? 'selected' : ''} onClick={() => request(`/inventory/stocktakes/${session.id}`).then(setDetail).catch((reason) => setError(reason.message))}><div><b>{session.code}</b><span>{session.warehouse.name}</span></div><em className={session.status.toLowerCase()}>{statusLabel[session.status]}</em><small>{session.summary.counted}/{session.summary.total} SKU · lệch {session.summary.different}</small></button>)}</div>
      </aside>
      <section className="stocktake-detail">{detail ? <>
        <div className="detail-title"><div><p>{detail.warehouse.branch.name} · {detail.warehouse.name}</p><h2>{detail.code}</h2><span>Mở bởi {detail.createdBy?.displayName ?? 'Nhân viên'} lúc {new Date(detail.createdAt).toLocaleString('vi-VN')}</span></div><em className={detail.status.toLowerCase()}>{statusLabel[detail.status]}</em></div>
        <div className="stocktake-metrics"><article><span>Đã đếm</span><strong>{counted}/{detail.items.length}</strong></article><article><span>SKU chênh lệch</span><strong>{different}</strong></article><article className={net < 0 ? 'negative' : net > 0 ? 'positive' : ''}><span>Chênh lệch ròng</span><strong>{net > 0 ? '+' : ''}{net}</strong></article></div>
        <div className="stocktake-table"><table><thead><tr><th>Sản phẩm / SKU</th><th>Tồn hệ thống</th><th>Đếm thực tế</th><th>Chênh lệch</th><th></th></tr></thead><tbody>{detail.items.map((item) => { const difference = item.countedQuantity === null ? null : item.countedQuantity - item.expectedQuantity; return <tr key={item.id} className={difference ? 'different' : ''}><td><b>{item.variant.product.name}</b><small>{item.variant.sku} · {item.variant.name}</small></td><td>{item.expectedQuantity}</td><td>{detail.status === 'DRAFT' ? <input type="number" min="0" value={item.countedQuantity ?? ''} onChange={(event) => changeCount(item.id, event.target.value)} /> : item.countedQuantity}</td><td><strong className={difference && difference < 0 ? 'negative' : difference && difference > 0 ? 'positive' : ''}>{difference === null ? '—' : `${difference > 0 ? '+' : ''}${difference}`}</strong></td><td>{detail.status === 'DRAFT' && <button disabled={busy === item.id || item.countedQuantity === null} onClick={() => saveItem(item)}>{busy === item.id ? '…' : 'Lưu'}</button>}</td></tr>})}</tbody></table></div>
        {detail.status === 'DRAFT' && <footer><button className="cancel" disabled={Boolean(busy)} onClick={() => action('cancel')}>Hủy phiên</button><span>{counted < detail.items.length ? `Còn ${detail.items.length - counted} SKU chưa nhập` : 'Đã nhập đủ, có thể chốt sổ kho'}</span><button className="finalize" disabled={Boolean(busy) || counted < detail.items.length} onClick={() => action('finalize')}>{busy === 'finalize' ? 'Đang chốt…' : 'Chốt kiểm kê'}</button></footer>}
      </> : <div className="stocktake-empty">Chưa có phiên kiểm kê. Chọn kho để mở phiên đầu tiên.</div>}</section>
    </section>
  </main>;
}
