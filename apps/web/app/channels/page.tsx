'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './channels.css';

type SyncRun = { id: string; status: string; direction: string; mappedSkuCount: number; processedCount: number; failedCount: number; startedAt: string };
type Connection = {
  applicable: boolean;
  status: 'INCOMPLETE' | 'READY' | 'ERROR' | 'NOT_REQUIRED';
  ready: boolean;
  missingFields: string[];
  environment: string;
  clientId: string;
  authorizationIdentifier: string;
  accountIdentifier: string;
  apiBaseUrl: string;
  hasClientSecret: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  lastTokenRefreshAt?: string;
  tokenRefreshStatus: string;
  tokenState: 'NOT_APPLICABLE' | 'MISSING' | 'UNKNOWN' | 'VALID' | 'EXPIRING' | 'EXPIRED' | 'REAUTH_REQUIRED';
  grantedScopes: string[];
  hasWebhookSecret: boolean;
  orderSyncEnabled: boolean;
  inventorySyncEnabled: boolean;
  chatSyncEnabled: boolean;
  defaultWarehouseId: string;
  orderSyncCursorAt?: string;
  lastOrderSyncAt?: string;
  orderSyncStatus: string;
  orderSyncError?: string;
  lastCheckedAt?: string;
  lastError?: string;
  webhookUrl?: string;
  oauthCallbackUrl?: string;
};
type WarehouseOption = { id: string; code: string; name: string; branch: { name: string } };
type Channel = { id: string; code: string; name: string; type: string; active: boolean; mappedSkuCount: number; availableUnits: number; orderCount: number; conversationCount: number; recentSyncs: SyncRun[]; warehouseOptions: WarehouseOption[]; connection: Connection };
type CurrentUser = { permissions: string[] };

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const labels: Record<string, string> = { TIKTOK_SHOP: 'TikTok Shop', SHOPEE: 'Shopee', FACEBOOK_MESSENGER: 'Facebook Messenger', OFFLINE_STORE: 'Cửa hàng POS', WEBSITE: 'Website', WHOLESALE: 'Bán sỉ' };
const tokenLabels: Record<string, string> = { VALID: 'Token hợp lệ', EXPIRING: 'Sắp hết hạn', EXPIRED: 'Đã hết hạn', REAUTH_REQUIRED: 'Cần cấp quyền lại', UNKNOWN: 'Chưa có hạn token', MISSING: 'Thiếu token', NOT_APPLICABLE: 'Không áp dụng' };
const marketplace = (type: string) => ['TIKTOK_SHOP', 'SHOPEE'].includes(type);
const datetimeLocal = (value?: string) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';

export default function ChannelsPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState('');
  const [saving, setSaving] = useState(false);
  const [configuring, setConfiguring] = useState<Channel | null>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const [channelsResponse, userResponse] = await Promise.all([fetch(`${api}/channels`, { headers }), fetch(`${api}/auth/me`, { headers })]);
    if (channelsResponse.status === 401 || userResponse.status === 401) { localStorage.removeItem('erp_access_token'); router.replace('/login'); return; }
    if (channelsResponse.status === 403) throw new Error('Tài khoản chưa được cấp quyền quản lý kênh bán');
    if (!channelsResponse.ok || !userResponse.ok) throw new Error('Không thể tải trạng thái kênh bán');
    setChannels(await channelsResponse.json());
    setPermissions(((await userResponse.json()) as CurrentUser).permissions);
  }, [router]);

  useEffect(() => { load().catch((reason) => setError(reason.message)); }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'success') setNotice('Seller đã cấp quyền thành công; token và Shop ID đã được lưu mã hóa.');
    if (params.get('oauth') === 'error') setError(params.get('message') || 'Không thể hoàn tất cấp quyền seller.');
    if (params.has('oauth')) window.history.replaceState({}, '', window.location.pathname);
  }, []);
  const canManage = permissions.includes('*') || permissions.includes('channels.manage');
  const canSync = permissions.includes('*') || permissions.includes('channels.sync');

  async function sync(channel: Channel) {
    setSyncing(channel.id); setError(''); setNotice('');
    try {
      const response = await fetch(`${api}/channels/${channel.id}/sync-inventory`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` } });
      if (!response.ok) throw new Error('Không thể tạo lượt đồng bộ');
      setNotice(`Đã tạo snapshot tồn kho cho ${channel.name}.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Lỗi đồng bộ'); }
    finally { setSyncing(''); }
  }

  async function syncOrders(channel: Channel) {
    setSyncing(`orders:${channel.id}`); setError(''); setNotice('');
    try {
      const response = await fetch(`${api}/channels/${channel.id}/sync-orders`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message[0] : payload.message ?? 'Không thể kéo đơn từ sàn');
      setNotice(`Đã đọc ${payload.fetched} đơn của ${channel.name}; nhập ${payload.imported}, trùng ${payload.duplicates}, lỗi ${payload.failures.length}.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Lỗi đồng bộ đơn'); }
    finally { setSyncing(''); }
  }

  async function saveConnection(event: FormEvent<HTMLFormElement>, channel: Channel) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      environment: form.get('environment'),
      clientId: form.get('clientId'),
      authorizationIdentifier: form.get('authorizationIdentifier'),
      accountIdentifier: form.get('accountIdentifier'),
      apiBaseUrl: form.get('apiBaseUrl'),
      orderSyncEnabled: form.get('orderSyncEnabled') === 'on',
      inventorySyncEnabled: form.get('inventorySyncEnabled') === 'on',
      chatSyncEnabled: form.get('chatSyncEnabled') === 'on',
      defaultWarehouseId: form.get('defaultWarehouseId'),
    };
    for (const secret of ['clientSecret', 'accessToken', 'refreshToken', 'webhookSecret']) {
      const value = String(form.get(secret) ?? '').trim();
      if (value) body[secret] = value;
    }
    for (const dateField of ['accessTokenExpiresAt', 'refreshTokenExpiresAt']) {
      const value = String(form.get(dateField) ?? '').trim();
      if (value) body[dateField] = new Date(value).toISOString();
    }
    const scopes = String(form.get('grantedScopes') ?? '').split(',').map((scope) => scope.trim()).filter(Boolean);
    if (marketplace(channel.type)) body.grantedScopes = scopes;
    try {
      const response = await fetch(`${api}/channels/${channel.id}/connection`, { method: 'PUT', headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message[0] : payload.message ?? 'Không thể lưu cấu hình');
      setNotice(payload.ready ? `${channel.name} đã đủ cấu hình kỹ thuật.` : `${channel.name} còn thiếu: ${payload.missingFields.join(', ')}.`);
      setConfiguring(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu cấu hình'); }
    finally { setSaving(false); }
  }

  async function checkConnection(channel: Channel) {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${api}/channels/${channel.id}/connection/check`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Không thể kiểm tra cấu hình');
      setNotice(payload.note ?? (payload.ready ? 'Cấu hình đã sẵn sàng.' : `Còn thiếu: ${payload.missingFields.join(', ')}`));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể kiểm tra cấu hình'); }
    finally { setSaving(false); }
  }

  async function refreshToken(channel: Channel) {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${api}/channels/${channel.id}/connection/refresh-token`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Không thể làm mới token');
      if (payload.tokenRefreshStatus !== 'SUCCEEDED') throw new Error(payload.lastError ?? 'Nền tảng từ chối làm mới token');
      setNotice(`Đã làm mới token cho ${channel.name}.`);
      setConfiguring(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể làm mới token'); }
    finally { setSaving(false); }
  }

  async function startOAuth(channel: Channel) {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${api}/channels/${channel.id}/oauth/start`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Không thể khởi tạo OAuth');
      window.location.assign(payload.authorizationUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể khởi tạo OAuth'); setSaving(false); }
  }

  const metrics = useMemo(() => ({
    active: channels.filter((item) => item.active).length,
    ready: channels.filter((item) => item.connection.applicable && item.connection.ready).length,
    mapped: channels.reduce((sum, item) => sum + item.mappedSkuCount, 0),
    issues: channels.filter((item) => item.connection.applicable && !item.connection.ready).length,
  }), [channels]);

  return <main className="channels-page">
    <header className="channels-header"><div><p>OMNICHANNEL CONTROL</p><h1>Trung tâm kết nối kênh bán</h1><span>Quản lý cấu hình seller, ánh xạ SKU, webhook và trạng thái đồng bộ trên từng tài khoản.</span></div><nav><a href="/integrations">Nhật ký tích hợp</a><a href="/products">Sản phẩm</a><a href="/">← Tổng quan</a></nav></header>
    <section className="channel-metrics"><article><span>Kênh hoạt động</span><strong>{metrics.active}</strong></article><article><span>Kết nối sẵn sàng</span><strong>{metrics.ready}</strong></article><article><span>Ánh xạ SKU</span><strong>{metrics.mapped}</strong></article><article className={metrics.issues ? 'danger' : ''}><span>Thiếu cấu hình</span><strong>{metrics.issues}</strong></article></section>
    <div className="sync-note"><b>Token seller được giám sát tự động</b><span>Khóa truy cập được mã hóa; hệ thống làm mới token trước hạn 15 phút và khóa đồng bộ nếu token hết hạn hoặc bị thu hồi.</span></div>
    {error && <div className="channel-error">{error}</div>}{notice && <div className="channel-notice">{notice}</div>}
    <section className="channel-grid">{channels.map((channel) => <article className="channel-card" key={channel.id}>
      <div className="channel-title"><i className={channel.type.toLowerCase()}>{channel.type === 'TIKTOK_SHOP' ? 'TT' : channel.type === 'FACEBOOK_MESSENGER' ? 'FB' : channel.type === 'OFFLINE_STORE' ? 'POS' : 'S'}</i><div><h2>{channel.name}</h2><span>{labels[channel.type] ?? channel.type} · {channel.code}</span></div><em className={channel.active ? 'active' : 'inactive'}>{channel.active ? 'Hoạt động' : 'Tạm dừng'}</em></div>
      <div className={`connection-state ${channel.connection.ready ? 'ready' : channel.connection.applicable ? 'incomplete' : 'internal'}`}><div><b>{channel.connection.applicable ? channel.connection.ready ? 'Đủ cấu hình kỹ thuật' : 'Chưa đủ cấu hình' : 'Kênh nội bộ'}</b><span>{channel.connection.applicable ? channel.connection.missingFields.length ? `Thiếu: ${channel.connection.missingFields.join(', ')}` : marketplace(channel.type) ? `${tokenLabels[channel.connection.tokenState]} · ${channel.connection.accessTokenExpiresAt ? new Date(channel.connection.accessTokenExpiresAt).toLocaleString('vi-VN') : 'chưa rõ thời hạn'}` : `${channel.connection.environment} · Khóa đã mã hóa` : 'Không yêu cầu API ngoài'}</span></div>{channel.connection.applicable && <strong>{channel.connection.ready ? 'READY' : 'SETUP'}</strong>}</div>
      <div className="channel-data"><div><span>SKU đã ánh xạ</span><b>{channel.mappedSkuCount}</b></div><div><span>Tồn khả dụng</span><b>{channel.availableUnits}</b></div><div><span>Đơn hàng</span><b>{channel.orderCount}</b></div><div><span>Hội thoại</span><b>{channel.conversationCount}</b></div></div>
      <div className="capabilities"><span className={channel.connection.orderSyncEnabled ? 'on' : ''}>Đơn hàng</span><span className={channel.connection.inventorySyncEnabled ? 'on' : ''}>Tồn kho</span><span className={channel.connection.chatSyncEnabled ? 'on' : ''}>Tin nhắn</span></div>
      {marketplace(channel.type) && <div className="sync-history"><h3>Đơn hàng tự động · mỗi 5 phút</h3><div><span className={`sync-status ${channel.connection.orderSyncStatus === 'FAILED' ? 'failed' : 'succeeded'}`}>{channel.connection.orderSyncStatus === 'FAILED' ? 'Có lỗi' : channel.connection.orderSyncStatus === 'RUNNING' ? 'Đang chạy' : 'Sẵn sàng'}</span><b>{channel.connection.lastOrderSyncAt ? new Date(channel.connection.lastOrderSyncAt).toLocaleString('vi-VN') : 'Chưa chạy'}</b></div>{channel.connection.orderSyncError && <p>{channel.connection.orderSyncError}</p>}</div>}
      <div className="sync-history"><h3>Lần đồng bộ gần nhất</h3>{channel.recentSyncs[0] ? <div><span className={`sync-status ${channel.recentSyncs[0].status.toLowerCase()}`}>{channel.recentSyncs[0].status === 'SUCCEEDED' ? 'Thành công' : channel.recentSyncs[0].status}</span><b>{channel.recentSyncs[0].processedCount}/{channel.recentSyncs[0].mappedSkuCount} SKU</b><time>{new Date(channel.recentSyncs[0].startedAt).toLocaleString('vi-VN')}</time></div> : <p>Chưa có lịch sử đồng bộ</p>}</div>
      <div className="channel-buttons">{canManage && channel.connection.applicable && <button className="configure" onClick={() => setConfiguring(channel)}>Cấu hình kết nối</button>}{canSync && marketplace(channel.type) && <button disabled={syncing === `orders:${channel.id}` || !channel.active || channel.connection.tokenState !== 'VALID' || !channel.connection.defaultWarehouseId} onClick={() => syncOrders(channel)}>{syncing === `orders:${channel.id}` ? 'Đang kéo đơn...' : 'Kéo đơn từ sàn'}</button>}{canSync && <button disabled={syncing === channel.id || !channel.active || (marketplace(channel.type) && channel.connection.tokenState !== 'VALID')} onClick={() => sync(channel)}>{syncing === channel.id ? 'Đang tạo snapshot...' : 'Đồng bộ tồn kho'}</button>}</div>
    </article>)}</section>
    {configuring && <div className="connection-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setConfiguring(null); }}>
      <form className="connection-modal" onSubmit={(event) => saveConnection(event, configuring)}>
        <div className="connection-heading"><div><p>{labels[configuring.type] ?? configuring.type}</p><h2>{configuring.name}</h2><span>Khóa đang lưu sẽ được giữ nguyên nếu ô bí mật để trống.</span></div><button type="button" onClick={() => setConfiguring(null)}>×</button></div>
        {marketplace(configuring.type) && <div className={`token-state ${configuring.connection.tokenState.toLowerCase()}`}><b>{tokenLabels[configuring.connection.tokenState]}</b><span>{configuring.connection.lastTokenRefreshAt ? `Làm mới gần nhất ${new Date(configuring.connection.lastTokenRefreshAt).toLocaleString('vi-VN')}` : 'Chưa có lịch sử làm mới tự động'}</span></div>}
        <div className="connection-fields">
          <label>Môi trường<select name="environment" defaultValue={configuring.connection.environment}><option value="PRODUCTION">Production</option><option value="SANDBOX">Sandbox</option></select></label>
          <label>{configuring.type === 'SHOPEE' ? 'Partner ID' : 'App / Client ID'}<input name="clientId" defaultValue={configuring.connection.clientId} required /></label>
          <label>{configuring.type === 'SHOPEE' ? 'Shop ID' : configuring.type === 'FACEBOOK_MESSENGER' ? 'Page ID' : 'Shop Cipher / Cửa hàng ID'}<input name="accountIdentifier" defaultValue={configuring.connection.accountIdentifier} required={!marketplace(configuring.type)} placeholder={marketplace(configuring.type) ? 'OAuth sẽ tự điền' : ''} /></label>
          {configuring.type === 'TIKTOK_SHOP' && <label className="scope-field">TikTok Service ID hoặc Authorization URL<input name="authorizationIdentifier" defaultValue={configuring.connection.authorizationIdentifier} placeholder="https://services.tiktokshop.com/open/authorize?service_id=..." required /></label>}
          <label>API Base URL (tùy chọn)<input name="apiBaseUrl" defaultValue={configuring.connection.apiBaseUrl} /></label>
          <label>{configuring.type === 'SHOPEE' ? 'Partner Key' : 'Client Secret'}<input name="clientSecret" type="password" placeholder={configuring.connection.hasClientSecret ? 'Đã lưu ••••••••' : 'Nhập khóa bí mật'} /></label>
          <label>{configuring.type === 'FACEBOOK_MESSENGER' ? 'Page Access Token' : 'Access Token'}<input name="accessToken" type="password" placeholder={configuring.connection.hasAccessToken ? 'Đã lưu ••••••••' : 'Nhập access token'} /></label>
          <label>Refresh Token {marketplace(configuring.type) ? '' : '(tùy chọn)'}<input name="refreshToken" type="password" placeholder={configuring.connection.hasRefreshToken ? 'Đã lưu ••••••••' : 'Nhập refresh token'} /></label>
          <label>Webhook Secret {configuring.type !== 'FACEBOOK_MESSENGER' && '(tùy chọn)'}<input name="webhookSecret" type="password" placeholder={configuring.connection.hasWebhookSecret ? 'Đã lưu ••••••••' : 'Nhập webhook secret'} /></label>
          {marketplace(configuring.type) && <>
            <label>Kho nhận đơn mặc định<select name="defaultWarehouseId" defaultValue={configuring.connection.defaultWarehouseId} required><option value="">Chọn kho</option>{configuring.warehouseOptions.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name} · {warehouse.branch.name}</option>)}</select></label>
            <label>Access Token hết hạn lúc<input name="accessTokenExpiresAt" type="datetime-local" defaultValue={datetimeLocal(configuring.connection.accessTokenExpiresAt)} /></label>
            <label>Refresh Token hết hạn lúc (nếu biết)<input name="refreshTokenExpiresAt" type="datetime-local" defaultValue={datetimeLocal(configuring.connection.refreshTokenExpiresAt)} /></label>
            <label className="scope-field">Quyền đã cấp, cách nhau bằng dấu phẩy<input name="grantedScopes" defaultValue={configuring.connection.grantedScopes.join(', ')} placeholder="order, product, inventory" /></label>
          </>}
        </div>
        <label className="webhook-url">Webhook URL dự kiến (dùng khi bật connector)<input value={configuring.connection.webhookUrl ?? ''} readOnly /></label>
        {marketplace(configuring.type) && <label className="webhook-url">OAuth Callback URL đăng ký trên nền tảng<input value={configuring.connection.oauthCallbackUrl ?? ''} readOnly /></label>}
        <div className="sync-options"><label><input type="checkbox" name="orderSyncEnabled" defaultChecked={configuring.connection.orderSyncEnabled || marketplace(configuring.type)} /> Đồng bộ đơn hàng</label><label><input type="checkbox" name="inventorySyncEnabled" defaultChecked={configuring.connection.inventorySyncEnabled || marketplace(configuring.type)} /> Đồng bộ tồn kho</label><label><input type="checkbox" name="chatSyncEnabled" defaultChecked={configuring.connection.chatSyncEnabled || configuring.type === 'FACEBOOK_MESSENGER'} /> Đồng bộ tin nhắn</label></div>
        <div className="modal-actions">{marketplace(configuring.type) && configuring.connection.hasClientSecret && <button type="button" className="refresh" disabled={saving} onClick={() => startOAuth(configuring)}>Kết nối OAuth</button>}{marketplace(configuring.type) && configuring.connection.hasRefreshToken && <button type="button" className="refresh" disabled={saving} onClick={() => refreshToken(configuring)}>Làm mới token</button>}<button type="button" className="check" disabled={saving} onClick={() => checkConnection(configuring)}>Kiểm tra độ đầy đủ</button><button disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu cấu hình mã hóa'}</button></div>
      </form>
    </div>}
  </main>;
}
