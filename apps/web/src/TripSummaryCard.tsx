import type { PublicTripSummary } from "@coago/contracts";
export function tripTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}
export default function TripSummaryCard({
  trip,
  onDetails,
  variant = "search",
}: {
  trip: PublicTripSummary;
  onDetails: (id: string) => void;
  variant?: "search" | "upcoming";
}) {
  return (
    <article className={`trip-card ${variant}-card`}>
      <div className="trip-card-top">
        <h3>
          {trip.originProvince} <span aria-hidden="true">→</span>{" "}
          {trip.destinationProvince}
        </h3>
        <span className="trip-status">เปิดประกาศ</span>
      </div>
      <p className="trip-time">{tripTime(trip.departureAt)} น. (เวลาไทย)</p>
      <dl className="trip-details">
        <div>
          <dt>ที่นั่งว่างที่ประกาศ</dt>
          <dd>{trip.seats} ที่นั่ง</dd>
        </div>
        <div>
          <dt>ร่วมค่าเดินทาง</dt>
          <dd>
            {new Intl.NumberFormat("th-TH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(trip.contributionSatang / 100)}{" "}
            บาท/คน
          </dd>
        </div>
        <div>
          <dt>รถ</dt>
          <dd>
            {trip.vehicleModel} · {trip.vehicleColor}
          </dd>
        </div>
      </dl>
      <button
        className="secondary"
        onClick={() => onDetails(trip.id)}
        aria-label={`ดูรายละเอียดเที่ยว ${trip.originProvince} ไป ${trip.destinationProvince} ${tripTime(trip.departureAt)}`}
      >
        ดูรายละเอียดเที่ยว
      </button>
    </article>
  );
}
