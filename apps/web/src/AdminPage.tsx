import { useCallback, useState } from "react";
import type { AuthState } from "@coago/contracts";
import AuthPanel from "./AuthPanel";
import AdminPanel from "./AdminPanel";
export default function AdminPage() {
  const [account, setAccount] = useState<AuthState | null>(null);
  const [role, setRole] = useState<boolean | null>(null);
  const roleChanged = useCallback((root: boolean) => setRole(root), []);
  const accountChanged = useCallback((next: AuthState | null) => {
    setAccount(next);
    setRole(null);
  }, []);
  return (
    <main>
      <nav aria-label="เมนูผู้ดูแล">
        <a href="/admin">
          COAGO<span>ระบบผู้ดูแล</span>
        </a>
        <a href="/">ไปหน้าผู้ใช้</a>
      </nav>
      <header>
        <p className="eyebrow">พื้นที่จัดการระบบ</p>
        <h1>ผู้ดูแล COAGO</h1>
        <p>สำหรับบัญชีเจ้าของที่ได้รับสิทธิ์ Root Admin</p>
      </header>
      <AuthPanel
        onAccountChange={accountChanged}
        serviceOpen={false}
        registrationsOpen={false}
        adminMode
      />
      {account?.user && role === null && (
        <p role="status">กำลังตรวจสิทธิ์ผู้ดูแล…</p>
      )}
      {account?.user && role === false && (
        <p role="alert">
          บัญชีนี้ไม่มีสิทธิ์เข้าระบบผู้ดูแล กรุณาใช้บัญชีเจ้าของ
          หรือกลับไปหน้าผู้ใช้
        </p>
      )}
      <AdminPanel account={account} onRole={roleChanged} onChange={() => {}} />
    </main>
  );
}
