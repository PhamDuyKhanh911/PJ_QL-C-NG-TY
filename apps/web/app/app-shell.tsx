'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type NavigationSection = { group: string; items: Array<readonly [string, string]> };

const navigation: NavigationSection[] = [
  { group: 'Điều hành', items: [
    ['/', 'Tổng quan'], ['/alerts', 'Trung tâm cảnh báo'], ['/activity', 'Nhật ký hoạt động'],
  ] },
  { group: 'Bán hàng', items: [
    ['/orders', 'Đơn hàng'], ['/fulfillment', 'Xuất kho'], ['/pos', 'Bán hàng POS'],
    ['/after-sales', 'Hủy · hoàn · đổi trả'], ['/assisted-sales', 'Chốt đơn qua chat'],
  ] },
  { group: 'Kho & sản phẩm', items: [
    ['/products', 'Sản phẩm'], ['/inventory', 'Kho hàng'], ['/inventory/receipts', 'Phiếu nhập kho'], ['/inventory/transactions', 'Sổ giao dịch kho'],
    ['/inventory/stocktakes', 'Kiểm kê kho'], ['/inventory/quarantine', 'Kiểm định hàng hoàn'],
    ['/purchasing', 'Mua hàng'],
  ] },
  { group: 'Đa kênh & khách hàng', items: [
    ['/channels', 'Kênh bán hàng'], ['/inventory/channel-reconciliation', 'Đối chiếu tồn sàn'],
    ['/integrations', 'Nhật ký tích hợp'], ['/inbox', 'Hộp thư chung'], ['/customers', 'Khách hàng'],
  ] },
  { group: 'Tài chính & quản trị', items: [
    ['/reports', 'Báo cáo'], ['/reports/channels', 'Phát triển kênh'], ['/reconciliation', 'Đối soát tiền về'],
    ['/receivables', 'Công nợ phải thu'], ['/staff', 'Nhân viên & phân quyền'], ['/backups', 'Sao lưu dữ liệu'],
  ] },
];

const excludedPaths = ['/login'];

export default function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeHref = navigation.flatMap((section) => section.items)
    .map(([href]) => href)
    .filter((href) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`))
    .sort((left, right) => right.length - left.length)[0];

  useEffect(() => {
    setCollapsed(localStorage.getItem('qlseller_menu_collapsed') === 'true');
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

  if (excludedPaths.includes(pathname) || pathname.startsWith('/fulfillment/print')) return children;

  function toggleMenu() {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setMobileOpen((value) => !value);
      return;
    }
    setCollapsed((value) => {
      localStorage.setItem('qlseller_menu_collapsed', String(!value));
      return !value;
    });
  }

  function logout() {
    localStorage.removeItem('erp_access_token');
    localStorage.removeItem('erp_user');
    router.replace('/login');
  }

  return (
    <div className={`global-shell ${collapsed ? 'menu-collapsed' : ''} ${mobileOpen ? 'menu-open' : ''}`}>
      <aside className="global-sidebar" aria-label="Menu chức năng">
        <div className="global-brand">
          <span>Q</span>
          <div><b>QLSELLER</b><small>Quản lý đa kênh</small></div>
        </div>
        <nav>
          {navigation.map((section) => (
            <section key={section.group}>
              <h2>{section.group}</h2>
              {section.items.map(([href, label]) => {
                const active = href === activeHref;
                return <Link className={active ? 'active' : ''} href={href} title={collapsed ? label : undefined} key={href}><i>{label.charAt(0)}</i><span>{label}</span></Link>;
              })}
            </section>
          ))}
        </nav>
        <button className="global-logout" onClick={logout}><i>↪</i><span>Đăng xuất</span></button>
      </aside>
      <button className="global-menu-toggle" onClick={toggleMenu} aria-label="Ẩn/hiện menu">
        <span></span><span></span><span></span>
      </button>
      <button className="global-menu-backdrop" aria-label="Đóng menu" onClick={() => setMobileOpen(false)} />
      <div className="global-content">{children}</div>
    </div>
  );
}
