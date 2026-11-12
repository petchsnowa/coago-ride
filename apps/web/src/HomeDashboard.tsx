import { type ReactNode } from "react";
import type { AuthState, SiteSettings } from "@coago/contracts";
import { useLocationAccess } from "./LocationAccess";
function Symbol({ kind }: { kind: "car" | "person" | "pin" }) {
  return (
    <svg
      viewBox="0 0 80 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      {kind === "car" ? (
        <>
          <path d="m15 30 8-16h34l8 16v20H15Z M15 30h50 M25 50v6 M55 50v6" />
          <path d="M22 39h9 M49 39h9" />
        </>
      ) : kind === "person" ? (
        <>
          <circle cx="40" cy="21" r="12" />
          <path d="M16 58c0-25 48-25 48 0" />
        </>
      ) : (
        <>
          <path d="M40 58S18 38 18 24a22 22 0 0 1 44 0c0 14-22 34-22 34Z" />
          <circle cx="40" cy="24" r="7" />
        </>
      )}
    </svg>
  );
}
export default function HomeDashboard({
  account,
  site,
  children,
}: {
  account: AuthState | null;
  site: SiteSettings | null;
  children?: ReactNode;
}) {
  const { state } = useLocationAccess();
  const menus = [
    {
      title: "ค้นหาเที่ยว",
      detail: "เลือกเส้นทางและวันที่",
      href: "#find-trips",
      kind: "pin",
    },
    {
      title: "ประกาศเที่ยว",
      detail: "เปิดที่นั่งว่างไปด้วยกัน",
      href: site?.serviceOpen
        ? account?.user
          ? "#trips-title"
          : "#my-account"
        : "#closed-title",
      kind: "car",
    },
    {
      title: "การเดินทางของฉัน",
      detail: "ดูเที่ยวและคำขอร่วมทาง",
      href: site?.serviceOpen && account?.user ? "#my-journeys" : "#my-account",
      kind: "pin",
    },
    {
      title: "ข้อมูลสมาชิก",
      detail: "สมัครและยืนยันตัวตน",
      href: "/account",
      kind: "person",
    },
    {
      title: "รถของฉัน",
      detail: "บันทึกและจัดการข้อมูลรถ",
      href: "/account#my-vehicles",
      kind: "car",
    },
    {
      title: "ตั้งค่าตำแหน่ง",
      detail:
        state === "granted" ? "อนุญาตตำแหน่งแล้ว" : "เปิดตำแหน่งก่อนใช้บริการ",
      href: "#location-settings",
      kind: "pin",
    },
  ] as const;
  return (
    <>
      <section className="home-dashboard" aria-labelledby="dashboard-title">
        <header className="dashboard-heading">
          <div>
            <p className="eyebrow">เส้นทางเดียวกัน ไปด้วยกันได้</p>
            <h1 id="dashboard-title">วันนี้จะไปที่ไหน</h1>
          </div>
          <span className="badge">
            {site?.serviceOpen ? "พร้อมร่วมเดินทาง" : "กำลังเตรียมเปิดบริการ"}
          </span>
        </header>
        <nav className="dashboard-grid" aria-label="ทางลัดการใช้บริการ">
          {menus.map((m) => (
            <a href={m.href} className="dashboard-tile" key={m.title}>
              <Symbol kind={m.kind} />
              <strong>{m.title}</strong>
              <span>{m.detail}</span>
            </a>
          ))}
        </nav>
      </section>
      {children}
    </>
  );
}
