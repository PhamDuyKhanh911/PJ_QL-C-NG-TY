'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './integrations.css';

type EventStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'IGNORED';
type IntegrationEvent = {
  id: string;
  providerEventId: string;
  eventType: string;
  status: EventStatus;
  signatureVerified: boolean;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  errorMessage?: string;
  receivedAt: string;
  processedAt?: string;
  channelAccount: { id: string; code: string; name: string; type: string };
};
type ResponseData = {
  events: IntegrationEvent[];
  summary: Record<EventStatus, number>;
  total: number;
};
type Channel = { id: string; name: string; code: string; type: string };

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const statusLabels: Record<EventStatus, string> = {
  PENDING: 'Chờ xử lý',
  PROCESSING: 'Đang xử lý',
  PROCESSED: 'Đã xử lý',
  FAILED: 'Lỗi',
  IGNORED: 'Đã bỏ qua',
};

export default function IntegrationsPage() {
  const router = useRouter();
  const [data, setData] = useState<ResponseData | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [status, setStatus] = useState('ALL');
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const params = new URLSearchParams({ status, limit: '50' });
    if (channelId) params.set('channelAccountId', channelId);
    const [eventsResponse, channelsResponse, meResponse] = await Promise.all([
      fetch(`${api}/channels/integration-events?${params}`, { headers, cache: 'no-store' }),
      fetch(`${api}/channels`, { headers, cache: 'no-store' }),
      fetch(`${api}/auth/me`, { headers, cache: 'no-store' }),
    ]);
    if ([eventsResponse, channelsResponse, meResponse].some((response) => response.status === 401)) {
      localStorage.removeItem('erp_access_token'); router.replace('/login'); return;
    }
    if (!eventsResponse.ok || !channelsResponse.ok || !meResponse.ok) throw new Error('Không thể tải nhật ký tích hợp');
    setData(await eventsResponse.json());
    setChannels(await channelsResponse.json());
    setPermissions((await meResponse.json()).permissions ?? []);
  }, [channelId, router, status]);

  useEffect(() => {
    load().catch((reason) => setError(reason.message));
    const timer = setInterval(() => load().catch(() => undefined), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const canManage = permissions.includes('*') || permissions.includes('channels.manage');
  const metrics = useMemo(() => [
    { label: 'Tổng sự kiện', value: data?.total ?? 0, tone: '' },
    { label: 'Chờ xử lý', value: (data?.summary.PENDING ?? 0) + (data?.summary.PROCESSING ?? 0), tone: 'waiting' },
    { label: 'Đã xử lý', value: data?.summary.PROCESSED ?? 0, tone: 'success' },
    { label: 'Cần xử lý lỗi', value: data?.summary.FAILED ?? 0, tone: 'danger' },
  ], [data]);

  async function action(path: string, actionId: string) {
    setBusy(actionId); setError(''); setNotice('');
    try {
      const response = await fetch(`${api}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Không thể thực hiện tác vụ');
      setNotice(path.endsWith('process-pending') ? `Đã chọn ${payload.selected} sự kiện; thành công ${payload.processed}, lỗi ${payload.failed}.` : `Đã chạy lại sự kiện, trạng thái mới: ${statusLabels[payload.status as EventStatus] ?? payload.status}.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể thực hiện tác vụ'); }
    finally { setBusy(''); }
  }

  return <main className="integrations-page">
    <header className="integrations-header"><div><p>INTEGRATION OPERATIONS</p><h1>Nhật ký webhook và đồng bộ</h1><span>Theo dõi sự kiện theo từng seller, chống nhận trùng và chạy lại khi có lỗi.</span></div><nav><a href="/channels">Kênh bán</a><a href="/">← Tổng quan</a></nav></header>
    <section className="integration-metrics">{metrics.map((item) => <article className={item.tone} key={item.label}><span>{item.label}</span><strong>{item.value.toLocaleString('vi-VN')}</strong></article>)}</section>
    <section className="integration-note"><b>Worker tự động mỗi 5 giây</b><span>Facebook nhận trực tiếp payload Meta, xác thực chữ ký SHA-256 và tách từng tin nhắn trong một lượt webhook. Cùng một mã sự kiện trên cùng seller chỉ được ghi nhận một lần.</span></section>
    <section className="integration-toolbar"><label>Seller<select value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">Tất cả seller</option>{channels.filter((channel) => channel.type !== 'OFFLINE_STORE').map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channel.code}</option>)}</select></label><label>Trạng thái<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Tất cả</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{canManage && <button disabled={busy === 'pending'} onClick={() => action('/channels/integration-events/process-pending', 'pending')}>{busy === 'pending' ? 'Đang xử lý...' : 'Xử lý hàng đợi ngay'}</button>}</section>
    {error && <div className="integration-message error">{error}</div>}{notice && <div className="integration-message notice">{notice}</div>}
    <section className="integration-table"><table><thead><tr><th>Thời gian nhận</th><th>Seller</th><th>Loại sự kiện</th><th>Mã từ nền tảng</th><th>Trạng thái</th><th>Số lần</th><th>Kết quả</th><th></th></tr></thead><tbody>{data?.events.map((item) => <tr key={item.id}><td><b>{new Date(item.receivedAt).toLocaleDateString('vi-VN')}</b><small>{new Date(item.receivedAt).toLocaleTimeString('vi-VN')}</small></td><td><b>{item.channelAccount.name}</b><small>{item.channelAccount.code}</small></td><td><code>{item.eventType}</code><small>{item.signatureVerified ? '✓ Đã xác thực chữ ký' : 'Chưa xác thực'}</small></td><td title={item.providerEventId}>{item.providerEventId.length > 22 ? `${item.providerEventId.slice(0, 22)}…` : item.providerEventId}</td><td><span className={`event-status ${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span></td><td>{item.attempts}/{item.maxAttempts}</td><td className={item.status === 'FAILED' ? 'event-error' : ''}>{item.errorMessage || (item.processedAt ? `Hoàn tất ${new Date(item.processedAt).toLocaleTimeString('vi-VN')}` : `Lượt kế ${new Date(item.nextAttemptAt).toLocaleTimeString('vi-VN')}`)}</td><td>{canManage && item.status === 'FAILED' && <button disabled={busy === item.id} onClick={() => action(`/channels/integration-events/${item.id}/retry`, item.id)}>{busy === item.id ? 'Đang chạy...' : 'Chạy lại'}</button>}</td></tr>)}</tbody></table>{data && !data.events.length && <div className="integration-empty">Chưa có sự kiện phù hợp bộ lọc.</div>}{!data && !error && <div className="integration-empty">Đang tải nhật ký tích hợp...</div>}</section>
  </main>;
}
