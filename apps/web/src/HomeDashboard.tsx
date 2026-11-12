import { useEffect, useState, type ReactNode } from "react";
import { homeSummarySchema, type HomeSummary } from "@coago/contracts";
import type { AuthState, SiteSettings } from "@coago/contracts";
import { LocationCard, useLocationAccess } from "./LocationAccess";
const labels = {
  pending: "รอตรวจสอบ",
  approved: "ผ่านการตรวจแล้ว",
  rejected: "กรุณาแก้ไขข้อมูล",
};
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
  const [record, setSummary] = useState<{
      owner: string;
      data: HomeSummary;
    } | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    setSummary(null);
    setFailed(false);
    if (!account?.user) return;
    const control = new AbortController();
    void fetch("/api/membership/home", {
      cache: "no-store",
      signal: AbortSignal.any([control.signal, AbortSignal.timeout(8000)]),
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return homeSummarySchema.parse(await r.json());
      })
      .then((d) => {
        if (!control.signal.aborted)
          setSummary({ owner: account.user!.id, data: d });
      })
      .catch(() => {
        if (!control.signal.aborted) setFailed(true);
      });
    return () => control.abort();
  }, [account?.user?.id]);
  const summary = record?.owner === account?.user?.id ? record?.data : null;
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
      href: site?.serviceOpen ? "#trips-title" : "#closed-title",
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
      detail: summary?.member
        ? labels[summary.member.status]
        : "สมัครและยืนยันตัวตน",
      href: "/account",
      kind: "person",
    },
    {
      title: "รถของฉัน",
      detail: summary?.vehicle
        ? labels[summary.vehicle.status]
        : "บันทึกและจัดการข้อมูลรถ",
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
      <section className="home-previews" aria-label="รูปสมาชิกและรถของฉัน">
        <Preview
          title="รถของฉัน"
          kind="car"
          image={account?.user ? summary?.vehicle?.photoId : undefined}
          text={
            summary?.vehicle
              ? `${summary.vehicle.brand} ${summary.vehicle.model} · ${summary.vehicle.color}`
              : "บันทึกรถเพื่อเลือกใช้ตอนประกาศเที่ยว"
          }
          href="/account#my-vehicles"
        />
        <Preview
          title="ผู้เดินทาง"
          kind="person"
          image={account?.user ? summary?.member?.portraitId : undefined}
          text={
            account?.user
              ? account.user.displayName
              : "เข้าสู่ระบบเพื่อดูข้อมูลของคุณ"
          }
          href={account?.user ? "/account" : "#my-account"}
        />
        <p className="field-help">
          {failed
            ? "ยังโหลดรูปส่วนตัวไม่ได้ เปิดหน้าข้อมูลสมาชิกเพื่อตรวจสอบได้"
            : "รูปส่วนตัวในส่วนนี้แสดงเฉพาะเจ้าของบัญชี ไม่แสดงเอกสารยืนยันตัวตนหรือป้ายทะเบียน"}
        </p>
      </section>
      <LocationCard />
    </>
  );
}
function Preview({
  title,
  kind,
  image,
  text,
  href,
}: {
  title: string;
  kind: "car" | "person";
  image?: string;
  text: string;
  href: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);
  return (
    <article className="home-preview">
      <div className="preview-image">
        {image && !broken ? (
          <img
            src={`/api/membership/uploads/${image}`}
            alt={title}
            onError={() => setBroken(true)}
          />
        ) : (
          <Symbol kind={kind} />
        )}
      </div>
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
        <a href={href}>
          ดูและแก้ไขข้อมูล <span aria-hidden="true">→</span>
        </a>
      </div>
    </article>
  );
}
