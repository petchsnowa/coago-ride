import { useLocationAccess } from "./LocationAccess";
import { useEffect, useRef, useState } from "react";
import {
  provinces,
  wantedDraftSchema,
  wantedPostSchema,
  wantedListSchema,
  publicWantedListSchema,
  toBangkokInput,
  fromBangkokInput,
  bahtToSatang,
  type AuthState,
  type TripSearch,
} from "@coago/contracts";
import { tripTime } from "./TripSummaryCard";
const blank = () => ({
  originProvince: "",
  destinationProvince: "",
  from: "",
  until: "",
  seats: "1",
  budget: "",
});
const displayError = (e: unknown) =>
  e instanceof Error && /[\u0e00-\u0e7f]/.test(e.message)
    ? e.message
    : "ติดต่อระบบไม่ได้ กรุณาลองอีกครั้ง";
type Post = ReturnType<typeof wantedPostSchema.parse>;
export default function WantedPanel({
  account,
  onChange,
  onSearch,
}: {
  account: AuthState | null;
  onChange: () => void;
  onSearch: (input: TripSearch) => void;
}) {
  const locationAccess = useLocationAccess();
  const [items, setItems] = useState<
      ReturnType<typeof publicWantedListSchema.parse>["posts"]
    >([]),
    [mine, setMine] = useState<Post[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [mineCursor, setMineCursor] = useState<string | null>(null),
    [form, setForm] = useState(blank),
    [editing, setEditing] = useState<Post | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState(""),
    [approved, setApproved] = useState(false),
    [cancel, setCancel] = useState<Post | null>(null),
    [reason, setReason] = useState("");
  const key = useRef(crypto.randomUUID()),
    active = useRef(true),
    sequence = useRef(0),
    controls = useRef(new Set<AbortController>());
  async function api(path: string, method = "GET", body?: unknown) {
    const c = new AbortController();
    controls.current.add(c);
    try {
      const r = await fetch(path, {
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
              "X-CSRF-Token": account?.csrfToken ?? "",
            }
          : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([c.signal, AbortSignal.timeout(12000)]),
      });
      const d = await r.json();
      if (!r.ok)
        throw Error(
          d.error === "conflict"
            ? "ข้อมูลเปลี่ยน กรุณาโหลดรายการล่าสุด"
            : d.error === "member_verification_required"
              ? "ข้อมูลสมาชิกต้องได้รับอนุมัติก่อนประกาศหารถ"
              : d.error === "wanted_limit"
                ? "มีประกาศหารถที่เปิดอยู่ครบ5รายการแล้ว"
                : "ทำรายการไม่ได้ กรุณาตรวจข้อมูล วันเวลา และสิทธิ์",
        );
      return d;
    } finally {
      controls.current.delete(c);
    }
  }
  async function load(after?: string) {
    const current = ++sequence.current;
    setLoading(true);
    try {
      const d = publicWantedListSchema.parse(
        await api(
          `/api/discovery/wanted${after ? `?cursor=${encodeURIComponent(after)}` : ""}`,
        ),
      );
      if (!active.current || current !== sequence.current) return;
      setItems((p) =>
        after
          ? [...p, ...d.posts.filter((x) => !p.some((y) => x.id === y.id))]
          : d.posts,
      );
      setCursor(d.nextCursor);
    } catch (e) {
      if (active.current && current === sequence.current)
        setMessage(displayError(e));
    } finally {
      if (active.current && current === sequence.current) setLoading(false);
    }
  }
  async function loadMine(after?: string) {
    if (!account?.user) return;
    const d = wantedListSchema.parse(
      await api(
        `/api/wanted/mine${after ? `?cursor=${encodeURIComponent(after)}` : ""}`,
      ),
    );
    if (active.current) {
      setMine((p) =>
        after
          ? [...p, ...d.posts.filter((x) => !p.some((y) => x.id === y.id))]
          : d.posts,
      );
      setMineCursor(d.nextCursor);
    }
  }
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      for (const c of controls.current) c.abort();
    };
  }, []);
  useEffect(() => {
    setMine([]);
    setMineCursor(null);
    setApproved(false);
    setEditing(null);
    setForm(blank());
    key.current = crypto.randomUUID();
    if (!account?.user) return;
    let live = true;
    void loadMine().catch((e) => {
      if (live) setMessage(displayError(e));
    });
    void api("/api/membership/status")
      .then((d) => {
        if (live) setApproved(d.profile?.status === "approved");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [account?.user?.id]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = wantedDraftSchema.safeParse({
        originProvince: form.originProvince,
        destinationProvince: form.destinationProvince,
        departureFrom: fromBangkokInput(form.from),
        departureUntil: fromBangkokInput(form.until),
        seats: Number(form.seats),
        budgetSatang: form.budget === "" ? null : bahtToSatang(form.budget),
      });
      if (!result.success)
        throw Error(
          "ตรวจจังหวัด ช่วงเวลา จำนวนที่นั่ง และงบประมาณให้ครบ (ช่วงเวลาไม่เกิน24ชั่วโมง)",
        );
      const input = result.data;
      if (!(await locationAccess.ensure()))
        throw Error("กรุณาเปิดตำแหน่งก่อนบันทึกประกาศหารถ");
      await api(
        editing ? `/api/wanted/${editing.id}` : "/api/wanted",
        editing ? "PUT" : "POST",
        {
          ...input,
          ...(editing
            ? { version: editing.version }
            : { requestId: key.current }),
        },
      );
      if (!active.current) return;
      setForm(blank());
      setEditing(null);
      key.current = crypto.randomUUID();
      await Promise.all([load(), loadMine()]);
      onChange();
      setMessage("บันทึกประกาศหารถแล้ว ยังไม่ใช่การจองที่นั่ง");
    } catch (e) {
      if (active.current) setMessage(displayError(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function close() {
    if (!cancel || !reason.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/api/wanted/${cancel.id}/cancel`, "POST", {
        version: cancel.version,
        reason: reason.trim(),
      });
      if (!active.current) return;
      setCancel(null);
      setReason("");
      await Promise.all([load(), loadMine()]);
      onChange();
      setMessage("ยกเลิกประกาศหารถแล้ว");
    } catch (e) {
      if (active.current) setMessage(displayError(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const province = (
    label: string,
    k: "originProvince" | "destinationProvince",
  ) => (
    <label>
      {label}
      <select
        value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        required
      >
        <option value="">เลือกจังหวัด</option>
        {provinces.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
    </label>
  );
  return (
    <section
      className="form-card"
      id="wanted-board"
      aria-labelledby="wanted-title"
    >
      <h2 id="wanted-title">ประกาศหารถร่วมทาง</h2>
      <p>
        ผู้โดยสารระบุเส้นทางและช่วงเวลาที่ต้องการเดินทาง
        ประกาศนี้ยังไม่ใช่การจองหรือการยืนยันที่นั่ง
        ไม่มีข้อมูลติดต่อส่วนตัวบนประกาศ
      </p>
      <button
        className="secondary"
        disabled={loading || busy}
        onClick={() => void load()}
      >
        โหลดประกาศหารถล่าสุด
      </button>
      {message && <p role="status">{message}</p>}
      {loading && <p>กำลังโหลดประกาศหารถ…</p>}
      {!loading && !items.length && <p>ยังไม่มีประกาศหารถที่เปิดอยู่</p>}
      <div className="activity-destinations">
        {items.map((p) => (
          <article key={p.id}>
            <h3>
              {p.originProvince} → {p.destinationProvince}
            </h3>
            <p>
              {tripTime(p.departureFrom)} – {tripTime(p.departureUntil)} น.
              (เวลาไทย)
            </p>
            <p>
              ต้องการ {p.seats} ที่นั่ง ·{" "}
              {p.budgetSatang === null
                ? "ยังไม่กำหนดงบ"
                : `งบไม่เกิน ${(p.budgetSatang / 100).toFixed(2)} บาท/คน`}
            </p>
            <button
              className="secondary"
              onClick={() =>
                onSearch({
                  originProvince: p.originProvince,
                  destinationProvince: p.destinationProvince,
                  date: toBangkokInput(p.departureFrom).slice(0, 10),
                })
              }
            >
              ค้นหาเที่ยววันเริ่มช่วงเวลานี้
            </button>
          </article>
        ))}
      </div>
      {cursor && (
        <button
          className="secondary"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          ดูประกาศหารถเพิ่มเติม
        </button>
      )}
      {account?.user ? (
        <>
          <h3>ประกาศหารถของฉัน</h3>
          {!approved && (
            <p>
              กรุณาส่งข้อมูลสมาชิกและรออนุมัติก่อนเผยแพร่ประกาศหารถ{" "}
              <a href="/account">เปิดข้อมูลสมาชิก</a>
            </p>
          )}
          <form
            className="form-grid"
            aria-label="ประกาศหารถใหม่"
            onSubmit={(e) => void save(e)}
          >
            {province("ต้นทางที่ต้องการหารถ", "originProvince")}
            {province("ปลายทางที่ต้องการหารถ", "destinationProvince")}
            <label>
              เดินทางได้ตั้งแต่
              <input
                type="datetime-local"
                required
                value={form.from}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
              />
            </label>
            <label>
              ถึงเวลา (ช่วงไม่เกิน24ชั่วโมง)
              <input
                type="datetime-local"
                required
                value={form.until}
                onChange={(e) => setForm({ ...form, until: e.target.value })}
              />
            </label>
            <label>
              จำนวนที่นั่งที่ต้องการ
              <input
                type="number"
                min="1"
                max="8"
                required
                value={form.seats}
                onChange={(e) => setForm({ ...form, seats: e.target.value })}
              />
            </label>
            <label>
              งบต่อคนไม่เกิน (บาท ไม่บังคับ)
              <input
                type="number"
                min="0"
                max="10000"
                step="0.01"
                value={form.budget}
                onChange={(e) => setForm({ ...form, budget: e.target.value })}
              />
            </label>
            <button disabled={!approved || busy}>
              {editing ? "บันทึกการแก้ไขประกาศหารถ" : "เผยแพร่ประกาศหารถ"}
            </button>
            {editing && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditing(null);
                  setForm(blank());
                }}
              >
                ยกเลิกการแก้ไข
              </button>
            )}
          </form>
          <p className="field-help">
            เปิดได้ครั้งละไม่เกิน5ประกาศ ภายใน90วัน
            ได้เที่ยวแล้วกรุณายกเลิกประกาศหารถของคุณ
          </p>
          {mine.map((p) => (
            <article className="wanted-owned" key={p.id}>
              <h4>
                {p.originProvince} → {p.destinationProvince}
              </h4>
              <p>
                {tripTime(p.departureFrom)} ·{" "}
                {p.status === "cancelled"
                  ? "ยกเลิกแล้ว"
                  : Date.parse(p.departureUntil) <= Date.now()
                    ? "หมดช่วงเวลา"
                    : "เปิดประกาศหารถ"}
              </p>
              {p.status === "active" && (
                <div className="decision-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditing(p);
                      setForm({
                        originProvince: p.originProvince,
                        destinationProvince: p.destinationProvince,
                        from: toBangkokInput(p.departureFrom),
                        until: toBangkokInput(p.departureUntil),
                        seats: String(p.seats),
                        budget:
                          p.budgetSatang === null
                            ? ""
                            : String(p.budgetSatang / 100),
                      });
                    }}
                  >
                    แก้ไขประกาศหารถ
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setCancel(p);
                      setReason("");
                    }}
                  >
                    ยกเลิกประกาศหารถ
                  </button>
                </div>
              )}
            </article>
          ))}
          {mineCursor && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void loadMine(mineCursor).catch((e) =>
                  setMessage(displayError(e)),
                )
              }
            >
              ดูประกาศหารถของฉันเพิ่มเติม
            </button>
          )}
          {cancel && (
            <div className="admin-confirm">
              <label>
                เหตุผลยกเลิกประกาศหารถ
                <textarea
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !reason.trim()}
                onClick={() => void close()}
              >
                ยืนยันยกเลิกประกาศหารถ
              </button>
              <button className="secondary" onClick={() => setCancel(null)}>
                กลับ
              </button>
            </div>
          )}
        </>
      ) : (
        <a href="#my-account">เข้าสู่ระบบเพื่อประกาศหารถ</a>
      )}
    </section>
  );
}
