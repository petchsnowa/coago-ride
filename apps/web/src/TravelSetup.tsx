import { useEffect, useState } from "react";
import { calculateTripCost, type TripDraft } from "@coago/contracts";
import RouteMap, { type Point } from "./RouteMap";
type Safety = NonNullable<TripDraft["safety"]>;
type Vehicle = {
  id: string;
  brand: string;
  model: string;
  color: string;
  status: string;
  seats: number;
  version: number;
};
export default function TravelSetup({
  csrf,
  initial,
  onChange,
  offeredSeats = 1,
}: {
  csrf: string;
  initial?: Safety;
  offeredSeats?: number;
  onChange: (s: Safety | undefined, vehicle?: Vehicle, price?: number) => void;
}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]),
    [vehicleId, setVehicle] = useState(initial?.vehicleId ?? ""),
    [origin, setOrigin] = useState<Point>(
      initial?.origin ?? { lat: 13.7563, lng: 100.5018 },
    ),
    [destination, setDestination] = useState<Point>(
      initial?.destination ?? { lat: 16.4419, lng: 102.835 },
    ),
    [distance, setDistance] = useState(String(initial?.cost.distanceKm ?? 0)),
    [fuel, setFuel] = useState(
      String((initial?.cost.fuelSatangPerKm ?? 300) / 100),
    ),
    [operations, setOperations] = useState(
      String((initial?.cost.operationsSatangPerKm ?? 100) / 100),
    ),
    [extra, setExtra] = useState(
      String((initial?.cost.extraSatang ?? 0) / 100),
    ),
    [shares, setShares] = useState(String(initial?.cost.shares ?? 2)),
    [source, setSource] = useState<"road" | "manual">(
      initial?.distanceSource ?? "manual",
    ),
    [coordinates, setCoordinates] = useState<number[][]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [routeProof, setRouteProof] = useState<string | undefined>(
    initial?.routeProof,
  );
  const cost = {
    distanceKm: Number(distance),
    fuelSatangPerKm: Math.round(Number(fuel) * 100),
    operationsSatangPerKm: Math.round(Number(operations) * 100),
    extraSatang: Math.round(Number(extra) * 100),
    shares: Number(shares),
  };
  let quote: ReturnType<typeof calculateTripCost> | undefined;
  try {
    quote = calculateTripCost(cost);
  } catch {
    /* inline validation below */
  }
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/membership/vehicles", { signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const d = await r.json();
        if (!c.signal.aborted)
          setVehicles(
            d.vehicles.filter((v: Vehicle) => v.status === "approved"),
          );
      })
      .catch(() => {
        if (!c.signal.aborted)
          setMessage("ยังโหลดรถที่อนุมัติไม่ได้ ไปตรวจสถานะในข้อมูลสมาชิก");
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    const v = vehicles.find((v) => v.id === vehicleId);
    if (!quote || !v || Number(shares) < offeredSeats) onChange(undefined);
    else
      onChange(
        {
          vehicleId,
          vehicleVersion: v.version,
          ...(routeProof ? { routeProof } : {}),
          cost,
          origin,
          destination,
          distanceSource: source,
        },
        v,
        quote.pricePerSeatSatang,
      );
  }, [
    vehicleId,
    vehicles,
    origin,
    destination,
    distance,
    fuel,
    operations,
    extra,
    shares,
    source,
    onChange,
    routeProof,
    offeredSeats,
  ]);
  function pick(p: Point, kind: "origin" | "destination") {
    if (kind === "origin") setOrigin(p);
    else setDestination(p);
    setCoordinates([]);
    setRouteProof(undefined);
    setDistance("0");
    setSource("manual");
    setMessage("จุดรับ–ส่งเปลี่ยนแล้ว กรุณาคำนวณระยะทางใหม่");
  }
  async function route() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/membership/route", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ origin, destination }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw Error();
      const d = await r.json();
      setDistance(String(Math.round(d.distanceKm * 100) / 100));
      setSource("road");
      setRouteProof(d.routeProof);
      setCoordinates(d.coordinates);
      setMessage(`เส้นทางตามถนนประมาณ ${Math.round(d.durationMinutes)} นาที`);
    } catch {
      setSource("manual");
      setMessage(
        "บริการคำนวณถนนยังไม่พร้อม ให้กรอกระยะทางที่ตรวจสอบเอง ระบบจะระบุว่าเป็นระยะทางกรอกเอง",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset>
      <legend>รถ แผนที่ และคำนวณค่าเดินทาง</legend>
      <a href="/account">ข้อมูลสมาชิกและรถของฉัน</a>
      <label>
        เลือกรถที่อนุมัติแล้ว
        <select value={vehicleId} onChange={(e) => setVehicle(e.target.value)}>
          <option value="">เลือกรถ</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.brand} {v.model} · {v.color}
            </option>
          ))}
        </select>
      </label>
      <RouteMap
        origin={origin}
        destination={destination}
        onPick={pick}
        coordinates={coordinates}
      />
      {(["origin", "destination"] as const).map((kind) => (
        <div key={kind}>
          <strong>{kind === "origin" ? "จุดรับ" : "จุดส่ง"}</strong>
          {(["lat", "lng"] as const).map((axis) => (
            <label key={axis}>
              {axis === "lat" ? "ละติจูด" : "ลองจิจูด"}
              <input
                type="number"
                step="0.000001"
                min={axis === "lat" ? -85 : -180}
                max={axis === "lat" ? 85 : 180}
                value={(kind === "origin" ? origin : destination)[axis]}
                onChange={(e) =>
                  pick(
                    {
                      ...(kind === "origin" ? origin : destination),
                      [axis]: Number(e.target.value),
                    },
                    kind,
                  )
                }
              />
            </label>
          ))}
        </div>
      ))}
      <button type="button" disabled={busy} onClick={() => void route()}>
        {busy ? "กำลังคำนวณเส้นทาง…" : "คำนวณระยะทางตามถนน"}
      </button>
      {message && <p role="status">{message}</p>}
      <div className="form-grid">
        {[
          ["ระยะทาง (กม.)", distance, setDistance],
          ["ค่าน้ำมันต่อ กม. (บาท)", fuel, setFuel],
          ["ค่าเสื่อมและดำเนินงานต่อ กม. (บาท)", operations, setOperations],
          ["ค่าใช้จ่ายอื่น เช่น ทางด่วน (บาท)", extra, setExtra],
          ["จำนวนส่วนที่หาร รวมส่วนเจ้าของรถถ้ามี", shares, setShares],
        ].map(([label, value, set]) => (
          <label key={String(label)}>
            {String(label)}
            <input
              type="number"
              min="0"
              step={
                label === "จำนวนส่วนที่หาร รวมส่วนเจ้าของรถถ้ามี" ? "1" : "0.01"
              }
              value={value as string}
              onChange={(e) => {
                (set as (s: string) => void)(e.target.value);
                if (set === setDistance) setSource("manual");
              }}
            />
          </label>
        ))}
      </div>
      <p>
        {source === "road"
          ? "ระยะทางตามถนนจากผู้ให้บริการ"
          : "ระยะทางที่เจ้าของกรอกเอง"}
      </p>
      {Number(shares) < offeredSeats && (
        <p role="alert">
          จำนวนส่วนต้องไม่น้อยกว่าที่นั่งที่เปิดรับ
          หากต้องการหารน้อยลงให้ลดจำนวนที่นั่งเปิดรับ
        </p>
      )}
      {quote ? (
        <>
          <p>
            ค่าน้ำมัน {(quote.fuelSatang / 100).toFixed(2)} +
            ค่าเสื่อม/ดำเนินงาน {(quote.operationsSatang / 100).toFixed(2)} +
            ค่าอื่น {Number(extra).toFixed(2)} = รวม{" "}
            {(quote.totalSatang / 100).toFixed(2)} บาท
          </p>
          <strong>
            หาร {quote.shares} ส่วน ={" "}
            {(quote.pricePerSeatSatang / 100).toFixed(2)} บาท/คน
          </strong>
          <p>
            ราคาต่อคนคงที่แม้ร่วมทางไม่เต็ม
            ส่วนที่ยังไม่มีคนร่วมเจ้าของรับผิดชอบ ไม่เรียกเก็บเพิ่มภายหลัง
            ตัวเลขเป็นประมาณการจากอัตราที่เจ้าของระบุ
          </p>
        </>
      ) : (
        <p>กรอกระยะทางมากกว่า 0 และจำนวนส่วนเป็นจำนวนเต็ม 1–9</p>
      )}
    </fieldset>
  );
}
