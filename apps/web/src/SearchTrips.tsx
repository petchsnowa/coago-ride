import RideRequestAction from "./RideRequestAction";
import TripSummaryCard from "./TripSummaryCard";
import { useEffect, useRef, useState } from "react";
import {
  provinces,
  tripSearchSchema,
  publicTripListSchema,
  publicTripResponseSchema,
  toBangkokInput,
  type AuthState,
  type TripSearch,
  type PublicTripSummary,
  type PublicTripDetail,
} from "@coago/contracts";
const time = (value: string) =>
  new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
const money = (value: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
async function get(path: string, signal: AbortSignal) {
  const response = await fetch(path, { credentials: "same-origin", signal });
  if (response.status === 404) throw new Error("trip_not_found");
  if (!response.ok) throw new Error("unavailable");
  return response.json();
}
export default function SearchTrips({
  account = null,
  onRequestChange = () => {},
}: { account?: AuthState | null; onRequestChange?: () => void } = {}) {
  const [form, setForm] = useState({
    originProvince: "",
    destinationProvince: "",
    date: toBangkokInput(new Date().toISOString()).slice(0, 10),
  });
  const [upcoming, setUpcoming] = useState<PublicTripSummary[]>([]),
    [upcomingBusy, setUpcomingBusy] = useState(true),
    [upcomingError, setUpcomingError] = useState("");
  const upcomingRequest = useRef<AbortController | null>(null),
    upcomingSequence = useRef(0);
  async function loadUpcoming() {
    upcomingRequest.current?.abort();
    const controller = new AbortController(),
      current = ++upcomingSequence.current;
    upcomingRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    setUpcoming([]);
    setUpcomingBusy(true);
    setUpcomingError("");
    try {
      const data = publicTripListSchema.parse(
        await get("/api/discovery/trips/upcoming", controller.signal),
      );
      if (current === upcomingSequence.current) setUpcoming(data.trips);
    } catch {
      if (current === upcomingSequence.current)
        setUpcomingError("โหลดรายการเที่ยวไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      clearTimeout(timer);
      if (current === upcomingSequence.current) setUpcomingBusy(false);
    }
  }
  useEffect(() => {
    void loadUpcoming();
    return () => {
      ++upcomingSequence.current;
      upcomingRequest.current?.abort();
    };
  }, []);
  const [applied, setApplied] = useState<TripSearch | null>(null),
    [trips, setTrips] = useState<PublicTripSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<PublicTripDetail | null>(null),
    [detailBusy, setDetailBusy] = useState(false),
    [detailError, setDetailError] = useState("");
  const searchRequest = useRef<AbortController | null>(null),
    detailRequest = useRef<AbortController | null>(null),
    searchSequence = useRef(0),
    detailSequence = useRef(0),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(
    () => () => {
      ++searchSequence.current;
      ++detailSequence.current;
      searchRequest.current?.abort();
      detailRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
  }, [selected]);
  function change(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: "" }));
  }
  async function search(input: TripSearch, after?: string) {
    searchRequest.current?.abort();
    const controller = new AbortController(),
      current = ++searchSequence.current;
    searchRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    setBusy(true);
    setError("");
    if (!after) {
      setTrips([]);
      setCursor(null);
      setApplied(input);
    }
    try {
      const params = new URLSearchParams(input);
      if (after) params.set("cursor", after);
      const data = publicTripListSchema.parse(
        await get(`/api/discovery/trips?${params}`, controller.signal),
      );
      if (current !== searchSequence.current) return;
      setTrips((prev) =>
        after
          ? [
              ...prev,
              ...data.trips.filter((t) => !prev.some((p) => p.id === t.id)),
            ]
          : data.trips,
      );
      setCursor(data.nextCursor);
    } catch {
      if (current === searchSequence.current)
        setError("ค้นหาไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง");
    } finally {
      clearTimeout(timer);
      if (current === searchSequence.current) setBusy(false);
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = tripSearchSchema.safeParse(form);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        errors[String(issue.path[0])] = issue.message;
      setFieldErrors(errors);
      setError("กรุณาเลือกเส้นทางและวันเดินทางให้ครบ");
      document.getElementById(`search-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    setFieldErrors({});
    void search(parsed.data);
  }
  async function openDetail(id: string) {
    detailRequest.current?.abort();
    const controller = new AbortController(),
      current = ++detailSequence.current;
    detailRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    setSelected(id);
    setDetail(null);
    setDetailBusy(true);
    setDetailError("");
    try {
      const data = publicTripResponseSchema.parse(
        await get(`/api/discovery/trips/${id}`, controller.signal),
      );
      if (current === detailSequence.current) setDetail(data.trip);
    } catch (e) {
      if (current === detailSequence.current) {
        if (e instanceof Error && e.message === "trip_not_found") {
          setDetailError(
            "เที่ยวนี้ปิดประกาศหรือออกเดินทางแล้ว กรุณาค้นหาเที่ยวอื่น",
          );
          setTrips((prev) => prev.filter((t) => t.id !== id));
          setUpcoming((prev) => prev.filter((t) => t.id !== id));
        } else setDetailError("โหลดรายละเอียดไม่สำเร็จ กรุณาลองอีกครั้ง");
      }
    } finally {
      clearTimeout(timer);
      if (current === detailSequence.current) setDetailBusy(false);
    }
  }
  function closeDetail() {
    ++detailSequence.current;
    detailRequest.current?.abort();
    setSelected(null);
    setDetail(null);
    setDetailError("");
    setDetailBusy(false);
  }
  const select = (
    key: "originProvince" | "destinationProvince",
    label: string,
  ) => (
    <label className="trip-field" htmlFor={`search-${key}`}>
      <span id={`search-${key}-label`}>{label}</span>
      <select
        id={`search-${key}`}
        aria-labelledby={`search-${key}-label`}
        value={form[key]}
        onChange={(e) => change(key, e.target.value)}
        aria-invalid={!!fieldErrors[key]}
        aria-describedby={fieldErrors[key] ? `search-${key}-error` : undefined}
      >
        <option value="">เลือกจังหวัด</option>
        {provinces.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      {fieldErrors[key] && (
        <span className="field-error" id={`search-${key}-error`}>
          {fieldErrors[key]}
        </span>
      )}
    </label>
  );
  return (
    <section className="discovery" aria-labelledby="search-title">
      <div className="trip-board-heading">
        <div>
          <p className="eyebrow">เส้นทางเดียวกัน ไปด้วยกันได้</p>
          <h1 id="search-title">รายการเที่ยวเดินทาง</h1>
          <p>
            ดูสถานะ เส้นทาง และรายละเอียดเที่ยวได้ทันที · คำขอยังต้องรอตอบรับ
          </p>
        </div>
        <a className="board-search-link" href="#search-form">
          ค้นหาเส้นทางของคุณ ↓
        </a>
      </div>
      {!applied && (
        <section
          className="upcoming-trips"
          aria-labelledby="upcoming-title"
          aria-busy={upcomingBusy}
        >
          <div className="trip-board-subheading">
            <div>
              <h2 id="upcoming-title">เที่ยวที่กำลังจะออกเดินทาง</h2>
              <p>
                เฉพาะเที่ยวที่เปิดประกาศ · เรียงเวลาออกเดินทางใกล้ที่สุดก่อน ·
                แสดงสูงสุด 6 เที่ยว
              </p>
            </div>
            <button
              className="secondary"
              disabled={upcomingBusy}
              onClick={() => void loadUpcoming()}
            >
              โหลดเที่ยวล่าสุด
            </button>
          </div>
          <p role="status" className="upcoming-status">
            {upcomingBusy
              ? "กำลังโหลดรายการเที่ยว…"
              : upcomingError
                ? ""
                : upcoming.length
                  ? `แสดง ${upcoming.length} เที่ยวที่เปิดประกาศ`
                  : "ยังไม่มีเที่ยวเปิดประกาศในขณะนี้ ลองกลับมาตรวจอีกครั้ง"}
          </p>
          {upcomingError && (
            <div role="alert" className="trip-alert">
              <p>{upcomingError}</p>
              <button className="secondary" onClick={() => void loadUpcoming()}>
                ลองโหลดรายการอีกครั้ง
              </button>
            </div>
          )}
          <div className="upcoming-cards">
            {upcoming.map((trip) => (
              <TripSummaryCard
                key={trip.id}
                trip={trip}
                variant="upcoming"
                onDetails={(id) => void openDetail(id)}
              />
            ))}
          </div>
        </section>
      )}
      <div className="search-section-heading">
        <h2>ค้นหาเฉพาะเส้นทาง</h2>
        <p>เลือกจังหวัดและวันเดินทางตามเวลาไทย</p>
        {applied && (
          <button
            className="secondary"
            onClick={() => {
              ++searchSequence.current;
              searchRequest.current?.abort();
              setBusy(false);
              setFieldErrors({});
              setApplied(null);
              setTrips([]);
              setCursor(null);
              setError("");
              void loadUpcoming();
            }}
          >
            กลับไปดูเที่ยวที่กำลังจะออกเดินทาง
          </button>
        )}
      </div>
      <form
        id="search-form"
        className="trip-form search-form"
        onSubmit={submit}
        noValidate
        aria-label="ค้นหาเที่ยวเดินทาง"
      >
        <div className="search-grid">
          {select("originProvince", "ต้นทางที่ต้องการ")}
          {select("destinationProvince", "ปลายทางที่ต้องการ")}
          <label className="trip-field" htmlFor="search-date">
            <span id="search-date-label">วันเดินทาง (เวลาไทย)</span>
            <input
              id="search-date"
              aria-labelledby="search-date-label"
              type="date"
              value={form.date}
              onChange={(e) => change("date", e.target.value)}
              aria-invalid={!!fieldErrors.date}
              aria-describedby={
                fieldErrors.date ? "search-date-error" : undefined
              }
            />
            {fieldErrors.date && (
              <span id="search-date-error" className="field-error">
                {fieldErrors.date}
              </span>
            )}
          </label>
        </div>
        <button type="submit" disabled={busy}>
          {busy ? "กำลังค้นหา…" : "ค้นหาเที่ยว"}
        </button>
      </form>
      {error && (
        <div role="alert" className="trip-alert">
          <p>{error}</p>
          {applied && !Object.keys(fieldErrors).some((k) => fieldErrors[k]) && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void search(
                  applied,
                  trips.length ? (cursor ?? undefined) : undefined,
                )
              }
            >
              ลองค้นหาอีกครั้ง
            </button>
          )}
        </div>
      )}
      <div className="search-results" aria-busy={busy}>
        {applied && (
          <h3>
            ผลค้นหา {applied.originProvince} → {applied.destinationProvince} ·{" "}
            {new Intl.DateTimeFormat("th-TH", {
              dateStyle: "medium",
              timeZone: "Asia/Bangkok",
            }).format(new Date(`${applied.date}T00:00:00+07:00`))}
          </h3>
        )}
        <p role="status" aria-live="polite">
          {busy
            ? "กำลังโหลดเที่ยวที่ยังเปิดประกาศ…"
            : !applied
              ? ""
              : error
                ? ""
                : trips.length
                  ? `แสดง ${trips.length} เที่ยว${cursor ? " · ยังมีรายการเพิ่มเติม" : ""}`
                  : "ไม่พบเที่ยวที่ยังเปิดประกาศสำหรับเส้นทางและวันที่นี้ ลองเปลี่ยนวันหรือจังหวัด"}
        </p>
        <div className="search-cards">
          {trips.map((trip) => (
            <TripSummaryCard
              key={trip.id}
              trip={trip}
              onDetails={(id) => void openDetail(id)}
            />
          ))}
        </div>
        {cursor && !error && (
          <button
            className="secondary more-results"
            disabled={busy}
            onClick={() => applied && void search(applied, cursor)}
          >
            ดูเที่ยวเพิ่มเติม
          </button>
        )}
      </div>
      <dialog
        ref={dialog}
        className="trip-dialog"
        aria-labelledby="detail-title"
        onClose={closeDetail}
      >
        <div className="detail-header">
          <h2 id="detail-title">รายละเอียดเที่ยวเดินทาง</h2>
          <button
            className="secondary"
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            ปิดรายละเอียด
          </button>
        </div>
        {detailBusy && <p role="status">กำลังโหลดรายละเอียด…</p>}
        {detailError && (
          <div role="alert" className="trip-alert">
            <p>{detailError}</p>
            <button
              className="secondary"
              onClick={() => selected && void openDetail(selected)}
            >
              ลองโหลดรายละเอียดอีกครั้ง
            </button>
          </div>
        )}
        {detail && (
          <div className="public-trip-detail">
            <h3>
              {detail.originProvince} → {detail.destinationProvince}
            </h3>
            <p>{time(detail.departureAt)} น. (เวลาไทย)</p>
            <dl className="trip-details">
              <div>
                <dt>จุดรับ</dt>
                <dd>{detail.pickupPoint}</dd>
              </div>
              <div>
                <dt>จุดส่ง</dt>
                <dd>{detail.dropoffPoint}</dd>
              </div>
              <div>
                <dt>ที่นั่งว่างที่ประกาศ</dt>
                <dd>{detail.seats} ที่นั่ง</dd>
              </div>
              <div>
                <dt>ร่วมค่าเดินทาง</dt>
                <dd>{money(detail.contributionSatang)} บาท/คน</dd>
              </div>
              <div>
                <dt>รถ</dt>
                <dd>
                  {detail.vehicleModel} · {detail.vehicleColor}
                </dd>
              </div>
              <div>
                <dt>สัมภาระ</dt>
                <dd>{detail.luggageNotes || "ไม่ได้ระบุ"}</dd>
              </div>
              <div className="detail-conditions">
                <dt>เงื่อนไขร่วมทาง</dt>
                <dd>{detail.conditions || "ไม่ได้ระบุ"}</dd>
              </div>
            </dl>
            <p className="field-help">
              รายละเอียดอาจเปลี่ยนแปลงได้ · คำขอยังไม่ใช่การได้ที่นั่ง ·
              ยังไม่มีการชำระเงิน
            </p>
            <RideRequestAction
              account={account}
              tripId={detail.id}
              onChange={onRequestChange}
            />
            <button
              className="secondary"
              onClick={() => void openDetail(detail.id)}
            >
              ตรวจรายละเอียดล่าสุด
            </button>
          </div>
        )}
      </dialog>
    </section>
  );
}
