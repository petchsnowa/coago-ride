import { useEffect, useState } from "react";
export default function MemberReview({ csrf }: { csrf: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [kind, setKind] = useState<"profiles" | "vehicles">("profiles"),
    [items, setItems] = useState<Record<string, unknown>[]>([]),
    [selected, setSelected] = useState<Record<string, unknown> | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function api(path: string, body?: unknown) {
    const r = await fetch(`/api/membership/review${path}`, {
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
        d.error === "self_review_forbidden"
          ? "ผู้ดูแลอนุมัติข้อมูลของตนเองไม่ได้"
          : d.error === "conflict"
            ? "ข้อมูลเปลี่ยน กรุณาโหลดล่าสุด"
            : "ทำรายการไม่ได้ กรุณาตรวจสิทธิ์หรือการตั้งค่าระบบ",
      );
    return d;
  }
  async function load(after?: string) {
    setSelected(null);
    setReason("");
    const d = await api(
      `/${kind}${after ? `?cursor=${encodeURIComponent(after)}` : ""}`,
    );
    if (!Array.isArray(d.items)) throw Error("โหลดรายการตรวจไม่ได้");
    setItems((prev) =>
      after
        ? [
            ...prev,
            ...d.items.filter(
              (v: { id: string }) => !prev.some((p) => p.id === v.id),
            ),
          ]
        : d.items,
    );
    setCursor(d.nextCursor ?? null);
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, [kind]);
  async function open(id: string) {
    setBusy(true);
    setMessage("");
    try {
      setSelected(await api(`/${kind}/${id}`));
      setReason("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(decision: string) {
    if (!selected || !reason.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await api(`/${kind}/${selected.id}`, {
        decision,
        reason: reason.trim(),
        version: selected.version,
      });
      await load();
      setMessage("บันทึกผลตรวจและประวัติแล้ว");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-panel">
      <h2>ตรวจสมาชิกและรถ</h2>
      <p>
        เปิดข้อมูลเฉพาะเพื่อยืนยันตัวตนและรถ การเปิดดูข้อมูลและผลตรวจมีประวัติ
        ผู้ดูแลตรวจข้อมูลตนเองไม่ได้
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => setKind("profiles")}
      >
        ข้อมูลสมาชิก
      </button>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => setKind("vehicles")}
      >
        ข้อมูลรถ
      </button>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void load().catch((e) => setMessage(e.message))}
      >
        โหลดรายการตรวจล่าสุด
      </button>
      {message && <p role="status">{message}</p>}
      {items.map((item) => (
        <article key={String(item.id)}>
          <p>
            {String(item.id)} · {String(item.status)}{" "}
            {item.last4 ? `เลขท้าย ${item.last4}` : ""}{" "}
            {item.brand ? `${item.brand} ${item.model}` : ""}
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void open(String(item.id))}
          >
            เปิดข้อมูลเพื่อตรวจ
          </button>
        </article>
      ))}
      {cursor && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load(cursor).catch((e) => setMessage(e.message))}
        >
          ดูรายการตรวจเพิ่มเติม
        </button>
      )}
      {selected && (
        <div className="admin-confirm">
          <h3>ข้อมูลตรวจสอบ</h3>
          {Object.entries(selected)
            .filter(([k]) =>
              [
                "fullName",
                "phone",
                "documentKind",
                "documentNumber",
                "country",
                "brand",
                "model",
                "color",
                "plate",
                "province",
                "seats",
                "status",
              ].includes(k),
            )
            .map(([k, v]) => (
              <p key={k}>
                {
                  (
                    {
                      fullName: "ชื่อจริง",
                      phone: "โทรศัพท์",
                      documentKind: "ประเภทหลักฐาน",
                      documentNumber: "เลขเอกสาร",
                      country: "ประเทศ",
                      brand: "ยี่ห้อ",
                      model: "รุ่น",
                      color: "สี",
                      plate: "ทะเบียน",
                      province: "จังหวัด",
                      seats: "ที่นั่ง",
                      status: "สถานะ",
                    } as Record<string, string>
                  )[k]
                }
                : {String(v)}
              </p>
            ))}
          {["portraitId", "documentId", "photoId", "platePhotoId"]
            .filter((k) => selected[k])
            .map((k) => (
              <figure key={k}>
                <figcaption>
                  {
                    (
                      {
                        portraitId: "รูปใบหน้า",
                        documentId: "หลักฐานตัวตน",
                        photoId: "รูปถ่ายรถ",
                        platePhotoId: "รูปทะเบียน",
                      } as Record<string, string>
                    )[k]
                  }
                </figcaption>
                <img
                  className="private-preview"
                  src={`/api/membership/review-file/${selected[k]}`}
                  alt="รูปสำหรับตรวจสอบส่วนตัว"
                />
              </figure>
            ))}
          <label>
            เหตุผลผลตรวจ (จำเป็น)
            <textarea
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !reason.trim()}
            onClick={() => void decide("approved")}
          >
            อนุมัติข้อมูล
          </button>
          <button
            className="secondary"
            disabled={busy || !reason.trim()}
            onClick={() => void decide("rejected")}
          >
            ให้แก้ไขข้อมูล
          </button>
          <button className="secondary" onClick={() => setSelected(null)}>
            ปิดข้อมูลส่วนตัว
          </button>
        </div>
      )}
    </section>
  );
}
