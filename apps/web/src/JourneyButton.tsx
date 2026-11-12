import { lazy, Suspense, useState } from "react";
const JourneyDetails = lazy(() => import("./JourneyDetails"));
export default function JourneyButton({
  tripId,
  csrf,
  staff = false,
}: {
  tripId: string;
  csrf: string;
  staff?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="secondary" type="button" onClick={() => setOpen(true)}>
        ดูสถานะการเดินทาง
      </button>
      {open && (
        <Suspense fallback={<p>กำลังเปิดสถานะการเดินทาง…</p>}>
          <JourneyDetails
            tripId={tripId}
            csrf={csrf}
            staff={staff}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
