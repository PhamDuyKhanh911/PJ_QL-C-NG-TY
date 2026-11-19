'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './products.css';
import './channel-mapping.css';

type Channel = { id: string; code: string; name: string; type: string };
type Mapping = { id: string; externalProductId: string; externalSkuId: string; externalSku?: string; channelAccount: Channel };
type Balance = { onHand: number; reserved: number; quarantined: number; safetyStock: number; warehouse: { name: string } };
type Variant = { id: string; sku: string; barcode?: string; name: string; costPrice: string; salePrice: string; balances: Balance[]; mappings: Mapping[] };
type Product = { id: string; name: string; active: boolean; variants: Variant[] };
type UnmappedChannelSku = { id: string; externalProductId?: string; externalSkuId: string; reportedAvailable: number; observedAt: string; source?: string; channelAccount: Channel };
type Dialog = { type: 'CREATE_PRODUCT' } | { type: 'ADD_VARIANT'; product: Product } | { type: 'EDIT_VARIANT'; variant: Variant } | { type: 'MAPPINGS'; variant: Variant } | { type: 'RESOLVE_EXTERNAL'; item: UnmappedChannelSku } | null;
type CurrentUser = { permissions: string[] };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const money = (value: string | number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value));

function variantPayload(form: FormData) {
  return {
    sku: String(form.get('sku') ?? ''),
    barcode: String(form.get('barcode') ?? ''),
    name: String(form.get('name') ?? ''),
    costPrice: Number(form.get('costPrice')),
    salePrice: Number(form.get('salePrice')),
  };
}

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [unmappedChannelSkus, setUnmappedChannelSkus] = useState<UnmappedChannelSku[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const [productsResponse, channelsResponse, userResponse, unmappedResponse] = await Promise.all([
      fetch(`${apiUrl}/catalog/products?includeInactive=true`, { headers }),
      fetch(`${apiUrl}/catalog/channels`, { headers }),
      fetch(`${apiUrl}/auth/me`, { headers }),
      fetch(`${apiUrl}/catalog/unmapped-channel-skus`, { headers }),
    ]);
    if ([productsResponse, channelsResponse, userResponse, unmappedResponse].some((response) => response.status === 401)) {
      localStorage.removeItem('erp_access_token');
      router.replace('/login');
      return;
    }
    if (!productsResponse.ok || !channelsResponse.ok || !userResponse.ok || !unmappedResponse.ok) throw new Error('Không thể tải danh mục sản phẩm');
    setProducts(await productsResponse.json());
    setChannels(await channelsResponse.json());
    setPermissions(((await userResponse.json()) as CurrentUser).permissions);
    setUnmappedChannelSkus(await unmappedResponse.json());
  }, [router]);

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Lỗi kết nối')).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (loading || dialog) return;
    const reconciliationId = new URLSearchParams(window.location.search).get('reconciliation');
    const item = unmappedChannelSkus.find((candidate) => candidate.id === reconciliationId);
    if (item) setDialog({ type: 'RESOLVE_EXTERNAL', item });
  }, [dialog, loading, unmappedChannelSkus]);

  const canCreate = permissions.includes('*') || permissions.includes('catalog.create');
  const canManage = permissions.includes('*') || permissions.includes('catalog.manage');
  const onlineChannels = channels.filter((channel) => channel.type !== 'OFFLINE_STORE');
  const visibleProducts = useMemo(() => products.filter((product) => {
    const matchesStatus = status === 'ALL' || (status === 'ACTIVE' ? product.active : !product.active);
    const haystack = `${product.name} ${product.variants.map((variant) => `${variant.sku} ${variant.name} ${variant.barcode ?? ''}`).join(' ')}`.toLowerCase();
    return matchesStatus && haystack.includes(search.toLowerCase());
  }), [products, search, status]);
  const allVariants = products.flatMap((product) => product.variants);
  const variantOptions = products.filter((product) => product.active).flatMap((product) => product.variants.map((variant) => ({ ...variant, productName: product.name })));
  const metrics = {
    activeProducts: products.filter((product) => product.active).length,
    variants: allVariants.length,
    mapped: allVariants.filter((variant) => variant.mappings.length > 0).length,
    unmapped: allVariants.filter((variant) => variant.mappings.length === 0).length,
    available: allVariants.reduce((total, variant) => total + variant.balances.reduce((sum, balance) => sum + Math.max(0, balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock), 0), 0),
    channelUnmapped: unmappedChannelSkus.length,
  };
  const resolutionChoices = dialog?.type === 'RESOLVE_EXTERNAL'
    ? variantOptions.filter((variant) => !variant.mappings.some((mapping) => mapping.channelAccount.id === dialog.item.channelAccount.id))
    : [];

  async function mutate(path: string, method: string, body: unknown) {
    setSaving(true); setError('');
    try {
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message[0] : payload.message ?? 'Không thể lưu thay đổi');
      setDialog(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể lưu thay đổi');
    } finally { setSaving(false); }
  }

  function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return mutate('/catalog/products', 'POST', { name: form.get('productName'), variants: [variantPayload(form)] });
  }

  function addVariant(event: FormEvent<HTMLFormElement>, productId: string) {
    event.preventDefault();
    return mutate(`/catalog/products/${productId}/variants`, 'POST', variantPayload(new FormData(event.currentTarget)));
  }

  function editVariant(event: FormEvent<HTMLFormElement>, variantId: string) {
    event.preventDefault();
    return mutate(`/catalog/variants/${variantId}`, 'PATCH', variantPayload(new FormData(event.currentTarget)));
  }

  function saveMappings(event: FormEvent<HTMLFormElement>, variant: Variant) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const mappings = onlineChannels.flatMap((channel) => {
      const externalSkuId = String(form.get(`sku-${channel.id}`) ?? '').trim();
      if (!externalSkuId) return [];
      return [{
        channelAccountId: channel.id,
        externalProductId: String(form.get(`product-${channel.id}`) ?? '').trim(),
        externalSkuId,
        externalSku: variant.sku,
      }];
    });
    return mutate(`/catalog/variants/${variant.id}/mappings`, 'PUT', { mappings });
  }

  function resolveExternalSku(event: FormEvent<HTMLFormElement>, item: UnmappedChannelSku) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    window.history.replaceState({}, '', window.location.pathname);
    return mutate('/catalog/channel-mappings/resolve', 'POST', {
      reconciliationId: item.id,
      variantId: form.get('variantId'),
      externalProductId: form.get('externalProductId'),
    });
  }

  function closeDialog() {
    if (dialog?.type === 'RESOLVE_EXTERNAL') window.history.replaceState({}, '', window.location.pathname);
    setDialog(null);
  }

  return (
    <main className="products-page">
      <header>
        <div><p>DỮ LIỆU NỀN TẢNG</p><h1>Danh mục sản phẩm & SKU</h1><span>Chuẩn hóa mã hàng, giá bán và liên kết SKU giữa kho với từng seller.</span></div>
        <nav><a href="/inventory">Tồn kho</a><a href="/channels">Kênh bán</a><a href="/">← Tổng quan</a></nav>
      </header>

      <section className="product-metrics">
        <article><span>Sản phẩm đang bán</span><strong>{metrics.activeProducts}</strong></article>
        <article><span>Tổng SKU</span><strong>{metrics.variants}</strong></article>
        <article><span>SKU đã liên kết seller</span><strong>{metrics.mapped}</strong></article>
        <article className={metrics.unmapped ? 'warning' : ''}><span>SKU chưa liên kết</span><strong>{metrics.unmapped}</strong></article>
        <article className={metrics.channelUnmapped ? 'warning' : ''}><span>SKU sàn chưa nhận diện</span><strong>{metrics.channelUnmapped}</strong></article>
        <article><span>Tồn có thể bán</span><strong>{metrics.available}</strong></article>
      </section>

      {unmappedChannelSkus.length > 0 && <section className="unmapped-channel-panel">
        <div className="unmapped-heading"><div><h2>SKU từ sàn đang chờ ghép</h2><span>Chọn đúng SKU nội bộ để đơn hàng và tồn kho được đồng bộ chính xác.</span></div><a href="/inventory/channel-reconciliation">Xem đối chiếu tồn</a></div>
        <div className="unmapped-list">{unmappedChannelSkus.slice(0, 10).map((item) => <article key={item.id}><div><b>{item.externalSkuId}</b><span>{item.channelAccount.name} · Tồn sàn {item.reportedAvailable}</span></div><small>{item.externalProductId ? `Mã sản phẩm: ${item.externalProductId}` : 'Thiếu mã sản phẩm trên sàn'}</small>{canManage && <button onClick={() => setDialog({ type: 'RESOLVE_EXTERNAL', item })}>Chọn SKU nội bộ</button>}</article>)}</div>
      </section>}

      <section className="products-panel">
        <div className="product-toolbar">
          <div><h2>Danh sách sản phẩm</h2><span>{visibleProducts.length} sản phẩm phù hợp</span></div>
          <div className="product-actions">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên, SKU hoặc mã vạch" />
            <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">Đang kinh doanh</option><option value="INACTIVE">Đã ngừng</option><option value="ALL">Tất cả</option></select>
            {canCreate && <button onClick={() => setDialog({ type: 'CREATE_PRODUCT' })}>+ Sản phẩm</button>}
          </div>
        </div>
        {error && <div className="product-error">{error}</div>}
        {loading ? <div className="product-state">Đang tải danh mục...</div> : (
          <div className="product-list">
            {visibleProducts.map((product) => (
              <article className={!product.active ? 'inactive' : ''} key={product.id}>
                <div className="product-title">
                  <div><h3>{product.name}</h3><span>{product.variants.length} SKU · {product.active ? 'Đang kinh doanh' : 'Đã ngừng kinh doanh'}</span></div>
                  {canManage && <div><button className="secondary" onClick={() => setDialog({ type: 'ADD_VARIANT', product })}>+ SKU</button><button className={product.active ? 'stop' : 'restore'} onClick={() => mutate(`/catalog/products/${product.id}`, 'PATCH', { active: !product.active })}>{product.active ? 'Ngừng bán' : 'Kinh doanh lại'}</button></div>}
                </div>
                <div className="variant-table-wrap"><table><thead><tr><th>SKU / Biến thể</th><th>Giá vốn</th><th>Giá bán</th><th>Biên gộp</th><th>Tồn khả dụng</th><th>Liên kết seller</th><th></th></tr></thead><tbody>
                  {product.variants.map((variant) => {
                    const available = variant.balances.reduce((sum, balance) => sum + Math.max(0, balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock), 0);
                    const margin = Number(variant.salePrice) ? (Number(variant.salePrice) - Number(variant.costPrice)) / Number(variant.salePrice) * 100 : 0;
                    return <tr key={variant.id}><td><b>{variant.sku}</b><small>{variant.name}{variant.barcode ? ` · ${variant.barcode}` : ''}</small></td><td>{money(variant.costPrice)}</td><td><b>{money(variant.salePrice)}</b></td><td className={margin < 20 ? 'low-margin' : ''}>{margin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</td><td><strong>{available}</strong><small>{variant.balances.length} kho</small></td><td><div className="mapping-tags">{variant.mappings.map((mapping) => <span key={mapping.id} title={mapping.externalSkuId}>{mapping.channelAccount.code}</span>)}{!variant.mappings.length && <em>Chưa liên kết</em>}</div></td><td>{canManage && <div className="row-actions"><button onClick={() => setDialog({ type: 'EDIT_VARIANT', variant })}>Sửa</button><button onClick={() => setDialog({ type: 'MAPPINGS', variant })}>Ánh xạ</button></div>}</td></tr>;
                  })}
                </tbody></table></div>
              </article>
            ))}
            {!visibleProducts.length && <div className="product-state">Không có sản phẩm phù hợp bộ lọc.</div>}
          </div>
        )}
      </section>

      {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeDialog(); }}>
        {dialog.type === 'CREATE_PRODUCT' && <form className="product-modal" onSubmit={createProduct}><div className="modal-title"><div><h2>Thêm sản phẩm</h2><span>Tạo sản phẩm cùng SKU đầu tiên</span></div><button type="button" onClick={() => setDialog(null)}>×</button></div><label>Tên sản phẩm<input name="productName" minLength={2} required autoFocus /></label><VariantFields /><button className="save" disabled={saving}>{saving ? 'Đang lưu...' : 'Tạo sản phẩm'}</button></form>}
        {dialog.type === 'ADD_VARIANT' && <form className="product-modal" onSubmit={(event) => addVariant(event, dialog.product.id)}><div className="modal-title"><div><h2>Thêm SKU</h2><span>{dialog.product.name}</span></div><button type="button" onClick={() => setDialog(null)}>×</button></div><VariantFields /><button className="save" disabled={saving}>{saving ? 'Đang lưu...' : 'Thêm SKU'}</button></form>}
        {dialog.type === 'EDIT_VARIANT' && <form className="product-modal" onSubmit={(event) => editVariant(event, dialog.variant.id)}><div className="modal-title"><div><h2>Cập nhật SKU</h2><span>{dialog.variant.sku}</span></div><button type="button" onClick={() => setDialog(null)}>×</button></div><VariantFields variant={dialog.variant} /><button className="save" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</button></form>}
        {dialog.type === 'MAPPINGS' && <form className="product-modal mapping-modal" onSubmit={(event) => saveMappings(event, dialog.variant)}><div className="modal-title"><div><h2>Ánh xạ seller</h2><span>{dialog.variant.sku} · Để trống SKU ID nếu muốn gỡ liên kết</span></div><button type="button" onClick={() => setDialog(null)}>×</button></div><div className="mapping-form">{onlineChannels.map((channel) => { const current = dialog.variant.mappings.find((mapping) => mapping.channelAccount.id === channel.id); return <fieldset key={channel.id}><legend>{channel.name}<small>{channel.type.replaceAll('_', ' ')}</small></legend><label>Mã sản phẩm trên kênh<input name={`product-${channel.id}`} defaultValue={current?.externalProductId} /></label><label>SKU ID trên kênh<input name={`sku-${channel.id}`} defaultValue={current?.externalSkuId} /></label></fieldset>; })}</div><button className="save" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu toàn bộ ánh xạ'}</button></form>}
        {dialog.type === 'RESOLVE_EXTERNAL' && <form className="product-modal resolve-mapping-modal" onSubmit={(event) => resolveExternalSku(event, dialog.item)}><div className="modal-title"><div><h2>Ghép SKU từ sàn</h2><span>{dialog.item.channelAccount.name} · SKU {dialog.item.externalSkuId}</span></div><button type="button" onClick={closeDialog}>×</button></div><div className="external-sku-summary"><div><span>Tồn đang báo trên sàn</span><strong>{dialog.item.reportedAvailable}</strong></div><div><span>Nguồn thay đổi</span><strong>{dialog.item.source ?? 'Không xác định'}</strong></div></div><label>Mã sản phẩm trên sàn<input name="externalProductId" defaultValue={dialog.item.externalProductId} required placeholder="Item ID / Product ID" /></label><label>Chọn SKU nội bộ<select name="variantId" required defaultValue=""><option value="" disabled>Chọn sản phẩm và biến thể</option>{resolutionChoices.map((variant) => <option key={variant.id} value={variant.id}>{variant.sku} · {variant.productName} · {variant.name}</option>)}</select></label>{resolutionChoices.length === 0 && <div className="no-mapping-choice">Seller này đã liên kết toàn bộ SKU nội bộ hiện có. Hãy đóng cửa sổ và tạo SKU nội bộ mới trước khi ghép.</div>}<p className="mapping-safety">Sau khi ghép, hệ thống sẽ tính lại chênh lệch và xếp lịch gửi tồn ERP lên đúng seller. Tồn thực tế trong kho không bị thay đổi.</p><button className="save" disabled={saving || resolutionChoices.length === 0}>{saving ? 'Đang ghép...' : 'Xác nhận ghép SKU'}</button></form>}
      </div>}
    </main>
  );
}

function VariantFields({ variant }: { variant?: Variant }) {
  return <div className="variant-fields"><label>SKU nội bộ<input name="sku" defaultValue={variant?.sku} minLength={2} required /></label><label>Tên biến thể<input name="name" defaultValue={variant?.name} required /></label><label>Mã vạch<input name="barcode" defaultValue={variant?.barcode} /></label><label>Giá vốn<input name="costPrice" type="number" min={0} step={1000} defaultValue={variant?.costPrice ?? 0} required /></label><label>Giá bán<input name="salePrice" type="number" min={0} step={1000} defaultValue={variant?.salePrice ?? 0} required /></label></div>;
}
