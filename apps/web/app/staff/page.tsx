'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import './staff.css';
import './scope-policy.css';

type Role = { id: string; code: string; name: string; permissions: string[]; _count?: { assignments: number } };
type Assignment = { id: string; scopeType: ScopeType; scopeId?: string; role: Role };
type User = { id: string; email: string; displayName: string; active: boolean; roleAssignments: Assignment[] };
type Permission = { code: string; group: string; name: string };
type ScopeType = 'ORGANIZATION' | 'BRANCH' | 'WAREHOUSE' | 'CHANNEL';
type Scope = { id: string; name: string; detail?: string };
type Scopes = Record<ScopeType, Scope[]>;

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const scopeLabels: Record<ScopeType, string> = { ORGANIZATION: 'Toàn công ty', BRANCH: 'Chi nhánh', WAREHOUSE: 'Kho hàng', CHANNEL: 'Seller / kênh bán' };
const emptyScopes: Scopes = { ORGANIZATION: [], BRANCH: [], WAREHOUSE: [], CHANNEL: [] };

export default function StaffPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<Permission[]>([]);
  const [myPermissions, setMyPermissions] = useState<string[]>([]);
  const [scopes, setScopes] = useState<Scopes>(emptyScopes);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [panel, setPanel] = useState<'NONE' | 'USER' | 'ROLE'>('NONE');
  const [scopeType, setScopeType] = useState<ScopeType>('ORGANIZATION');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('erp_access_token');
    if (!token) { router.replace('/login'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const responses = await Promise.all([
      fetch(`${api}/administration/users`, { headers, cache: 'no-store' }),
      fetch(`${api}/administration/roles`, { headers, cache: 'no-store' }),
      fetch(`${api}/administration/permissions`, { headers, cache: 'no-store' }),
      fetch(`${api}/administration/scopes`, { headers, cache: 'no-store' }),
      fetch(`${api}/auth/me`, { headers, cache: 'no-store' }),
    ]);
    if (responses.some((response) => response.status === 401)) { localStorage.removeItem('erp_access_token'); router.replace('/login'); return; }
    if (responses[0].status === 403) { router.replace('/'); return; }
    if (responses.some((response) => !response.ok)) throw new Error('Không thể tải dữ liệu phân quyền.');
    const [usersPayload, rolesPayload, permissionsPayload, scopesPayload, mePayload] = await Promise.all(responses.map((response) => response.json()));
    setUsers(usersPayload); setRoles(rolesPayload); setPermissionCatalog(permissionsPayload); setScopes(scopesPayload); setMyPermissions(mePayload.permissions ?? []);
    setSelectedUserId((current) => usersPayload.some((user: User) => user.id === current) ? current : usersPayload[0]?.id ?? '');
  }, [router]);

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Lỗi kết nối')); }, [load]);

  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const canManageUsers = myPermissions.includes('*') || myPermissions.includes('users.manage');
  const canManageRoles = myPermissions.includes('*') || myPermissions.includes('roles.manage');
  const groupedPermissions = useMemo(() => permissionCatalog.reduce<Record<string, Permission[]>>((groups, permission) => { (groups[permission.group] ??= []).push(permission); return groups; }, {}), [permissionCatalog]);

  async function request(path: string, init: RequestInit) {
    const response = await fetch(`${api}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` } });
    const payload = await response.json();
    if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message[0] : payload.message ?? 'Không thể thực hiện tác vụ.');
    return payload;
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('create-user'); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const created = await request('/administration/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: form.get('displayName'), email: form.get('email'), password: form.get('password') }) });
      setPanel('NONE'); setNotice(`Đã tạo tài khoản ${created.displayName}. Hãy gán vai trò trước khi bàn giao.`); await load(); setSelectedUserId(created.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tạo nhân viên.'); }
    finally { setBusy(''); }
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('create-role'); setError(''); setNotice('');
    const form = new FormData(event.currentTarget); const permissions = form.getAll('permissions').map(String);
    try {
      const created = await request('/administration/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), code: form.get('code'), permissions }) });
      setPanel('NONE'); setNotice(`Đã tạo vai trò ${created.name} với ${permissions.length} quyền.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tạo vai trò.'); }
    finally { setBusy(''); }
  }

  async function assignRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedUser) return; setBusy('assign'); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      await request(`/administration/users/${selectedUser.id}/roles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: form.get('roleId'), scopeType, scopeId: form.get('scopeId') }) });
      setNotice(`Đã cập nhật quyền cho ${selectedUser.displayName}.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể gán vai trò.'); }
    finally { setBusy(''); }
  }

  async function revokeRole(assignment: Assignment) {
    if (!selectedUser) return; setBusy(assignment.id); setError(''); setNotice('');
    try { await request(`/administration/users/${selectedUser.id}/roles/${assignment.id}`, { method: 'DELETE' }); setNotice(`Đã thu hồi vai trò ${assignment.role.name}.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể thu hồi vai trò.'); }
    finally { setBusy(''); }
  }

  async function toggleUser() {
    if (!selectedUser) return; setBusy('status'); setError(''); setNotice('');
    try { await request(`/administration/users/${selectedUser.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !selectedUser.active }) }); setNotice(`Đã ${selectedUser.active ? 'khóa' : 'mở'} tài khoản ${selectedUser.displayName}.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể đổi trạng thái tài khoản.'); }
    finally { setBusy(''); }
  }

  function scopeName(assignment: Assignment) { return scopes[assignment.scopeType]?.find((scope) => scope.id === assignment.scopeId)?.name ?? scopeLabels[assignment.scopeType]; }

  return <main className="staff-page">
    <header className="staff-header"><div><p>QUẢN TRỊ HỆ THỐNG</p><h1>Nhân viên & phân quyền</h1><span>Gán đúng chức năng và đúng phạm vi dữ liệu cho từng tài khoản.</span></div><div><a href="/activity">Nhật ký</a><a href="/">← Tổng quan</a>{canManageRoles && <button className="secondary" onClick={() => setPanel(panel === 'ROLE' ? 'NONE' : 'ROLE')}>+ Tạo vai trò</button>}{canManageUsers && <button onClick={() => setPanel(panel === 'USER' ? 'NONE' : 'USER')}>+ Thêm nhân viên</button>}</div></header>
    <section className="staff-metrics"><article><span>Tổng nhân viên</span><strong>{users.length}</strong></article><article><span>Đang hoạt động</span><strong>{users.filter((user) => user.active).length}</strong></article><article><span>Vai trò</span><strong>{roles.length}</strong></article><article><span>Chưa gán vai trò</span><strong>{users.filter((user) => !user.roleAssignments.length).length}</strong></article></section>
    <section className="scope-policy"><b>Phạm vi đang được áp dụng vào dữ liệu thực tế</b><span>Nhân viên chỉ xem và xử lý đơn, tồn kho, xuất kho hoặc seller thuộc phạm vi của chính vai trò đó. Nếu một nhân viên cần làm việc với cả seller và kho, hãy gán vai trò tại cả hai phạm vi.</span></section>
    {panel === 'USER' && <form className="staff-form" onSubmit={createUser}><label>Họ và tên<input name="displayName" minLength={2} required /></label><label>Email<input name="email" type="email" required /></label><label>Mật khẩu ban đầu<input name="password" type="password" minLength={8} required /></label><button disabled={Boolean(busy)}>{busy === 'create-user' ? 'Đang tạo…' : 'Tạo tài khoản'}</button></form>}
    {panel === 'ROLE' && <form className="role-form" onSubmit={createRole}><div className="role-form-head"><label>Tên vai trò<input name="name" minLength={2} required placeholder="Ví dụ: Quản lý kho" /></label><label>Mã vai trò<input name="code" minLength={2} required placeholder="WAREHOUSE_MANAGER" /></label><button disabled={Boolean(busy)}>{busy === 'create-role' ? 'Đang tạo…' : 'Tạo vai trò'}</button></div><div className="permission-groups">{Object.entries(groupedPermissions).map(([group, permissions]) => <fieldset key={group}><legend>{group}</legend>{permissions.map((permission) => <label key={permission.code}><input type="checkbox" name="permissions" value={permission.code} /> <span><b>{permission.name}</b><small>{permission.code}</small></span></label>)}</fieldset>)}</div></form>}
    {error && <p className="staff-message error">{error}</p>}{notice && <p className="staff-message notice">{notice}</p>}
    <div className="staff-layout"><section className="staff-panel"><div className="staff-panel-title"><h2>Danh sách nhân viên</h2><span>Chọn một tài khoản để quản lý</span></div><div className="staff-list">{users.map((user) => <button className={user.id === selectedUserId ? 'selected' : ''} onClick={() => setSelectedUserId(user.id)} key={user.id}><div className="avatar">{user.displayName.split(' ').slice(-2).map((word) => word[0]).join('').toUpperCase()}</div><div className="staff-info"><b>{user.displayName}</b><span>{user.email}</span><div>{user.roleAssignments.length ? user.roleAssignments.slice(0, 2).map((assignment) => <em key={assignment.id}>{assignment.role.name}</em>) : <em className="unassigned">Chưa gán vai trò</em>}</div></div><span className={user.active ? 'account-status active' : 'account-status'}>{user.active ? 'Hoạt động' : 'Đã khóa'}</span></button>)}</div></section>
      <section className="staff-panel staff-detail">{selectedUser ? <><div className="staff-panel-title"><div><h2>{selectedUser.displayName}</h2><span>{selectedUser.email}</span></div>{canManageUsers && <button className={selectedUser.active ? 'lock' : 'unlock'} disabled={Boolean(busy)} onClick={toggleUser}>{busy === 'status' ? 'Đang cập nhật…' : selectedUser.active ? 'Khóa tài khoản' : 'Mở tài khoản'}</button>}</div><div className="assignment-list"><h3>Vai trò và phạm vi hiện tại</h3>{selectedUser.roleAssignments.length === 0 && <p>Chưa có quyền sử dụng chức năng nghiệp vụ.</p>}{selectedUser.roleAssignments.map((assignment) => <article key={assignment.id}><div><b>{assignment.role.name}</b><span>{scopeLabels[assignment.scopeType]} · {scopeName(assignment)}</span><small>{assignment.role.permissions.includes('*') ? 'Toàn quyền hệ thống' : `${assignment.role.permissions.length} quyền chức năng`}</small></div>{canManageUsers && <button disabled={Boolean(busy)} onClick={() => revokeRole(assignment)}>{busy === assignment.id ? 'Đang thu hồi…' : 'Thu hồi'}</button>}</article>)}</div>{canManageUsers && <form className="assign-form" onSubmit={assignRole}><h3>Gán thêm vai trò</h3><label>Vai trò<select name="roleId" required defaultValue=""><option value="" disabled>Chọn vai trò</option>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label><label>Phạm vi<select value={scopeType} onChange={(event) => setScopeType(event.target.value as ScopeType)}>{Object.entries(scopeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Áp dụng tại<select name="scopeId" required key={scopeType} defaultValue=""><option value="" disabled>Chọn phạm vi cụ thể</option>{scopes[scopeType].map((scope) => <option value={scope.id} key={scope.id}>{scope.name}{scope.detail ? ` · ${scope.detail}` : ''}</option>)}</select></label><button disabled={Boolean(busy)}>{busy === 'assign' ? 'Đang gán…' : 'Gán vai trò'}</button></form>}</> : <div className="staff-empty">Chọn nhân viên để xem quyền.</div>}</section>
    </div>
    <section className="staff-panel role-overview"><div className="staff-panel-title"><h2>Vai trò hệ thống</h2><span>{roles.length} vai trò</span></div><div className="role-list">{roles.map((role) => <article key={role.id}><div><b>{role.name}</b><small>{role.code}</small></div><span>{role.permissions.includes('*') ? 'Toàn quyền' : `${role.permissions.length} quyền`}</span><small>{role._count?.assignments ?? 0} lượt gán</small></article>)}</div></section>
  </main>;
}
