import { useEffect, useState } from "react";
import {
  driverLicenseInputSchema,
  consentVersion,
  type DriverLicenseInput,
  bangkokDate,
} from "@coago/contracts";
import { imageForUpload } from "./privateImageUpload";
const blank: DriverLicenseInput = {
  licenseNumber: "",
  licenseClass: "private_car",
  country: "TH",
  expiresOn: "",
  photoId: "",
  version: 0,
  consentVersion,
};
export default function DriverLicenseForm({ csrf }: { csrf: string }) {
  const [value, setValue] = useState(blank),
    [status, setStatus] = useState(""),
    [reason, setReason] = useState(""),
    [ready, setReady] = useState(false),
    [approved, setApproved] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load(signal?: AbortSignal) {
    const [s, r] = await Promise.all([
      fetch("/api/membership/status", {
        signal: signal ?? AbortSignal.timeout(8000),
      }),
      fetch("/api/membership/license", {
        signal: signal ?? AbortSignal.timeout(8000),
      }),
    ]);
    if (!s.ok || !r.ok) throw Error("ยังโหลดใบขับขี่ไม่ได้");
    const state = await s.json(),
      data = await r.json();
    if (signal?.aborted) return;
    setReady(state.storageReady === true);
    setApproved(state.profile?.status === "approved");
    if (data) {
      setValue(
        driverLicenseInputSchema.parse(
          Object.fromEntries(Object.keys(blank).map((k) => [k, data[k]])),
        ),
      );
      setStatus(data.status);
      setReason(data.reviewReason ?? "");
    }
  }
  useEffect(() => {
    const control = new AbortController();
    void load(control.signal).catch(() => {
      if (!control.signal.aborted)
        setMessage("ยังโหลดใบขับขี่ไม่ได้ กรุณาลองใหม่");
    });
    return () => {
      control.abort();
    };
  }, []);
  async function upload(file: File) {
    setBusy(true);
    setMessage("");
    try {
      if (!consent) throw Error("อ่านและยินยอมก่อนอัปโหลดใบขับขี่");
      const blob = await imageForUpload(file);
      const r = await fetch("/api/membership/uploads/license", {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          "X-CSRF-Token": csrf,
          "X-Consent-Version": consentVersion,
        },
        body: blob,
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw Error("อัปโหลดใบขับขี่ไม่ได้");
      const d = await r.json();
      setValue((v) => ({ ...v, photoId: d.id }));
      setMessage("อัปโหลดแล้ว กรุณากดส่งใบขับขี่เพื่อตรวจสอบ");
    } catch (e) {
      setMessage(
        e instanceof Error && /[\u0e00-\u0e7f]/.test(e.message)
          ? e.message
          : "ติดต่อระบบใบขับขี่ไม่ได้ กรุณาลองใหม่",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      if (!consent) throw Error("กรุณายินยอมก่อนส่งใบขับขี่");
      const result = driverLicenseInputSchema.safeParse(value);
      if (!result.success)
        throw Error("กรอกเลขใบขับขี่ ชนิด ประเทศ วันหมดอายุ และแนบรูปให้ครบ");
      const input = result.data;
      if (input.expiresOn < bangkokDate()) throw Error("ใบขับขี่หมดอายุแล้ว");
      const r = await fetch("/api/membership/license", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) {
        const d = await r.json();
        throw Error(
          d.error === "conflict"
            ? "ข้อมูลเปลี่ยน กรุณาโหลดหน้าใหม่"
            : d.error === "member_verification_required"
              ? "ข้อมูลสมาชิกต้องอนุมัติก่อนส่งใบขับขี่"
              : "ส่งใบขับขี่ไม่ได้ กรุณาตรวจข้อมูล",
        );
      }
      await load();
      setMessage("ส่งใบขับขี่แล้ว รอ Root/Admin ตรวจอนุมัติ");
    } catch (e) {
      setMessage(
        e instanceof Error && /[\u0e00-\u0e7f]/.test(e.message)
          ? e.message
          : "ติดต่อระบบใบขับขี่ไม่ได้ กรุณาลองใหม่",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-card" id="driver-license">
      <h2>ใบขับขี่สำหรับผู้แชร์รถ</h2>
      <p>
        ผู้โดยสารไม่ต้องส่งใบขับขี่
        ผู้ขับต้องผ่านการตรวจและใบขับขี่ต้องไม่หมดอายุก่อนวันเดินทาง
        การตรวจเป็นการพิจารณาเอกสารโดยผู้ดูแล
      </p>
      <p>
        สถานะ:{" "}
        {value.expiresOn && value.expiresOn < bangkokDate()
          ? "หมดอายุ"
          : status === "approved"
            ? "อนุมัติแล้ว"
            : status === "pending"
              ? "รอตรวจสอบ"
              : status === "rejected"
                ? "กรุณาแก้ไข"
                : "ยังไม่ส่งใบขับขี่"}{" "}
        {reason}
      </p>
      {!approved && <p>กรุณาส่งข้อมูลสมาชิกและรออนุมัติก่อนส่งใบขับขี่</p>}
      {!ready && <p>ระบบยังไม่พร้อมรับรูปส่วนตัว จึงยังส่งใบขับขี่ไม่ได้</p>}
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        ยินยอมใช้ใบขับขี่เพื่อตรวจความปลอดภัย เฉพาะคุณและผู้ดูแลที่มีสิทธิ์
      </label>
      <div className="form-grid">
        <label>
          เลขใบขับขี่
          <input
            maxLength={30}
            value={value.licenseNumber}
            onChange={(e) =>
              setValue({ ...value, licenseNumber: e.target.value })
            }
          />
        </label>
        <label>
          ชนิดใบขับขี่
          <select
            value={value.licenseClass}
            onChange={(e) =>
              setValue({
                ...value,
                licenseClass: e.target
                  .value as DriverLicenseInput["licenseClass"],
              })
            }
          >
            <option value="private_car">รถยนต์ส่วนบุคคล</option>
            <option value="public_car">รถยนต์สาธารณะ</option>
          </select>
        </label>
        <label>
          ประเทศที่ออกใบขับขี่ (เช่น TH)
          <input
            maxLength={2}
            value={value.country}
            onChange={(e) =>
              setValue({ ...value, country: e.target.value.toUpperCase() })
            }
          />
        </label>
        <label>
          วันหมดอายุ
          <input
            type="date"
            min={bangkokDate()}
            value={value.expiresOn}
            onChange={(e) => setValue({ ...value, expiresOn: e.target.value })}
          />
        </label>
      </div>
      <label>
        รูปใบขับขี่ส่วนตัว
        <input
          type="file"
          accept="image/jpeg,image/png"
          disabled={!ready || !approved || !consent || busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </label>
      {value.photoId && (
        <img
          className="private-preview"
          src={`/api/membership/uploads/${value.photoId}`}
          alt="ใบขับขี่ส่วนตัวของฉัน"
        />
      )}
      <button
        disabled={!ready || !approved || !consent || busy}
        onClick={() => void save()}
      >
        ส่งใบขับขี่เพื่อตรวจสอบ
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
