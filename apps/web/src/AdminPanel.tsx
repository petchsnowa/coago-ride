import AdminAccounts from "./AdminAccounts";
import { useEffect, useRef, useState } from "react";
import {
  adminRoleSchema,
  adminOverviewSchema,
  adminLists,
  siteSettingsSchema,
  type AuthState,
  type SiteSettings,
  type AdminUser,
  type AdminTrip,
  type AdminRequest,
  type AdminAudit,
} from "@coago/contracts";
type Tab = "overview" | "users" | "trips" | "requests" | "settings" | "audit";
const labels: Record<Tab, string> = {
  overview: "ภาพรวม",
  users: "ผู้ใช้",
  trips: "ประกาศเที่ยว",
  requests: "คำขอร่วมทาง",
  settings: "เปิด–ปิดบริการ",
  audit: "ประวัติการจัดการ",
};
const messages: Record<string, string> = {
  unauthorized: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
  forbidden: "บัญชีนี้ไม่มีสิทธิ์ Root Admin",
  conflict: "ข้อมูลเปลี่ยนแล้ว กรุณาโหลดล่าสุดก่อนทำรายการ",
  root_protected: "ไม่สามารถระงับบัญชี Root Admin",
  service_unavailable: "ระบบยังไม่พร้อม กรุณาลองอีกครั้ง",
  trip_conflict: "เที่ยวเปลี่ยนแล้ว กรุณาโหลดล่าสุด",
  departure_in_past: "เที่ยวนี้ออกเดินทางแล้ว ไม่สามารถยกเลิกได้",
  trip_not_editable: "เที่ยวนี้ไม่พร้อมให้แก้ไข",
  invalid_request: "ตรวจข้อมูลและเหตุผลให้ครบก่อนยืนยัน",
};
const time = (value: string) =>
  new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
export default function AdminPanel({
  account,
  onRole,
  onChange,
}: {
  account: AuthState | null;
  onRole: (root: boolean) => void;
  onChange: () => void;
}) {
  return account?.user ? (
    <PrivateAdmin
      key={account.user.id}
      csrf={account.csrfToken}
      onRole={onRole}
      onChange={onChange}
    />
  ) : null;
}
function PrivateAdmin({
  csrf,
  onRole,
  onChange,
}: {
  csrf: string;
  onRole: (root: boolean) => void;
  onChange: () => void;
}) {
  const [role, setRole] = useState<"root" | "admin" | "user" | null>(null),
    [roleError, setRoleError] = useState(false),
    [tab, setTab] = useState<Tab>("overview"),
    [items, setItems] = useState<
      (AdminUser | AdminTrip | AdminRequest | AdminAudit)[]
    >([]),
    [cursor, setCursor] = useState<string | null>(null),
    [overview, setOverview] = useState<Record<string, number>>({}),
    [settings, setSettings] = useState<SiteSettings | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState<{
      kind: "user" | "trip" | "role";
      id: string;
      name: string;
      version: number;
      status?: "active" | "suspended";
      role?: "user" | "admin";
    } | null>(null),
    [confirmSettings, setConfirmSettings] = useState(false);
  const controller = useRef<AbortController | null>(null),
    sequence = useRef(0),
    active = useRef(true);
  async function api(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`/api/admin${path}`, {
      method,
      credentials: "same-origin",
      signal: AbortSignal.any([
        controller.current!.signal,
        AbortSignal.timeout(10000),
      ]),
      ...(body === undefined
        ? {}
        : {
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf,
            },
            body: JSON.stringify(body),
          }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        setRole("user");
        onRole(false);
        setItems([]);
      }
      throw new Error(
        messages[data?.error] ??
          "ทำรายการไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุดก่อนลองซ้ำ",
      );
    }
    return data;
  }
  useEffect(() => {
    let current = true;
    active.current = true;
    setRoleError(false);
    controller.current = new AbortController();
    void api("/me")
      .then((data) => {
        if (current) {
          const next = adminRoleSchema.parse(data).role;
          const allowed =
            !window.location.pathname.startsWith("/root") || next === "root";
          setRole(allowed ? next : "user");
          onRole(allowed && next !== "user");
        }
      })
      .catch(() => {
        if (current) {
          setRole("user");
          setRoleError(true);
          onRole(false);
        }
      });
    return () => {
      current = false;
      active.current = false;
      controller.current?.abort();
      onRole(false);
    };
  }, []);
  async function load(after?: string) {
    const ticket = ++sequence.current;
    setLoading(true);
    setError("");
    if (!after) {
      setItems([]);
      setCursor(null);
      setConfirm(null);
      setConfirmSettings(false);
      setReason("");
    }
    try {
      const data = await api(
        `/${tab}${after ? `?cursor=${encodeURIComponent(after)}` : ""}`,
      );
      if (!active.current || ticket !== sequence.current) return;
      if (tab === "overview") setOverview(adminOverviewSchema.parse(data));
      else if (tab === "settings") setSettings(siteSettingsSchema.parse(data));
      else {
        const result = adminLists[tab].parse(data);
        setItems((prev) =>
          after
            ? [
                ...prev,
                ...result.items.filter((r) => !prev.some((p) => p.id === r.id)),
              ]
            : result.items,
        );
        setCursor(result.nextCursor);
      }
    } catch (e) {
      if (active.current && ticket === sequence.current)
        setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      if (active.current && ticket === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (role === "root" || role === "admin") void load();
    return () => {
      ++sequence.current;
    };
  }, [role, tab]);
  async function save() {
    if (busy || !reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (confirm)
        await api(
          confirm.kind === "role"
            ? `/users/${confirm.id}/role`
            : confirm.kind === "user"
              ? `/users/${confirm.id}/status`
              : `/trips/${confirm.id}/cancel`,
          confirm.kind !== "trip" ? "PUT" : "POST",
          {
            version: confirm.version,
            reason: reason.trim(),
            ...(confirm.kind === "user"
              ? { status: confirm.status }
              : confirm.kind === "role"
                ? { role: confirm.role }
                : {}),
          },
        );
      else if (confirmSettings && settings)
        await api("/settings", "PUT", { ...settings, reason: reason.trim() });
      if (active.current) {
        onChange();
        await load();
      }
    } catch (e) {
      if (active.current) {
        await load();
        setError(
          e instanceof Error
            ? e.message
            : "ไม่ทราบผลการบันทึก กรุณาโหลดล่าสุดก่อนลองซ้ำ",
        );
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  if (roleError)
    return (
      <section className="admin-panel">
        <p role="alert">ตรวจสิทธิ์บัญชีไม่สำเร็จ กรุณาโหลดบัญชีอีกครั้ง</p>
        <button className="secondary" onClick={() => window.location.reload()}>
          โหลดบัญชีอีกครั้ง
        </button>
      </section>
    );
  if (role !== "root" && role !== "admin") return null;
  const kpis: Record<string, string> = {
    users: "ผู้ใช้ทั้งหมด",
    suspended: "ผู้ใช้ถูกระงับ",
    active_trips: "ประกาศที่ยังไม่ยกเลิก",
    cancelled_trips: "ประกาศยกเลิก",
    pending_requests: "คำขอรอตอบรับ",
    accepted_requests: "คำขอตอบรับแล้วรวม",
  };
  const actions: Record<string, string> = {
    root_bootstrap: "ยืนยันบัญชีเจ้าของผ่าน LINE",
    user_suspended: "ระงับผู้ใช้",
    user_activated: "คืนสิทธิ์ผู้ใช้",
    trip_cancelled: "ยกเลิกเที่ยวโดยผู้ดูแล",
    settings_changed: "เปลี่ยนการเปิดบริการ",
    admin_granted: "แต่งตั้ง Admin",
    admin_revoked: "ถอนสิทธิ์ Admin",
    profile_reviewed: "ตรวจข้อมูลสมาชิก",
    vehicle_reviewed: "ตรวจข้อมูลรถ",
    private_document_viewed: "เปิดข้อมูลส่วนตัวเพื่อตรวจสอบ",
  };
  return (
    <section className="admin-panel" aria-labelledby="admin-title">
      <p className="eyebrow">
        {role === "root" ? "ผู้ดูแลสูงสุด" : "ผู้ดูแลระบบ"}
      </p>
      <h2 id="admin-title">{role === "root" ? "Root Admin" : "Admin"}</h2>
      {role === "root" && (
        <AdminAccounts csrf={csrf} onChange={() => void load()} />
      )}
      <div className="admin-tabs">
        {(Object.keys(labels) as Tab[])
          .filter((key) => role === "root" || key !== "settings")
          .map((key) => (
            <button
              key={key}
              className="secondary"
              aria-pressed={tab === key}
              disabled={busy}
              onClick={() => setTab(key)}
            >
              {labels[key]}
            </button>
          ))}
        <button
          className="secondary"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          โหลดข้อมูลผู้ดูแลล่าสุด
        </button>
      </div>
      {loading && <p role="status">กำลังโหลดข้อมูลผู้ดูแล…</p>}
      {error && (
        <p role="alert" className="trip-alert">
          {error}
        </p>
      )}
      {tab === "overview" && (
        <div className="admin-kpis">
          {Object.entries(overview).map(([key, value]) => (
            <div key={key}>
              <strong>{value}</strong>
              <span>{kpis[key]}</span>
            </div>
          ))}
        </div>
      )}
      {tab === "settings" && settings && (
        <div className="admin-settings">
          <label>
            <input
              type="checkbox"
              checked={settings.serviceOpen}
              disabled={busy || loading}
              onChange={(e) =>
                setSettings({ ...settings, serviceOpen: e.target.checked })
              }
            />{" "}
            เปิดบริการเที่ยวและคำขอสำหรับผู้ใช้ทั่วไป
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.registrationsOpen}
              disabled={busy || loading}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  registrationsOpen: e.target.checked,
                })
              }
            />{" "}
            เปิดรับสมาชิกใหม่ผ่าน LINE
          </label>
          <p>
            เมื่อปิดบริการ เฉพาะ Root Admin จะจัดการข้อมูลเที่ยวได้
            สมาชิกเดิมยังออกจากระบบได้
          </p>
          <button
            disabled={busy || loading}
            onClick={() => {
              setConfirmSettings(true);
              setReason("");
            }}
          >
            ตรวจและยืนยันการเปิด–ปิดบริการ
          </button>
        </div>
      )}
      {(confirm || confirmSettings) && (
        <div
          className="admin-confirm"
          role="group"
          aria-label="ยืนยันการจัดการ"
        >
          <p>
            {confirm
              ? `${confirm.kind === "role" ? (confirm.role === "admin" ? "แต่งตั้ง Admin" : "ถอนสิทธิ์ Admin") : confirm.kind === "trip" ? "ยกเลิกเที่ยว" : confirm.status === "suspended" ? "ระงับผู้ใช้" : "คืนสิทธิ์ผู้ใช้"}: ${confirm.name}`
              : `ยืนยันบริการ ${settings?.serviceOpen ? "เปิด" : "ปิด"} · สมาชิกใหม่ ${settings?.registrationsOpen ? "เปิด" : "ปิด"}`}
          </p>
          {confirm?.kind === "role" && (
            <p>
              ระบบจะออกจากระบบทุกเซสชันของบัญชีนี้
              ต้องเข้าสู่ระบบใหม่หลังเปลี่ยนสิทธิ์
            </p>
          )}
          {confirm?.kind === "trip" && (
            <p>คำขอที่ยังใช้งานจะถูกยกเลิก และคืนจำนวนที่นั่งที่ตอบรับแล้ว</p>
          )}
          <label>
            เหตุผลการจัดการ (จำเป็น)
            <textarea
              maxLength={300}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button disabled={busy || !reason.trim()} onClick={() => void save()}>
            {busy ? "กำลังบันทึก…" : "ยืนยันและบันทึกประวัติ"}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setConfirm(null);
              setConfirmSettings(false);
            }}
          >
            กลับ
          </button>
        </div>
      )}
      <div className="admin-list">
        {items.map((row) => (
          <article key={row.id}>
            {tab === "users" &&
              (() => {
                const user = row as AdminUser;
                return (
                  <>
                    <h3>
                      {user.displayName}{" "}
                      {user.isRoot ? (
                        <span className="badge">Root Admin</span>
                      ) : user.role === "admin" ? (
                        <span className="badge">Admin</span>
                      ) : null}
                    </h3>
                    <p>
                      {user.status === "active" ? "ใช้งานได้" : "ถูกระงับ"} ·
                      สมัคร {time(user.createdAt)}
                    </p>
                    <p className="field-help">รหัสบัญชี {user.id}</p>
                    {role === "root" &&
                      !user.isRoot &&
                      (user.role === "admin" || user.status === "active") && (
                        <button
                          className="secondary"
                          disabled={busy || loading}
                          onClick={() => {
                            setConfirm({
                              kind: "role",
                              id: user.id,
                              name: user.displayName,
                              version: user.version,
                              role: user.role === "admin" ? "user" : "admin",
                            });
                            setConfirmSettings(false);
                            setReason("");
                          }}
                        >
                          {user.role === "admin"
                            ? "ถอนสิทธิ์ Admin"
                            : "แต่งตั้ง Admin"}
                        </button>
                      )}
                    {!user.isRoot &&
                      (role === "root" || user.role !== "admin") && (
                        <button
                          className="secondary"
                          disabled={busy || loading}
                          onClick={() => {
                            setConfirm({
                              kind: "user",
                              id: user.id,
                              name: user.displayName,
                              version: user.version,
                              status:
                                user.status === "active"
                                  ? "suspended"
                                  : "active",
                            });
                            setConfirmSettings(false);
                            setReason("");
                          }}
                        >
                          {user.status === "active"
                            ? "ระงับผู้ใช้"
                            : "คืนสิทธิ์ผู้ใช้"}
                        </button>
                      )}
                  </>
                );
              })()}
            {tab === "trips" &&
              (() => {
                const trip = row as AdminTrip;
                return (
                  <>
                    <h3>
                      {trip.originProvince} → {trip.destinationProvince}
                    </h3>
                    <p>
                      {time(trip.departureAt)} · เจ้าของ {trip.ownerName}
                    </p>
                    <p>
                      {trip.status === "cancelled"
                        ? "ยกเลิกแล้ว"
                        : Date.parse(trip.departureAt) <= Date.now()
                          ? "ออกเดินทางแล้ว"
                          : "เปิดประกาศ"}{" "}
                      · ตอบรับแล้ว {trip.bookedSeats}/{trip.seats} ที่นั่ง
                    </p>
                    {trip.status === "active" &&
                      Date.parse(trip.departureAt) > Date.now() && (
                        <button
                          className="secondary"
                          disabled={busy || loading}
                          onClick={() => {
                            setConfirm({
                              kind: "trip",
                              id: trip.id,
                              name: `${trip.originProvince} → ${trip.destinationProvince}`,
                              version: trip.version,
                            });
                            setConfirmSettings(false);
                            setReason("");
                          }}
                        >
                          ยกเลิกเที่ยวโดยผู้ดูแล
                        </button>
                      )}
                  </>
                );
              })()}
            {tab === "requests" &&
              (() => {
                const request = row as AdminRequest;
                const status = {
                  pending: "รอตอบรับ",
                  accepted: "ตอบรับแล้ว",
                  rejected: "ปฏิเสธแล้ว",
                  cancelled: "ยกเลิกแล้ว",
                };
                return (
                  <>
                    <h3>
                      {request.originProvince} → {request.destinationProvince}
                    </h3>
                    <p>
                      {request.passengerName} · {request.seats} ที่นั่ง ·{" "}
                      {status[request.status]}
                    </p>
                    <p>{time(request.departureAt)}</p>
                    <p className="field-help">รหัสคำขอ {request.id}</p>
                  </>
                );
              })()}
            {tab === "audit" &&
              (() => {
                const event = row as AdminAudit;
                return (
                  <>
                    <h3>{actions[event.action]}</h3>
                    <p>
                      {event.actorName} · {time(event.createdAt)}
                    </p>
                    <p>เหตุผล: {event.reason}</p>
                    <p className="field-help">
                      รายการ {event.targetType} · {event.targetId}
                    </p>
                  </>
                );
              })()}
          </article>
        ))}
      </div>
      {!loading &&
        !error &&
        ["users", "trips", "requests", "audit"].includes(tab) &&
        !items.length && <p>ยังไม่มีรายการ</p>}
      {cursor && (
        <button
          className="secondary"
          disabled={busy || loading}
          onClick={() => void load(cursor)}
        >
          ดูรายการผู้ดูแลเพิ่มเติม
        </button>
      )}
    </section>
  );
}
