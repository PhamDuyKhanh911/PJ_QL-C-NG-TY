'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type NavigationSection = { group: string; mark: string; items: Array<readonly [string, string]> };

const navigation: NavigationSection[] = [
  { group: 'Điều hành', mark: 'Đ', items: [
    ['/', 'Tổng quan'], ['/alerts', 'Trung tâm cảnh báo'], ['/activity', 'Nhật ký hoạt động'],
  ] },
  { group: 'Bán hàng', mark: 'B', items: [
    ['/orders', 'Đơn hàng'], ['/fulfillment', 'Xuất kho'], ['/pos', 'Bán hàng POS'],
    ['/after-sales', 'Hủy · hoàn · đổi trả'], ['/assisted-sales', 'Chốt đơn qua chat'],
  ] },
  { group: 'Kho & sản phẩm', mark: 'K', items: [
    ['/products', 'Sản phẩm'], ['/inventory', 'Kho hàng'], ['/inventory/receipts', 'Phiếu nhập kho'], ['/inventory/transactions', 'Sổ giao dịch kho'],
    ['/inventory/stocktakes', 'Kiểm kê kho'], ['/inventory/quarantine', 'Kiểm định hàng hoàn'],
    ['/purchasing', 'Mua hàng'],
  ] },
  { group: 'Đa kênh & khách hàng', mark: 'D', items: [
    ['/channels', 'Kênh bán hàng'], ['/inventory/channel-reconciliation', 'Đối chiếu tồn sàn'],
    ['/integrations', 'Nhật ký tích hợp'], ['/inbox', 'Hộp thư chung'], ['/customers', 'Khách hàng'],
  ] },
  { group: 'Tài chính & quản trị', mark: 'T', items: [
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
  const activeGroup = navigation.find((section) => section.items.some(([href]) => href === activeHref))?.group ?? '';
  const [openGroup, setOpenGroup] = useState(activeGroup);

  useEffect(() => {
    setCollapsed(localStorage.getItem('qlseller_menu_collapsed') === 'true');
  }, []);

  useEffect(() => { setMobileOpen(false); setOpenGroup(activeGroup); }, [pathname, activeGroup]);

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

  function toggleSection(group: string) {
    setOpenGroup((current) => current === group ? '' : group);
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
            <section className={section.group === activeGroup ? 'current' : ''} key={section.group}>
              <button className="global-section-toggle" type="button" aria-expanded={openGroup === section.group} onClick={() => toggleSection(section.group)} title={collapsed ? section.group : undefined}><i>{section.mark}</i><span>{section.group}</span><b aria-hidden="true">{openGroup === section.group ? '−' : '+'}</b></button>
              {openGroup === section.group && <div className="global-section-items">{section.items.map(([href, label]) => {
                const active = href === activeHref;
                return <Link className={active ? 'active' : ''} href={href} title={collapsed ? label : undefined} key={href}><i>{label.charAt(0)}</i><span>{label}</span></Link>;
              })}</div>}
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
