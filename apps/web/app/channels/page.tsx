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
  accountIdentifier: string;
  apiBaseUrl: string;
  hasClientSecret: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasWebhookSecret: boolean;
  orderSyncEnabled: boolean;
  inventorySyncEnabled: boolean;
  chatSyncEnabled: boolean;
  lastCheckedAt?: string;
  lastError?: string;
  webhookUrl?: string;
};
type Channel = { id: string; code: string; name: string; type: string; active: boolean; mappedSkuCount: number; availableUnits: number; orderCount: number; conversationCount: number; recentSyncs: SyncRun[]; connection: Connection };
type CurrentUser = { permissions: string[] };

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const labels: Record<string, string> = { TIKTOK_SHOP: 'TikTok Shop', SHOPEE: 'Shopee', FACEBOOK_MESSENGER: 'Facebook Messenger', OFFLINE_STORE: 'Cửa hàng POS', WEBSITE: 'Website', WHOLESALE: 'Bán sỉ' };

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

  async function saveConnection(event: FormEvent<HTMLFormElement>, channel: Channel) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      environment: form.get('environment'),
      clientId: form.get('clientId'),
      accountIdentifier: form.get('accountIdentifier'),
      apiBaseUrl: form.get('apiBaseUrl'),
      orderSyncEnabled: form.get('orderSyncEnabled') === 'on',
      inventorySyncEnabled: form.get('inventorySyncEnabled') === 'on',
      chatSyncEnabled: form.get('chatSyncEnabled') === 'on',
    };
    for (const secret of ['clientSecret', 'accessToken', 'refreshToken', 'webhookSecret']) {
      const value = String(form.get(secret) ?? '').trim();
      if (value) body[secret] = value;
    }
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

  const metrics = useMemo(() => ({
    active: channels.filter((item) => item.active).length,
    ready: channels.filter((item) => item.connection.applicable && item.connection.ready).length,
    mapped: channels.reduce((sum, item) => sum + item.mappedSkuCount, 0),
    issues: channels.filter((item) => item.connection.applicable && !item.connection.ready).length,
  }), [channels]);

  return <main className="channels-page">
    <header className="channels-header"><div><p>OMNICHANNEL CONTROL</p><h1>Trung tâm kết nối kênh bán</h1><span>Quản lý cấu hình seller, ánh xạ SKU, webhook và trạng thái đồng bộ trên từng tài khoản.</span></div><nav><a href="/integrations">Nhật ký tích hợp</a><a href="/products">Sản phẩm</a><a href="/">← Tổng quan</a></nav></header>
    <section className="channel-metrics"><article><span>Kênh hoạt động</span><strong>{metrics.active}</strong></article><article><span>Kết nối sẵn sàng</span><strong>{metrics.ready}</strong></article><article><span>Ánh xạ SKU</span><strong>{metrics.mapped}</strong></article><article className={metrics.issues ? 'danger' : ''}><span>Thiếu cấu hình</span><strong>{metrics.issues}</strong></article></section>
    <div className="sync-note"><b>Chế độ tích hợp an toàn</b><span>Khóa truy cập được mã hóa. Trạng thái “Sẵn sàng” xác nhận đã đủ cấu hình; chỉ xác thực trực tiếp với nền tảng khi connector chính thức được bật.</span></div>
    {error && <div className="channel-error">{error}</div>}{notice && <div className="channel-notice">{notice}</div>}
    <section className="channel-grid">{channels.map((channel) => <article className="channel-card" key={channel.id}>
      <div className="channel-title"><i className={channel.type.toLowerCase()}>{channel.type === 'TIKTOK_SHOP' ? 'TT' : channel.type === 'FACEBOOK_MESSENGER' ? 'FB' : channel.type === 'OFFLINE_STORE' ? 'POS' : 'S'}</i><div><h2>{channel.name}</h2><span>{labels[channel.type] ?? channel.type} · {channel.code}</span></div><em className={channel.active ? 'active' : 'inactive'}>{channel.active ? 'Hoạt động' : 'Tạm dừng'}</em></div>
      <div className={`connection-state ${channel.connection.ready ? 'ready' : channel.connection.applicable ? 'incomplete' : 'internal'}`}><div><b>{channel.connection.applicable ? channel.connection.ready ? 'Đủ cấu hình kỹ thuật' : 'Chưa đủ cấu hình' : 'Kênh nội bộ'}</b><span>{channel.connection.applicable ? channel.connection.missingFields.length ? `Thiếu: ${channel.connection.missingFields.join(', ')}` : `${channel.connection.environment} · Khóa đã mã hóa` : 'Không yêu cầu API ngoài'}</span></div>{channel.connection.applicable && <strong>{channel.connection.ready ? 'READY' : 'SETUP'}</strong>}</div>
      <div className="channel-data"><div><span>SKU đã ánh xạ</span><b>{channel.mappedSkuCount}</b></div><div><span>Tồn khả dụng</span><b>{channel.availableUnits}</b></div><div><span>Đơn hàng</span><b>{channel.orderCount}</b></div><div><span>Hội thoại</span><b>{channel.conversationCount}</b></div></div>
      <div className="capabilities"><span className={channel.connection.orderSyncEnabled ? 'on' : ''}>Đơn hàng</span><span className={channel.connection.inventorySyncEnabled ? 'on' : ''}>Tồn kho</span><span className={channel.connection.chatSyncEnabled ? 'on' : ''}>Tin nhắn</span></div>
      <div className="sync-history"><h3>Lần đồng bộ gần nhất</h3>{channel.recentSyncs[0] ? <div><span className={`sync-status ${channel.recentSyncs[0].status.toLowerCase()}`}>{channel.recentSyncs[0].status === 'SUCCEEDED' ? 'Thành công' : channel.recentSyncs[0].status}</span><b>{channel.recentSyncs[0].processedCount}/{channel.recentSyncs[0].mappedSkuCount} SKU</b><time>{new Date(channel.recentSyncs[0].startedAt).toLocaleString('vi-VN')}</time></div> : <p>Chưa có lịch sử đồng bộ</p>}</div>
      <div className="channel-buttons">{canManage && channel.connection.applicable && <button className="configure" onClick={() => setConfiguring(channel)}>Cấu hình kết nối</button>}{canSync && <button disabled={syncing === channel.id || !channel.active} onClick={() => sync(channel)}>{syncing === channel.id ? 'Đang tạo snapshot...' : 'Đồng bộ tồn kho'}</button>}</div>
    </article>)}</section>
    {configuring && <div className="connection-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setConfiguring(null); }}><form className="connection-modal" onSubmit={(event) => saveConnection(event, configuring)}><div className="connection-heading"><div><p>{labels[configuring.type] ?? configuring.type}</p><h2>{configuring.name}</h2><span>Khóa đang lưu sẽ được giữ nguyên nếu ô bí mật để trống.</span></div><button type="button" onClick={() => setConfiguring(null)}>×</button></div><div className="connection-fields"><label>Môi trường<select name="environment" defaultValue={configuring.connection.environment}><option value="PRODUCTION">Production</option><option value="SANDBOX">Sandbox</option></select></label><label>{configuring.type === 'SHOPEE' ? 'Partner ID' : 'App / Client ID'}<input name="clientId" defaultValue={configuring.connection.clientId} required /></label><label>{configuring.type === 'SHOPEE' ? 'Shop ID' : configuring.type === 'FACEBOOK_MESSENGER' ? 'Page ID' : 'Shop / Cửa hàng ID'}<input name="accountIdentifier" defaultValue={configuring.connection.accountIdentifier} required /></label><label>API Base URL (tùy chọn)<input name="apiBaseUrl" defaultValue={configuring.connection.apiBaseUrl} /></label><label>{configuring.type === 'SHOPEE' ? 'Partner Key' : 'Client Secret'}<input name="clientSecret" type="password" placeholder={configuring.connection.hasClientSecret ? 'Đã lưu ••••••••' : 'Nhập khóa bí mật'} /></label><label>{configuring.type === 'FACEBOOK_MESSENGER' ? 'Page Access Token' : 'Access Token'}<input name="accessToken" type="password" placeholder={configuring.connection.hasAccessToken ? 'Đã lưu ••••••••' : 'Nhập access token'} /></label><label>Refresh Token (tùy chọn)<input name="refreshToken" type="password" placeholder={configuring.connection.hasRefreshToken ? 'Đã lưu ••••••••' : 'Nhập refresh token'} /></label><label>Webhook Secret {configuring.type !== 'FACEBOOK_MESSENGER' && '(tùy chọn)'}<input name="webhookSecret" type="password" placeholder={configuring.connection.hasWebhookSecret ? 'Đã lưu ••••••••' : 'Nhập webhook secret'} /></label></div><label className="webhook-url">Webhook URL dự kiến (dùng khi bật connector)<input value={configuring.connection.webhookUrl ?? ''} readOnly /></label><div className="sync-options"><label><input type="checkbox" name="orderSyncEnabled" defaultChecked={configuring.connection.orderSyncEnabled || ['TIKTOK_SHOP', 'SHOPEE'].includes(configuring.type)} /> Đồng bộ đơn hàng</label><label><input type="checkbox" name="inventorySyncEnabled" defaultChecked={configuring.connection.inventorySyncEnabled || ['TIKTOK_SHOP', 'SHOPEE'].includes(configuring.type)} /> Đồng bộ tồn kho</label><label><input type="checkbox" name="chatSyncEnabled" defaultChecked={configuring.connection.chatSyncEnabled || configuring.type === 'FACEBOOK_MESSENGER'} /> Đồng bộ tin nhắn</label></div><div className="modal-actions"><button type="button" className="check" disabled={saving} onClick={() => checkConnection(configuring)}>Kiểm tra độ đầy đủ</button><button disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu cấu hình mã hóa'}</button></div></form></div>}
  </main>;
}
