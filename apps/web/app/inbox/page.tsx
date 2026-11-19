'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './inbox.css';

type Message = { id: string; direction: string; content: string; sentAt: string; senderRole: string; deliveryStatus?: string; deliveryAttempts?: number; lastDeliveryError?: string };
type Conversation = { id: string; status: string; lastMessageAt: string; assignedUserId?: string; channelAccount: { id: string; name: string; type: string }; customerIdentity: { displayName?: string; customer: { displayName: string; phone?: string } }; messages: Message[]; _count: { messages: number } };
type Detail = Conversation & { messages: Message[]; customerIdentity: Conversation['customerIdentity'] & { customer: Conversation['customerIdentity']['customer'] & { orders: Array<{ orderNumber: string; status: string; total: string }> } } };

const channelMark: Record<string, string> = { TIKTOK_SHOP: 'TT', SHOPEE: 'SP', FACEBOOK_MESSENGER: 'FB', OFFLINE_STORE: 'POS' };
const deliveryLabel: Record<string, string> = { QUEUED: 'Đang chờ gửi', SENDING: 'Đang gửi', SENT: 'Đã gửi', FAILED: 'Sẽ thử lại', BLOCKED: 'Bị chặn', UNKNOWN: 'Cần kiểm tra', UNSUPPORTED: 'Chưa hỗ trợ gửi', LEGACY_NOT_SENT: 'Tin cũ chưa gửi' };

export default function InboxPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Detail>();
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState('');
  const [error, setError] = useState('');

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem('erp_access_token');
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  }, []);

  const loadConversations = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) { router.replace('/login'); return; }
    const params = new URLSearchParams({ status: filter });
    if (search) params.set('search', search);
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/conversations?${params}`, { headers });
    if (response.status === 401) { router.replace('/login'); return; }
    if (!response.ok) throw new Error('Không thể tải hộp thư');
    const data = await response.json();
    setConversations(data);
    if (!selected && data[0]) await selectConversation(data[0].id, headers);
  }, [authHeaders, filter, router, search, selected]);

  async function selectConversation(id: string, headers = authHeaders()) {
    if (!headers) return;
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/conversations/${id}`, { headers });
    if (!response.ok) throw new Error('Không thể tải hội thoại');
    setSelected(await response.json());
  }

  useEffect(() => { loadConversations().catch((reason) => setError(reason instanceof Error ? reason.message : 'Lỗi kết nối')); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const content = String(new FormData(form).get('message') ?? '').trim();
    if (!content) return;
    setSending(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/conversations/${selected.id}/messages`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
      if (!response.ok) throw new Error('Không thể gửi tin nhắn');
      form.reset();
      await selectConversation(selected.id);
      await loadConversations();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Lỗi gửi tin'); }
    finally { setSending(false); }
  }

  async function retryDelivery(messageId: string) {
    if (!selected) return;
    setRetrying(messageId);
    setError('');
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/conversations/outbox/${messageId}/retry`, { method: 'POST', headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message);
      await selectConversation(selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể thử gửi lại');
    } finally {
      setRetrying('');
    }
  }

  return <main className="inbox-page">
    <header className="inbox-header"><div><p>CHĂM SÓC KHÁCH HÀNG</p><h1>Hộp thư hợp kênh</h1><span>TikTok, Shopee và Facebook Messenger trong một màn hình.</span></div><a href="/">← Tổng quan</a></header>
    {error && <p className="inbox-error">{error}</p>}
    <section className="inbox-shell">
      <aside className="conversation-sidebar"><div className="conversation-tools"><input value={search} onChange={(event)=>setSearch(event.target.value)} onKeyDown={(event)=>event.key==='Enter'&&loadConversations()} placeholder="Tìm khách hàng, nội dung…" /><select value={filter} onChange={(event)=>setFilter(event.target.value)}><option value="ALL">Tất cả</option><option value="UNREAD">Chưa đọc</option><option value="UNREPLIED">Chưa trả lời</option><option value="REPLIED">Đã trả lời</option></select></div><div className="conversation-list">{conversations.map((item)=><button className={selected?.id===item.id?'selected':''} key={item.id} onClick={()=>selectConversation(item.id)}><i className={`channel ${item.channelAccount.type.toLowerCase()}`}>{channelMark[item.channelAccount.type]??'CH'}</i><div><b>{item.customerIdentity.displayName??item.customerIdentity.customer.displayName}</b><span>{item.messages[0]?.content??'Chưa có tin nhắn'}</span><small>{item.channelAccount.name}</small></div><time>{new Date(item.lastMessageAt).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}</time>{['UNREAD','UNREPLIED'].includes(item.status)&&<em>!</em>}</button>)}</div></aside>
      <section className="chat-panel">{selected?<><div className="chat-title"><div><b>{selected.customerIdentity.displayName??selected.customerIdentity.customer.displayName}</b><span><i className={`mini-channel ${selected.channelAccount.type.toLowerCase()}`}>{channelMark[selected.channelAccount.type]}</i>{selected.channelAccount.name}</span></div><span className="conversation-status">{selected.status}</span></div><div className="messages">{selected.messages.map((message)=><div key={message.id} className={`message ${message.direction.toLowerCase()}`}><p>{message.content}</p><div className="message-meta"><time>{new Date(message.sentAt).toLocaleString('vi-VN')}</time>{message.direction === 'OUTBOUND' && <><span className={`delivery ${(message.deliveryStatus ?? 'QUEUED').toLowerCase()}`} title={message.lastDeliveryError}>{deliveryLabel[message.deliveryStatus ?? 'QUEUED'] ?? message.deliveryStatus}</span>{['FAILED','BLOCKED','UNKNOWN'].includes(message.deliveryStatus ?? '') && <button disabled={retrying === message.id} onClick={() => retryDelivery(message.id)}>{retrying === message.id ? 'Đang thử...' : 'Thử lại'}</button>}</>}</div></div>)}</div><form className="reply-box" onSubmit={send}><textarea name="message" placeholder="Nhập nội dung trả lời…" maxLength={4000} required /><div><span>Facebook được gửi trực tiếp; lỗi tạm thời sẽ tự thử lại an toàn.</span><button disabled={sending}>{sending?'Đang gửi…':'Gửi tin nhắn'}</button></div></form></>:<div className="empty-chat">Chọn một hội thoại để bắt đầu.</div>}</section>
      <aside className="customer-panel">{selected&&<><div className="customer-avatar">{(selected.customerIdentity.displayName??'KH').split(' ').slice(-2).map((word)=>word[0]).join('')}</div><h3>{selected.customerIdentity.displayName}</h3><span>Khách hàng đa kênh</span><div className="customer-section"><b>Thông tin</b><p>Kênh: {selected.channelAccount.name}</p><p>Số điện thoại: {selected.customerIdentity.customer.phone??'Chưa cập nhật'}</p></div><div className="customer-section"><b>Đơn hàng gần đây</b>{selected.customerIdentity.customer.orders.length?selected.customerIdentity.customer.orders.map((order)=><p key={order.orderNumber}>{order.orderNumber} · {order.status}</p>):<p>Chưa liên kết đơn hàng</p>}</div></>}</aside>
    </section>
  </main>;
}
