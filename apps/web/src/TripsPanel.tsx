import { useLocationAccess } from "./LocationAccess";
import TravelSetup from "./TravelSetup";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  provinces,
  tripDraftSchema,
  tripListSchema,
  tripResponseSchema,
  toBangkokInput,
  fromBangkokInput,
  bahtToSatang,
  satangToBaht,
  type AuthState,
  type Trip,
  type TripDraft,
} from "@coago/contracts";
type Form = {
  originProvince: string;
  destinationProvince: string;
  departureLocal: string;
  pickupPoint: string;
  dropoffPoint: string;
  seats: string;
  vehicleModel: string;
  vehicleColor: string;
  contribution: string;
  luggageNotes: string;
  conditions: string;
};
const blank = (): Form => ({
  originProvince: "",
  destinationProvince: "",
  departureLocal: "",
  pickupPoint: "",
  dropoffPoint: "",
  seats: "1",
  vehicleModel: "",
  vehicleColor: "",
  contribution: "0",
  luggageNotes: "",
  conditions: "",
});
const messages: Record<string, string> = {
  unauthorized: "เซสชันหมดอายุ กรุณารีเฟรชหน้าและเข้าสู่ระบบใหม่",
  forbidden: "สิทธิ์หรือเซสชันเปลี่ยน กรุณารีเฟรชหน้าแล้วลองอีกครั้ง",
  bookings_locked:
    "มีผู้โดยสารที่ตอบรับแล้ว จึงแก้รายละเอียดไม่ได้ หากเปลี่ยนแผนให้ยกเลิกเที่ยวพร้อมเหตุผล",
  trip_conflict: "ประกาศนี้ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง",
  trip_not_editable: "เที่ยวนี้ถูกยกเลิกแล้ว จึงแก้ไขไม่ได้",
  departure_in_past:
    "กรุณาเลือกเวลาในอนาคต เที่ยวที่ออกเดินทางแล้วแก้ไขหรือยกเลิกไม่ได้",
  trip_not_found: "ไม่พบเที่ยวนี้ในบัญชีของคุณ",
  request_reused:
    "คำขอนี้เคยบันทึกแล้ว กรุณาโหลดรายการเพื่อตรวจสอบก่อนสร้างประกาศใหม่",
  invalid_trip: "กรุณาตรวจข้อมูลเที่ยวให้ครบและถูกต้อง",
  shares_below_offered_seats: "จำนวนส่วนที่หารต้องไม่น้อยกว่าที่นั่งที่เปิดรับ",
  road_quote_expired:
    "ผลคำนวณถนนหมดอายุหรือเปลี่ยนแล้ว กรุณาคำนวณระยะทางตามถนนใหม่",
  member_verification_required: "กรุณาส่งข้อมูลสมาชิกและรออนุมัติก่อนใช้งาน",
  vehicle_verification_required: "รถต้องผ่านการตรวจอนุมัติก่อนประกาศเที่ยว",
  service_unavailable: "ระบบยังไม่พร้อม กรุณาลองอีกครั้ง",
};
class ApiError extends Error {
  constructor(public code: string) {
    super(
      messages[code] ?? "ติดต่อระบบไม่สำเร็จ กรุณาตรวจรายการก่อนลองบันทึกซ้ำ",
    );
  }
}
function displayTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}
export default function TripsPanel({
  account,
  revision = 0,
}: {
  account: AuthState | null;
  revision?: number;
}) {
  return account?.user ? (
    <OwnedTrips
      key={account.user.id}
      csrfToken={account.csrfToken}
      revision={revision}
    />
  ) : (
    <section className="trips locked" aria-labelledby="trips-title">
      <p className="eyebrow">เที่ยวเดินทางของฉัน</p>
      <h2 id="trips-title">เปิดที่นั่งว่างให้เพื่อนร่วมทาง</h2>
      <p>เข้าสู่ระบบด้านบนเพื่อประกาศและจัดการเที่ยวของคุณ</p>
    </section>
  );
}
function OwnedTrips({
  csrfToken,
  revision,
}: {
  csrfToken: string;
  revision: number;
}) {
  const location = useLocationAccess();
  const safetyEnabled =
    import.meta.env.VITE_APP_MODE === "production" ||
    import.meta.env.VITE_MEMBER_SAFETY === "true";
  const [safety, setSafety] = useState<TripDraft["safety"]>();
  const safetyChanged = useCallback(
    (
      next: TripDraft["safety"],
      vehicle?: { brand: string; model: string; color: string },
      price?: number,
    ) => {
      setSafety(next);
      if (vehicle && price !== undefined)
        setForm((f) => ({
          ...f,
          vehicleModel: `${vehicle.brand} ${vehicle.model}`,
          vehicleColor: vehicle.color,
          contribution: satangToBaht(price),
        }));
    },
    [],
  );
  const [form, setForm] = useState<Form>(blank),
    [editing, setEditing] = useState<Trip | null>(null),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [trips, setTrips] = useState<Trip[]>([]),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [listError, setListError] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [errorCode, setErrorCode] = useState(""),
    [notice, setNotice] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({});
  const [cancelling, setCancelling] = useState<Trip | null>(null),
    [reason, setReason] = useState(""),
    [now, setNow] = useState(Date.now());
  const active = useRef(true),
    requests = useRef(new Set<AbortController>()),
    sequence = useRef(0),
    formRef = useRef<HTMLFormElement>(null);
  async function api(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    requests.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, {
        ...init,
        credentials: "same-origin",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new ApiError(
          typeof body?.error === "string" ? body.error : "network",
        );
      return body;
    } finally {
      clearTimeout(timer);
      requests.current.delete(controller);
    }
  }
  async function load(cursor?: string) {
    const current = ++sequence.current;
    setLoading(true);
    setListError("");
    try {
      const data = tripListSchema.parse(
        await api(
          `/api/trips/mine${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
      );
      if (!active.current || current !== sequence.current) return;
      setTrips((prev) =>
        cursor
          ? [
              ...prev,
              ...data.trips.filter((t) => !prev.some((p) => p.id === t.id)),
            ]
          : data.trips,
      );
      setNextCursor(data.nextCursor);
    } catch (e) {
      if (active.current && current === sequence.current)
        setListError(
          e instanceof ApiError
            ? e.message
            : "โหลดรายการไม่สำเร็จ กรุณาลองอีกครั้ง",
        );
    } finally {
      if (active.current && current === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    void load();
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      active.current = false;
      clearInterval(clock);
      for (const request of requests.current) request.abort();
    };
  }, []);
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (seenRevision.current !== revision) {
      seenRevision.current = revision;
      void load();
    }
  }, [revision]);
  function field<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFields((prev) => ({ ...prev, [key]: "" }));
    setNotice("");
  }
  function reset() {
    setSafety(undefined);
    setForm(blank());
    setEditing(null);
    setRequestId(crypto.randomUUID());
    setFields({});
    setCancelling(null);
    setReason("");
  }
  function edit(trip: Trip) {
    if (
      trip.status !== "active" ||
      Date.parse(trip.departureAt) <= Date.now()
    ) {
      setError(messages.departure_in_past);
      return;
    }
    setEditing(trip);
    setCancelling(null);
    setSafety(trip.safety);
    setForm({
      originProvince: trip.originProvince,
      destinationProvince: trip.destinationProvince,
      departureLocal: toBangkokInput(trip.departureAt),
      pickupPoint: trip.pickupPoint,
      dropoffPoint: trip.dropoffPoint,
      seats: String(trip.seats),
      vehicleModel: trip.vehicleModel,
      vehicleColor: trip.vehicleColor,
      contribution: satangToBaht(trip.contributionSatang),
      luggageNotes: trip.luggageNotes,
      conditions: trip.conditions,
    });
    setError("");
    setNotice("");
    setFields({});
    document
      .getElementById("trip-form-title")
      ?.scrollIntoView?.({ behavior: "smooth" });
    formRef.current?.querySelector<HTMLSelectElement>("select")?.focus();
  }
  function mutationError(e: unknown) {
    setError(
      e instanceof ApiError
        ? e.message
        : "ไม่ทราบผลการบันทึก กรุณาโหลดรายการเพื่อตรวจสอบ หรือลองบันทึกข้อมูลเดิมซ้ำ",
    );
    setErrorCode(e instanceof ApiError ? e.code : "network");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    setErrorCode("");
    if (safetyEnabled && !safety) {
      setError("กรุณาใช้รถที่อนุมัติแล้ว พร้อมระยะทางและจำนวนส่วนที่หาร");
      return;
    }
    const parsed = tripDraftSchema.safeParse({
      ...(safety ? { safety } : {}),
      originProvince: form.originProvince,
      destinationProvince: form.destinationProvince,
      departureAt: fromBangkokInput(form.departureLocal),
      pickupPoint: form.pickupPoint,
      dropoffPoint: form.dropoffPoint,
      seats: Number(form.seats),
      vehicleModel: form.vehicleModel,
      vehicleColor: form.vehicleColor,
      contributionSatang: bahtToSatang(form.contribution),
      luggageNotes: form.luggageNotes,
      conditions: form.conditions,
    });
    const errors: Record<string, string> = {};
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0]);
        const key =
          name === "departureAt"
            ? "departureLocal"
            : name === "contributionSatang"
              ? "contribution"
              : name;
        errors[key] = issue.message;
      }
    else if (Date.parse(parsed.data.departureAt) <= Date.now())
      errors.departureLocal = "กรุณาเลือกวันเวลาในอนาคต (เวลาไทย)";
    if (Object.keys(errors).length) {
      setFields(errors);
      setError("กรุณาตรวจข้อมูลในช่องที่ระบุ");
      document.getElementById(`trip-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (!(await location.ensure())) {
        if (active.current)
          setError(
            "เปิดใช้ตำแหน่งก่อนบันทึกเที่ยว ตรวจสิทธิ์ตำแหน่งในตั้งค่าเว็บไซต์แล้วลองอีกครั้ง",
          );
        return;
      }
      if (!active.current) return;
      const body = editing
        ? { ...parsed.data, version: editing.version }
        : { ...parsed.data, requestId };
      const result = tripResponseSchema.parse(
        await api(editing ? `/api/trips/${editing.id}` : "/api/trips", {
          method: editing ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify(body),
        }),
      );
      if (!active.current) return;
      setTrips((prev) => [
        result.trip,
        ...prev.filter((t) => t.id !== result.trip.id),
      ]);
      reset();
      setNotice(editing ? "แก้ไขเที่ยวแล้ว" : "บันทึกเที่ยวแล้ว");
      await load();
    } catch (e) {
      if (active.current) mutationError(e);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function cancel(event: React.FormEvent) {
    event.preventDefault();
    if (!cancelling || busy) return;
    if (!reason.trim()) {
      setError("กรุณาระบุเหตุผลยกเลิก");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setErrorCode("");
    try {
      const result = tripResponseSchema.parse(
        await api(`/api/trips/${cancelling.id}/cancel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({
            version: cancelling.version,
            reason: reason.trim(),
          }),
        }),
      );
      if (!active.current) return;
      setTrips((prev) =>
        prev.map((t) => (t.id === result.trip.id ? result.trip : t)),
      );
      setCancelling(null);
      if (editing?.id === result.trip.id) reset();
      setReason("");
      setNotice("ยกเลิกเที่ยวแล้ว");
    } catch (e) {
      if (active.current) mutationError(e);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  function input(
    key: keyof Form,
    label: string,
    options: {
      type?: string;
      maxLength?: number;
      required?: boolean;
      min?: string;
      max?: string;
      step?: string;
      inputMode?: "decimal" | "numeric";
    } = {},
  ) {
    return (
      <label htmlFor={`trip-${key}`} className="trip-field">
        {label}
        <input
          id={`trip-${key}`}
          value={form[key]}
          onChange={(e) => field(key, e.target.value)}
          {...options}
          readOnly={
            safetyEnabled &&
            ["vehicleModel", "vehicleColor", "contribution"].includes(key)
          }
          aria-invalid={!!fields[key]}
          aria-describedby={fields[key] ? `trip-${key}-error` : undefined}
        />
        {fields[key] && (
          <span className="field-error" id={`trip-${key}-error`}>
            {fields[key]}
          </span>
        )}
      </label>
    );
  }
  function province(
    key: "originProvince" | "destinationProvince",
    label: string,
  ) {
    return (
      <label htmlFor={`trip-${key}`} className="trip-field">
        {label}
        <select
          id={`trip-${key}`}
          value={form[key]}
          onChange={(e) => field(key, e.target.value)}
          required
          aria-invalid={!!fields[key]}
          aria-describedby={fields[key] ? `trip-${key}-error` : undefined}
        >
          <option value="">เลือกจังหวัด</option>
          {provinces.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        {fields[key] && (
          <span className="field-error" id={`trip-${key}-error`}>
            {fields[key]}
          </span>
        )}
      </label>
    );
  }
  return (
    <section className="trips" aria-labelledby="trips-title">
      <div className="trips-heading">
        <div>
          <p className="eyebrow">ไปด้วยกันได้อีกหนึ่งเส้นทาง</p>
          <h2 id="trips-title">เที่ยวเดินทางของฉัน</h2>
          <p>ประกาศที่เปิดอยู่จะแสดงในหน้าค้นหา · ยังไม่มีระบบจองที่นั่ง</p>
        </div>
        <span className="badge">เฉพาะบัญชีของคุณ</span>
      </div>
      <form
        ref={formRef}
        onSubmit={save}
        noValidate
        aria-labelledby="trip-form-title"
        className="trip-form"
      >
        <h3 id="trip-form-title">
          {editing ? "แก้ไขเที่ยวเดินทาง" : "ประกาศเที่ยวใหม่"}
        </h3>
        {safetyEnabled && (
          <TravelSetup
            key={editing?.id ?? requestId}
            csrf={csrfToken}
            offeredSeats={Number(form.seats)}
            initial={editing?.safety}
            onChange={safetyChanged}
          />
        )}
        <fieldset disabled={busy}>
          <legend>เส้นทางและเวลา</legend>
          <div className="trip-grid">
            {province("originProvince", "จังหวัดต้นทาง")}
            {province("destinationProvince", "จังหวัดปลายทาง")}
            {input("departureLocal", "วันเวลาออกเดินทาง (เวลาไทย)", {
              type: "datetime-local",
              required: true,
              min: toBangkokInput(new Date(now).toISOString()),
            })}
            {input("seats", "ที่นั่งว่างที่เปิดรับ (1–8 ที่นั่ง)", {
              type: "number",
              required: true,
              min: "1",
              max: "8",
              step: "1",
            })}
            {input("pickupPoint", "จุดนัดรับ", {
              maxLength: 200,
              required: true,
            })}
            {input("dropoffPoint", "จุดส่ง", {
              maxLength: 200,
              required: true,
            })}
          </div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>รถและเงื่อนไขร่วมทาง</legend>
          <p className="field-help">
            ไม่ใส่เบอร์โทร LINE ID หรือทะเบียนรถเต็มในประกาศและเงื่อนไข
            เพราะรายละเอียดเที่ยวที่เปิดอยู่แสดงต่อผู้ค้นหา
          </p>
          <div className="trip-grid">
            {input("vehicleModel", "ยี่ห้อและรุ่นรถ", {
              maxLength: 80,
              required: true,
            })}
            {input("vehicleColor", "สีรถ", { maxLength: 40, required: true })}
            {input("contribution", "เงินร่วมค่าเดินทาง (บาทต่อคน)", {
              inputMode: "decimal",
              maxLength: 8,
              required: true,
            })}
            {input("luggageNotes", "สัมภาระที่รับได้ (ไม่บังคับ)", {
              maxLength: 200,
            })}
          </div>
          <p className="field-help">
            ไม่เก็บเงินให้ใส่ 0 · ทศนิยมได้ 2 ตำแหน่ง · ยังไม่มีการชำระเงินในแอป
          </p>
          <label className="trip-field" htmlFor="trip-conditions">
            เงื่อนไขเพิ่มเติม (ไม่บังคับ)
            <textarea
              id="trip-conditions"
              maxLength={500}
              value={form.conditions}
              onChange={(e) => field("conditions", e.target.value)}
              aria-invalid={!!fields.conditions}
            />
            {fields.conditions && (
              <span className="field-error">{fields.conditions}</span>
            )}
          </label>
        </fieldset>
        <div className="trip-actions">
          <button type="submit" disabled={busy}>
            {busy
              ? "กำลังบันทึก…"
              : editing
                ? "บันทึกการแก้ไข"
                : "บันทึกประกาศเที่ยว"}
          </button>
          {editing && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                reset();
                setError("");
              }}
            >
              ยกเลิกการแก้ไข
            </button>
          )}
        </div>
      </form>
      {error && (
        <div className="trip-alert" role="alert">
          <p>{error}</p>
          {errorCode === "trip_conflict" && (
            <button
              className="secondary"
              onClick={() => {
                reset();
                setError("");
                void load();
              }}
              disabled={busy}
            >
              ยกเลิกการแก้ไขและโหลดใหม่
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="trip-notice" role="status">
          {notice}
        </p>
      )}
      <div className="trip-list-heading">
        <h3>ประกาศของคุณ</h3>
        <button
          type="button"
          className="secondary"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          โหลดรายการใหม่
        </button>
      </div>
      {listError && (
        <p role="alert" className="trip-alert">
          {listError}
        </p>
      )}
      {loading && !trips.length && <p>กำลังโหลดเที่ยวของคุณ…</p>}
      {!loading && !listError && !trips.length && (
        <p className="trip-empty">
          ยังไม่มีประกาศ เริ่มจากเส้นทางที่คุณกำลังจะเดินทาง
        </p>
      )}
      <div className="trip-list">
        {trips.map((trip) => {
          const departed = Date.parse(trip.departureAt) <= now,
            editable = trip.status === "active" && !departed;
          return (
            <article key={trip.id} className={`trip-card ${trip.status}`}>
              <div className="trip-card-top">
                <h4>
                  {trip.originProvince} <span aria-hidden="true">→</span>{" "}
                  {trip.destinationProvince}
                </h4>
                <span className={`trip-status ${trip.status}`}>
                  {trip.status === "cancelled"
                    ? "ยกเลิกแล้ว"
                    : departed
                      ? "ออกเดินทางแล้ว"
                      : "เปิดประกาศ"}
                </span>
              </div>
              <p className="trip-time">
                {displayTime(trip.departureAt)} น. (เวลาไทย)
              </p>
              <dl>
                <div>
                  <dt>จุดรับ</dt>
                  <dd>{trip.pickupPoint}</dd>
                </div>
                <div>
                  <dt>จุดส่ง</dt>
                  <dd>{trip.dropoffPoint}</dd>
                </div>
                <div>
                  <dt>ที่นั่ง</dt>
                  <dd>
                    เปิดทั้งหมด {trip.seats} ที่นั่ง · ตอบรับแล้ว{" "}
                    {trip.bookedSeats} · ว่าง {trip.seats - trip.bookedSeats}
                  </dd>
                </div>
                <div>
                  <dt>ร่วมค่าเดินทาง</dt>
                  <dd>
                    {trip.contributionSatang
                      ? `${new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(trip.contributionSatang / 100)} บาท/คน`
                      : "ไม่เก็บเงิน"}
                  </dd>
                </div>
                <div>
                  <dt>รถ</dt>
                  <dd>
                    {trip.vehicleModel} · {trip.vehicleColor}
                  </dd>
                </div>
                {trip.luggageNotes && (
                  <div>
                    <dt>สัมภาระ</dt>
                    <dd>{trip.luggageNotes}</dd>
                  </div>
                )}
                {trip.conditions && (
                  <div>
                    <dt>เงื่อนไข</dt>
                    <dd>{trip.conditions}</dd>
                  </div>
                )}
              </dl>
              {trip.bookedSeats > 0 && (
                <p className="field-help">
                  มีผู้โดยสารตอบรับแล้ว จึงแก้รายละเอียดไม่ได้
                  หากจำเป็นให้ยกเลิกเที่ยวพร้อมเหตุผล
                </p>
              )}
              {trip.cancellationReason && (
                <p className="cancel-reason">
                  เหตุผลยกเลิก: {trip.cancellationReason}
                </p>
              )}
              {editable && (
                <div className="trip-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || trip.bookedSeats > 0}
                    onClick={() => edit(trip)}
                    aria-label={`แก้ไขเที่ยว ${trip.originProvince} ไป ${trip.destinationProvince}`}
                  >
                    แก้ไข
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      setCancelling(trip);
                      setReason("");
                      setError("");
                    }}
                    aria-label={`ยกเลิกเที่ยว ${trip.originProvince} ไป ${trip.destinationProvince}`}
                  >
                    ยกเลิกเที่ยว
                  </button>
                </div>
              )}
              {cancelling?.id === trip.id && (
                <form
                  className="cancel-form"
                  onSubmit={cancel}
                  aria-label="ยืนยันการยกเลิกเที่ยว"
                >
                  <p>
                    เมื่อยกเลิกแล้วจะเปิดรับในประกาศนี้อีกไม่ได้
                    และคำขอรอตอบรับ/ที่ตอบรับแล้วจะถูกยกเลิกทั้งหมด
                  </p>
                  <label className="trip-field" htmlFor={`cancel-${trip.id}`}>
                    เหตุผลยกเลิก
                    <textarea
                      id={`cancel-${trip.id}`}
                      maxLength={500}
                      required
                      autoFocus
                      disabled={busy}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <div className="trip-actions">
                    <button className="danger" disabled={busy} type="submit">
                      ยืนยันยกเลิกเที่ยว
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      type="button"
                      onClick={() => setCancelling(null)}
                    >
                      กลับ
                    </button>
                  </div>
                </form>
              )}
            </article>
          );
        })}
      </div>
      {nextCursor && (
        <button
          className="secondary load-more"
          disabled={loading || busy}
          onClick={() => void load(nextCursor)}
        >
          {loading ? "กำลังโหลด…" : "โหลดเที่ยวเพิ่มเติม"}
        </button>
      )}
    </section>
  );
}
