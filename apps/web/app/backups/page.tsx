'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './backups.css';

type Backup = {
  fileName: string;
  createdAt: string;
  verifiedAt: string;
  sizeBytes: number;
  sha256: string;
  databaseName: string;
  toolVersion: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const size = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

export default function BackupsPage() {
  const router = useRouter();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const meResponse = await fetch(`${apiUrl}/auth/me`, { headers });
    if (meResponse.status === 401) { router.replace('/login'); return; }
    const me = await meResponse.json() as { permissions: string[] };
    if (!me.permissions.includes('*') && !me.permissions.includes('backups.manage')) { router.replace('/'); return; }
    const response = await fetch(`${apiUrl}/backups`, { headers });
    if (!response.ok) throw new Error('Không thể tải danh sách bản sao lưu.');
    setBackups(await response.json());
  }, [router]);

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Lỗi kết nối')); }, [load]);

  async function createBackup() {
    setBusy('create'); setError(''); setMessage('');
    try {
      const response = await request('/backups', { method: 'POST' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Không thể tạo bản sao lưu.'));
      await load();
      setMessage('Đã tạo và kiểm tra bản sao lưu mới. Dữ liệu hiện tại đã sẵn sàng để chuyển máy chủ.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tạo bản sao lưu.'); }
    finally { setBusy(''); }
  }

  async function verifyBackup(fileName: string) {
    setBusy(fileName); setError(''); setMessage('');
    try {
      const response = await request(`/backups/${encodeURIComponent(fileName)}/verify`, { method: 'POST' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Bản sao lưu không vượt qua bước kiểm tra.'));
      await load(); setMessage('Bản sao lưu còn nguyên vẹn và có thể dùng để khôi phục.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể kiểm tra bản sao lưu.'); }
    finally { setBusy(''); }
  }

  async function downloadBackup(fileName: string) {
    setBusy(`download-${fileName}`); setError('');
    try {
      const response = await request(`/backups/${encodeURIComponent(fileName)}/download`);
      if (!response.ok) throw new Error(await responseMessage(response, 'Không thể tải bản sao lưu.'));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải bản sao lưu.'); }
    finally { setBusy(''); }
  }

  function request(path: string, init?: RequestInit) {
    const token = localStorage.getItem('erp_access_token');
    return fetch(`${apiUrl}${path}`, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
  }

  return <main className="backup-page">
    <header className="backup-header">
      <div><p>AN TOÀN DỮ LIỆU</p><h1>Sao lưu & chuyển dữ liệu</h1><span>Tạo một gói dữ liệu đầy đủ để bảo vệ hệ thống local hoặc chuyển lên máy chủ sau này.</span></div>
      <div><a href="/">← Tổng quan</a><button onClick={createBackup} disabled={Boolean(busy)}>{busy === 'create' ? 'Đang sao lưu…' : '+ Tạo bản sao lưu'}</button></div>
    </header>

    <section className="backup-summary">
      <article><span>Số bản đang lưu</span><strong>{backups.length}</strong><small>Không tính các tệp đang tạo dở</small></article>
      <article><span>Bản gần nhất</span><strong>{backups[0] ? new Date(backups[0].createdAt).toLocaleDateString('vi-VN') : 'Chưa có'}</strong><small>{backups[0] ? new Date(backups[0].createdAt).toLocaleTimeString('vi-VN') : 'Hãy tạo bản đầu tiên'}</small></article>
      <article><span>Trạng thái</span><strong className={backups.length ? 'safe' : 'warning'}>{backups.length ? 'Đã bảo vệ' : 'Cần sao lưu'}</strong><small>Mỗi bản đều được kiểm tra ngay sau khi tạo</small></article>
    </section>

    {error && <p className="backup-notice error">{error}</p>}
    {message && <p className="backup-notice success">{message}</p>}

    <section className="backup-panel">
      <div className="backup-panel-title"><div><h2>Các bản sao lưu</h2><p>Lưu riêng ngoài máy tính sau khi tải xuống để phòng sự cố ổ cứng.</p></div></div>
      {backups.length === 0 ? <div className="backup-empty"><b>Chưa có bản sao lưu</b><span>Bấm “Tạo bản sao lưu” để lưu toàn bộ đơn hàng, tồn kho, khách hàng và cấu hình seller hiện tại.</span></div> :
        <div className="backup-list">{backups.map((backup) => <article key={backup.fileName}>
          <div className="backup-icon">DB</div>
          <div className="backup-info"><b>{new Date(backup.createdAt).toLocaleString('vi-VN')}</b><span>{backup.fileName}</span><small>{size.format(backup.sizeBytes / 1024 / 1024)} MB · CSDL {backup.databaseName} · Đã kiểm tra {new Date(backup.verifiedAt).toLocaleString('vi-VN')}</small></div>
          <div className="backup-actions"><button onClick={() => verifyBackup(backup.fileName)} disabled={Boolean(busy)}>{busy === backup.fileName ? 'Đang kiểm tra…' : 'Kiểm tra lại'}</button><button className="primary" onClick={() => downloadBackup(backup.fileName)} disabled={Boolean(busy)}>{busy === `download-${backup.fileName}` ? 'Đang tải…' : 'Tải xuống'}</button></div>
        </article>)}</div>}
    </section>

    <section className="restore-guide">
      <h2>Quy trình chuyển lên máy chủ</h2>
      <div><article><i>1</i><b>Tạo và tải bản sao lưu</b><span>Thực hiện khi đã tạm dừng nhận đơn mới để dữ liệu không thay đổi giữa chừng.</span></article><article><i>2</i><b>Chuẩn bị cơ sở dữ liệu trống</b><span>Không khôi phục đè lên cơ sở dữ liệu đang có dữ liệu.</span></article><article><i>3</i><b>Khôi phục và đối chiếu</b><span>Dùng công cụ trong thư mục scripts, sau đó kiểm tra đơn hàng và tồn kho trước khi mở bán.</span></article></div>
      <p>Hệ thống cố ý không đặt nút “Khôi phục” trên màn hình này để tránh vô tình ghi đè dữ liệu đang vận hành.</p>
    </section>
  </main>;
}

async function responseMessage(response: Response, fallback: string) {
  try { const payload = await response.json() as { message?: string | string[] }; return Array.isArray(payload.message) ? payload.message[0] : payload.message || fallback; }
  catch { return fallback; }
}
