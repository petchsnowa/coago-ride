import { sql } from "drizzle-orm";
import { withDatabase } from "@coago/db";
import { publicActivitySchema } from "@coago/contracts";
import { available } from "./store";
/** Public aggregate only: use the same visibility as discovery, never disclose passenger records. */
export async function publicActivity(
  url: string,
  enforceSafety: boolean,
  now: Date,
) {
  return withDatabase(url, async (db) => {
    const result = await db.execute(sql`
      WITH visible AS (
        SELECT trips.id, trips.destination_province AS province, trips.departure_at,
          trips.seats_offered-trips.seats_booked AS seats, trips.safety->>'vehicleId' AS car_id
        FROM trips WHERE ${available(now, enforceSafety)}
      ), pending AS (
        SELECT r.trip_id, count(*)::int AS requests
        FROM ride_requests r JOIN visible v ON v.id=r.trip_id
        JOIN users u ON u.id=r.passenger_id AND u.status='active'
        WHERE r.status='pending'
          ${enforceSafety ? sql`AND EXISTS(SELECT 1 FROM member_profiles p WHERE p.user_id=r.passenger_id AND p.status='approved')` : sql``}
        GROUP BY r.trip_id
      ), wanted AS (
        SELECT w.destination_province AS province,w.seats FROM wanted_posts w JOIN users u ON u.id=w.owner_id AND u.status='active' JOIN member_profiles p ON p.user_id=w.owner_id AND p.status='approved' WHERE w.status='active' AND w.departure_until>${now}
      ), destinations AS (
        SELECT v.province, count(*)::int AS trips, count(DISTINCT v.car_id)::int AS vehicles,
          sum(v.seats)::int AS seats, coalesce(sum(p.requests),0)::int AS requests,
          (array_agg(v.id ORDER BY v.departure_at,v.id))[1] AS next_id, min(v.departure_at) AS next_departure
        FROM visible v LEFT JOIN pending p ON p.trip_id=v.id GROUP BY v.province
      )
      SELECT jsonb_build_object(
        'updatedAt', ${now.toISOString()}::text,
        'totals', (SELECT jsonb_build_object('trips',count(*)::int,'vehicles',count(DISTINCT v.car_id)::int,
          'seats',coalesce(sum(v.seats),0)::int,'pendingRequests',coalesce(sum(p.requests),0)::int,'wantedPosts',(SELECT count(*)::int FROM wanted))
          FROM visible v LEFT JOIN pending p ON p.trip_id=v.id),
        'wantedDestinations',coalesce((SELECT jsonb_agg(jsonb_build_object('province',province,'posts',posts,'seats',seats) ORDER BY posts DESC,province) FROM (SELECT province,count(*)::int AS posts,sum(seats)::int AS seats FROM wanted GROUP BY province) w),'[]'::jsonb),
        'destinations', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'province',d.province,'trips',d.trips,'vehicles',d.vehicles,'seats',d.seats,
          'pendingRequests',d.requests,'nextTripId',d.next_id,
          'nextDepartureAt',to_char(d.next_departure AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          ORDER BY d.trips DESC,d.province) FROM destinations d),'[]'::jsonb)
      ) AS activity
    `);
    return publicActivitySchema.parse(result.rows[0].activity);
  });
}
