import NotificationPreferences from "./NotificationPreferences";
import { imageForUpload } from "./privateImageUpload";
import DriverLicenseForm from "./DriverLicenseForm";
import { useEffect, useState } from "react";
import {
  consentVersion,
  profileInputSchema,
  vehicleInputSchema,
  vehicleBrands,
  provinces,
  type AuthState,
  type MemberProfileInput,
  type VehicleInput,
} from "@coago/contracts";
import AuthPanel from "./AuthPanel";
const blankProfile: MemberProfileInput = {
  fullName: "",
  phone: "",
  documentKind: "thai_id" as const,
  documentNumber: "",
  country: "TH",
  portraitId: "",
  documentId: "",
  consentVersion,
  version: 0,
};
const blankVehicle = {
  brand: "Toyota",
  model: "Yaris",
  color: "",
  plate: "",
  province: "กรุงเทพมหานคร" as const,
  seats: 4,
  photoId: "",
  platePhotoId: "",
  version: 0,
};
const status = (s?: string) =>
  ({ pending: "รอตรวจสอบ", approved: "อนุมัติแล้ว", rejected: "ต้องแก้ไข" })[
    s ?? ""
  ] ?? "ยังไม่ส่งข้อมูล";
export default function MemberAccount() {
  const [account, setAccount] = useState<AuthState | null>(null);
  return (
    <main className="member-account-page">
      <nav>
        <a href="/">COAGO</a>
        <a href="/">กลับหน้าผู้ใช้</a>
      </nav>
      <h1>ข้อมูลสมาชิกและรถของฉัน</h1>
      <AuthPanel onAccountChange={setAccount} />
      {account?.user && (
        <AccountForm key={account.user.id} csrf={account.csrfToken} />
      )}
    </main>
  );
}
function AccountForm({ csrf }: { csrf: string }) {
  const [profile, setProfile] = useState<MemberProfileInput>(blankProfile),
    [profileStatus, setProfileStatus] = useState<string>(),
    [profileReason, setProfileReason] = useState(""),
    [vehicle, setVehicle] = useState<VehicleInput>(blankVehicle),
    [vehicleId, setVehicleId] = useState<string>(() => crypto.randomUUID()),
    [vehicles, setVehicles] = useState<
      (VehicleInput & { id: string; status: string; reviewReason?: string })[]
    >([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [message, setMessage] = useState("");
  async function api(path: string, body?: unknown) {
    const r = await fetch(`/api/membership${path}`, {
        method: body ? "PUT" : "GET",
        headers: body
          ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
          : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12000),
      }),
      d = await r.json();
    if (!r.ok)
      throw Error(
        d.error === "conflict"
          ? "ข้อมูลเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่"
          : "ทำรายการไม่ได้ กรุณาตรวจข้อมูลหรือรอระบบพร้อม",
      );
    return d;
  }
  async function load() {
    const [s, p, v] = await Promise.all([
      api("/status"),
      api("/profile"),
      api("/vehicles"),
    ]);
    setReady(s.storageReady);
    if (p) {
      const parsed = profileInputSchema.parse({
        ...Object.fromEntries(Object.keys(blankProfile).map((k) => [k, p[k]])),
        version: p.version,
      });
      setProfile(parsed);
      setProfileStatus(p.status);
      setProfileReason(p.reviewReason ?? "");
    }
    setVehicles(v.vehicles);
  }
  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) setMessage("โหลดข้อมูลไม่ได้ กรุณาลองโหลดหน้าใหม่");
    });
    return () => {
      active = false;
    };
  }, []);
  async function upload(
    file: File | undefined,
    purpose: string,
    set: (id: string) => void,
  ) {
    if (!file || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const blob = await imageForUpload(file),
        r = await fetch(`/api/membership/uploads/${purpose}`, {
          method: "POST",
          headers: {
            "Content-Type": "image/jpeg",
            "X-CSRF-Token": csrf,
            "X-Consent-Version": consentVersion,
          },
          body: blob,
          signal: AbortSignal.timeout(20000),
        });
      if (!r.ok) throw Error("อัปโหลดไม่ได้ กรุณาตรวจที่เก็บรูปหรือขนาดไฟล์");
      set((await r.json()).id);
      setMessage("อัปโหลดรูปแล้ว ต้องกดส่งข้อมูลอีกครั้ง");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(kind: "profile" | "vehicle") {
    setBusy(true);
    setMessage("");
    try {
      if (!consent) throw Error("กรุณาอ่านและยินยอมการใช้ข้อมูลก่อนส่ง");
      if (kind === "profile")
        await api("/profile", profileInputSchema.parse(profile));
      else
        await api(`/vehicles/${vehicleId}`, vehicleInputSchema.parse(vehicle));
      await load();
      if (kind === "vehicle") {
        setVehicle(blankVehicle);
        setVehicleId(crypto.randomUUID());
      }
      setMessage(
        "ส่งข้อมูลแล้ว รอผู้ดูแลตรวจอนุมัติ การแก้ไขข้อมูลต้องตรวจใหม่",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  const file = (
    label: string,
    purpose: string,
    id: string,
    set: (id: string) => void,
  ) => (
    <label>
      {label}
      <input
        type="file"
        accept="image/jpeg,image/png"
        disabled={busy || !ready || !consent}
        onChange={(e) => void upload(e.target.files?.[0], purpose, set)}
      />
      {id && (
        <img
          className="private-preview"
          src={`/api/membership/uploads/${id}`}
          alt={label}
        />
      )}
    </label>
  );
  return (
    <>
      <section className="form-card">
        <h2>สมัครและยืนยันตัวตน</h2>
        <p>
          สถานะ: {status(profileStatus)} {profileReason}
        </p>
        <p>
          ข้อมูลใช้เพื่อตรวจความปลอดภัย เข้าถึงได้เฉพาะคุณและผู้ดูแลที่มีสิทธิ์
          การเปิดดูเอกสารของผู้ดูแลมีประวัติ
          ไม่แสดงเลขบัตรหรือพาสปอร์ตบนประกาศเที่ยว
          การตรวจเป็นการตรวจเอกสารโดยผู้ดูแล ไม่ใช่การรับรองจากหน่วยงานรัฐ
        </p>
        <label>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          ยินยอมใช้ข้อมูลและรูปเพื่อตรวจตัวตนและรถ รุ่นคำยินยอม {consentVersion}
        </label>
        {!ready && (
          <p role="alert">ระบบยังไม่พร้อมรับรูปส่วนตัว ขณะนี้ยังไม่รับเอกสาร</p>
        )}
        <div className="form-grid">
          <label>
            ชื่อ–นามสกุลจริง
            <input
              value={profile.fullName}
              maxLength={120}
              onChange={(e) =>
                setProfile({ ...profile, fullName: e.target.value })
              }
            />
          </label>
          <label>
            หมายเลขโทรศัพท์
            <input
              type="tel"
              value={profile.phone}
              onChange={(e) =>
                setProfile({ ...profile, phone: e.target.value })
              }
            />
          </label>
          <label>
            ประเภทหลักฐาน
            <select
              value={profile.documentKind}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  documentKind: e.target.value as typeof profile.documentKind,
                  documentNumber: "",
                })
              }
            >
              <option value="thai_id">บัตรประชาชนไทย</option>
              <option value="passport">พาสปอร์ต</option>
            </select>
          </label>
          <label>
            เลขบัตรประชาชน / พาสปอร์ต
            <input
              autoComplete="off"
              value={profile.documentNumber}
              maxLength={20}
              onChange={(e) =>
                setProfile({ ...profile, documentNumber: e.target.value })
              }
            />
          </label>
          <label>
            รหัสประเทศ 2 ตัว เช่น TH
            <input
              value={profile.country}
              maxLength={2}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  country: e.target.value.toUpperCase(),
                })
              }
            />
          </label>
        </div>
        {file("รูปถ่ายใบหน้าปัจจุบัน", "portrait", profile.portraitId, (id) =>
          setProfile((p) => ({ ...p, portraitId: id })),
        )}
        {file("รูปเอกสารยืนยันตัวตน", "document", profile.documentId, (id) =>
          setProfile((p) => ({ ...p, documentId: id })),
        )}
        <button
          disabled={busy || !ready || !consent}
          onClick={() => void save("profile")}
        >
          ส่งข้อมูลสมาชิกเพื่อตรวจสอบ
        </button>
      </section>
      <DriverLicenseForm csrf={csrf} />
      <NotificationPreferences csrf={csrf} />
      <section className="form-card" id="my-vehicles">
        <h2>รถของฉัน</h2>
        <p>
          บันทึกครั้งเดียวแล้วเลือกใช้ตอนประกาศเที่ยว แก้ไขรถแล้วต้องรอตรวจใหม่
          ไม่เปลี่ยนข้อมูลเที่ยวที่ประกาศไปแล้ว
          รูปถ่ายรถให้สมาชิกที่ผ่านการตรวจดูได้
          ส่วนรูปเอกสารและป้ายทะเบียนใช้ตรวจส่วนตัว
        </p>
        {vehicles.map((v) => (
          <article key={v.id}>
            <h3>
              {v.brand} {v.model} · {v.color}
            </h3>
            <p>
              {v.plate} {v.province} · {status(v.status)} {v.reviewReason}
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setVehicleId(v.id);
                setVehicle(
                  Object.fromEntries(
                    Object.keys(blankVehicle).map((k) => [
                      k,
                      v[k as keyof typeof v],
                    ]),
                  ) as VehicleInput,
                );
              }}
            >
              แก้ไขข้อมูลรถ
            </button>
          </article>
        ))}
        <h3>{vehicle.version ? "แก้ไขรถ" : "เพิ่มรถ"}</h3>
        <div className="form-grid">
          <label>
            ยี่ห้อ
            <input
              list="vehicle-brands"
              value={vehicle.brand}
              maxLength={50}
              onChange={(e) =>
                setVehicle({ ...vehicle, brand: e.target.value })
              }
            />
            <datalist id="vehicle-brands">
              {Object.keys(vehicleBrands).map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label>
            รุ่น
            <input
              list="vehicle-models"
              value={vehicle.model}
              maxLength={80}
              onChange={(e) =>
                setVehicle({ ...vehicle, model: e.target.value })
              }
            />
            <datalist id="vehicle-models">
              {(vehicleBrands[vehicle.brand] ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label>
            สี
            <input
              value={vehicle.color}
              maxLength={40}
              onChange={(e) =>
                setVehicle({ ...vehicle, color: e.target.value })
              }
            />
          </label>
          <label>
            เลขทะเบียน
            <input
              value={vehicle.plate}
              maxLength={30}
              onChange={(e) =>
                setVehicle({ ...vehicle, plate: e.target.value })
              }
            />
          </label>
          <label>
            จังหวัดทะเบียน
            <select
              value={vehicle.province}
              onChange={(e) =>
                setVehicle({
                  ...vehicle,
                  province: e.target.value as typeof vehicle.province,
                })
              }
            >
              {provinces.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            จำนวนที่นั่งผู้โดยสาร
            <input
              type="number"
              min="1"
              max="8"
              value={vehicle.seats}
              onChange={(e) =>
                setVehicle({ ...vehicle, seats: Number(e.target.value) })
              }
            />
          </label>
        </div>
        {file("รูปถ่ายรถ", "vehicle", vehicle.photoId, (id) =>
          setVehicle((v) => ({ ...v, photoId: id })),
        )}
        {file("รูปป้ายทะเบียน", "plate", vehicle.platePhotoId, (id) =>
          setVehicle((v) => ({ ...v, platePhotoId: id })),
        )}
        <button
          disabled={busy || !ready || !consent}
          onClick={() => void save("vehicle")}
        >
          ส่งข้อมูลรถเพื่อตรวจสอบ
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setVehicle(blankVehicle);
            setVehicleId(crypto.randomUUID());
          }}
        >
          เพิ่มรถคันใหม่
        </button>
      </section>
      {message && <p role="status">{message}</p>}
    </>
  );
}
