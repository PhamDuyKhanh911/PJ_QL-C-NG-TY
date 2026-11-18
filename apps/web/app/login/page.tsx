'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import './login.css';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@local.test');
  const [password, setPassword] = useState('Admin@123456');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Không thể đăng nhập');
      localStorage.setItem('erp_access_token', payload.accessToken);
      localStorage.setItem('erp_user', JSON.stringify(payload.user));
      router.push('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể kết nối máy chủ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="login-logo">Q</div>
        <p className="login-eyebrow">NỀN TẢNG QUẢN TRỊ ĐA KÊNH</p>
        <h1>Một trung tâm cho toàn bộ hoạt động bán hàng.</h1>
        <p>Quản lý 6 Seller, cửa hàng offline, tồn kho, đơn hàng và chăm sóc khách hàng trên cùng một hệ thống.</p>
        <div className="login-features"><span>✓ Phân quyền theo nhân viên</span><span>✓ Đồng bộ tồn kho tập trung</span><span>✓ Chat và CRM đa kênh</span></div>
      </section>
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <div><p className="login-eyebrow">CHÀO MỪNG TRỞ LẠI</p><h2>Đăng nhập hệ thống</h2><span>Sử dụng tài khoản được quản trị viên cấp.</span></div>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
          <label>Mật khẩu<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={8} required /></label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={loading}>{loading ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
          <small>Tài khoản mẫu chỉ dành cho môi trường phát triển local.</small>
        </form>
      </section>
    </main>
  );
}
