import type { Metadata } from 'next';
import './styles.css';
import './app-shell.css';
import AppShell from './app-shell';

export const metadata: Metadata = {
  title: 'Trung tâm điều hành doanh nghiệp',
  description: 'Quản lý bán hàng, tồn kho và chăm sóc khách hàng đa kênh',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
