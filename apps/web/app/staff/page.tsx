'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './staff.css';

type Role = { id: string; code: string; name: string; permissions: string[]; _count?: { assignments: number } };
type Assignment = { id: string; scopeType: string; scopeId?: string; role: Role };
type User = { id: string; email: string; displayName: string; active: boolean; roleAssignments: Assignment[] };

export default function StaffPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const [usersResponse, rolesResponse] = await Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/administration/users`, { headers }),
      fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/administration/roles`, { headers }),
    ]);
    if (usersResponse.status === 401) { router.replace('/login'); return; }
    if (!usersResponse.ok || !rolesResponse.ok) throw new Error('Không thể tải dữ liệu nhân viên');
    setUsers(await usersResponse.json());
    setRoles(await rolesResponse.json());
  }, [router]);

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Lỗi kết nối')); }, [load]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const form = new FormData(event.currentTarget);
    const token = localStorage.getItem('erp_access_token');
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/administration/users`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: form.get('displayName'), email: form.get('email'), password: form.get('password') }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message[0] : payload.message);
      setShowForm(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tạo nhân viên'); }
    finally { setSaving(false); }
  }

  return <main className="staff-page">
    <header className="staff-header"><div><p>QUẢN TRỊ HỆ THỐNG</p><h1>Nhân viên & phân quyền</h1><span>Kiểm soát chức năng và phạm vi dữ liệu của từng tài khoản.</span></div><div><a href="/">← Tổng quan</a><button onClick={() => setShowForm(!showForm)}>+ Thêm nhân viên</button></div></header>
    <section className="staff-metrics"><article><span>Tổng nhân viên</span><strong>{users.length}</strong></article><article><span>Đang hoạt động</span><strong>{users.filter((user)=>user.active).length}</strong></article><article><span>Vai trò</span><strong>{roles.length}</strong></article><article><span>Tài khoản chưa gán vai trò</span><strong>{users.filter((user)=>!user.roleAssignments.length).length}</strong></article></section>
    {showForm && <form className="staff-form" onSubmit={createUser}><label>Họ và tên<input name="displayName" minLength={2} required /></label><label>Email<input name="email" type="email" required /></label><label>Mật khẩu ban đầu<input name="password" type="password" minLength={8} required /></label><button disabled={saving}>{saving?'Đang tạo…':'Tạo tài khoản'}</button></form>}
    {error && <p className="staff-error">{error}</p>}
    <div className="staff-grid"><section className="staff-panel"><div className="staff-panel-title"><h2>Danh sách nhân viên</h2><span>{users.length} tài khoản</span></div><div className="staff-list">{users.map((user)=><article key={user.id}><div className="avatar">{user.displayName.split(' ').slice(-2).map((word)=>word[0]).join('').toUpperCase()}</div><div className="staff-info"><b>{user.displayName}</b><span>{user.email}</span><div>{user.roleAssignments.length?user.roleAssignments.map((assignment)=><em key={assignment.id}>{assignment.role.name} · {assignment.scopeType}</em>):<em className="unassigned">Chưa gán vai trò</em>}</div></div><span className={user.active?'account-status active':'account-status'}>{user.active?'Hoạt động':'Đã khóa'}</span></article>)}</div></section>
      <section className="staff-panel"><div className="staff-panel-title"><h2>Vai trò hệ thống</h2><span>{roles.length} vai trò</span></div><div className="role-list">{roles.map((role)=><article key={role.id}><div><b>{role.name}</b><small>{role.code}</small></div><span>{role.permissions.includes('*')?'Toàn quyền':`${role.permissions.length} quyền`}</span><small>{role._count?.assignments??0} lượt gán</small></article>)}</div></section></div>
  </main>;
}
