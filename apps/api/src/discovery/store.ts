import { encodeDiscoveryCursor } from "./cursor";
import { and, asc, eq, gt, gte, lt, or, sql } from "drizzle-orm";
import { trips, withDatabase } from "@coago/db";
import {
  bangkokDayRange,
  publicTripSummarySchema,
  publicTripDetailSchema,
  type TripSearch,
  type DiscoveryCursor,
  type PublicTripList,
  type PublicTripDetail,
} from "@coago/contracts";
const summaryColumns = {
  id: trips.id,
  originProvince: trips.originProvince,
  destinationProvince: trips.destinationProvince,
  departureAt: trips.departureAt,
  seats: sql<number>`${trips.seats}-${trips.bookedSeats}`,
  vehicleModel: trips.vehicleModel,
  vehicleColor: trips.vehicleColor,
  contributionSatang: trips.contributionSatang,
};
const available = (now: Date) =>
  and(
    eq(trips.status, "active"),
    gt(trips.departureAt, now),
    lt(trips.bookedSeats, trips.seats),
  );
export interface DiscoveryStore {
  upcoming(now: Date): Promise<PublicTripList>;
  search(
    input: TripSearch,
    now: Date,
    cursor?: DiscoveryCursor,
  ): Promise<PublicTripList>;
  detail(id: string, now: Date): Promise<PublicTripDetail | undefined>;
}
export function postgresDiscoveryStore(url: string): DiscoveryStore {
  return {
    async upcoming(now) {
      return withDatabase(url, async (db) => {
        const rows = await db
          .select(summaryColumns)
          .from(trips)
          .where(available(now))
          .orderBy(asc(trips.departureAt), asc(trips.id))
          .limit(6);
        return {
          trips: rows.map((row) =>
            publicTripSummarySchema.parse({
              ...row,
              departureAt: row.departureAt.toISOString(),
            }),
          ),
          nextCursor: null,
        };
      });
    },
    async search(input, now, cursor) {
      const { start, end } = bangkokDayRange(input.date);
      return withDatabase(url, async (db) => {
        const rows = await db
          .select(summaryColumns)
          .from(trips)
          .where(
            and(
              available(now),
              eq(trips.originProvince, input.originProvince),
              eq(trips.destinationProvince, input.destinationProvince),
              gte(trips.departureAt, start),
              lt(trips.departureAt, end),
              cursor
                ? or(
                    gt(trips.departureAt, new Date(cursor.departureAt)),
                    and(
                      eq(trips.departureAt, new Date(cursor.departureAt)),
                      gt(trips.id, cursor.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(trips.departureAt), asc(trips.id))
          .limit(21);
        const page = rows.slice(0, 20).map((row) =>
            publicTripSummarySchema.parse({
              ...row,
              departureAt: row.departureAt.toISOString(),
            }),
          ),
          last = page.at(-1);
        return {
          trips: page,
          nextCursor:
            rows.length > 20 && last
              ? encodeDiscoveryCursor({
                  ...input,
                  departureAt: last.departureAt,
                  id: last.id,
                })
              : null,
        };
      });
    },
    async detail(id, now) {
      return withDatabase(url, async (db) => {
        const [row] = await db
          .select({
            ...summaryColumns,
            pickupPoint: trips.pickupPoint,
            dropoffPoint: trips.dropoffPoint,
            luggageNotes: trips.luggageNotes,
            conditions: trips.conditions,
          })
          .from(trips)
          .where(and(eq(trips.id, id), available(now)))
          .limit(1);
        return row
          ? publicTripDetailSchema.parse({
              ...row,
              departureAt: row.departureAt.toISOString(),
            })
          : undefined;
      });
    },
  };
}
