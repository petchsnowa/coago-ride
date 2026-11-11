import { z } from "zod";
import { safetyTripSchema } from "./travel-cost";
export const provinces = [
  "กรุงเทพมหานคร",
  "กระบี่",
  "กาญจนบุรี",
  "กาฬสินธุ์",
  "กำแพงเพชร",
  "ขอนแก่น",
  "จันทบุรี",
  "ฉะเชิงเทรา",
  "ชลบุรี",
  "ชัยนาท",
  "ชัยภูมิ",
  "ชุมพร",
  "เชียงราย",
  "เชียงใหม่",
  "ตรัง",
  "ตราด",
  "ตาก",
  "นครนายก",
  "นครปฐม",
  "นครพนม",
  "นครราชสีมา",
  "นครศรีธรรมราช",
  "นครสวรรค์",
  "นนทบุรี",
  "นราธิวาส",
  "น่าน",
  "บึงกาฬ",
  "บุรีรัมย์",
  "ปทุมธานี",
  "ประจวบคีรีขันธ์",
  "ปราจีนบุรี",
  "ปัตตานี",
  "พระนครศรีอยุธยา",
  "พะเยา",
  "พังงา",
  "พัทลุง",
  "พิจิตร",
  "พิษณุโลก",
  "เพชรบุรี",
  "เพชรบูรณ์",
  "แพร่",
  "ภูเก็ต",
  "มหาสารคาม",
  "มุกดาหาร",
  "แม่ฮ่องสอน",
  "ยโสธร",
  "ยะลา",
  "ร้อยเอ็ด",
  "ระนอง",
  "ระยอง",
  "ราชบุรี",
  "ลพบุรี",
  "ลำปาง",
  "ลำพูน",
  "เลย",
  "ศรีสะเกษ",
  "สกลนคร",
  "สงขลา",
  "สตูล",
  "สมุทรปราการ",
  "สมุทรสงคราม",
  "สมุทรสาคร",
  "สระแก้ว",
  "สระบุรี",
  "สิงห์บุรี",
  "สุโขทัย",
  "สุพรรณบุรี",
  "สุราษฎร์ธานี",
  "สุรินทร์",
  "หนองคาย",
  "หนองบัวลำภู",
  "อ่างทอง",
  "อำนาจเจริญ",
  "อุดรธานี",
  "อุตรดิตถ์",
  "อุทัยธานี",
  "อุบลราชธานี",
] as const;
const short = (name: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `กรุณากรอก${name}`)
    .max(max, `${name}ยาวเกิน ${max} ตัวอักษร`);
const fields = {
  safety: safetyTripSchema.optional(),
  originProvince: z.enum(provinces, { error: "กรุณาเลือกจังหวัดต้นทาง" }),
  destinationProvince: z.enum(provinces, { error: "กรุณาเลือกจังหวัดปลายทาง" }),
  departureAt: z
    .string()
    .datetime({ offset: true, error: "กรุณาระบุวันเวลาเดินทางให้ถูกต้อง" }),
  pickupPoint: short("จุดนัดรับ", 200),
  dropoffPoint: short("จุดส่ง", 200),
  seats: z
    .number()
    .int("จำนวนที่นั่งต้องเป็นจำนวนเต็ม")
    .min(1, "เปิดรับอย่างน้อย 1 ที่นั่ง")
    .max(8, "เปิดรับได้ไม่เกิน 8 ที่นั่ง"),
  vehicleModel: short("ยี่ห้อและรุ่นรถ", 80),
  vehicleColor: short("สีรถ", 40),
  contributionSatang: z
    .number({ error: "กรุณากรอกเงินเป็นบาทและสตางค์ไม่เกิน 2 ตำแหน่ง" })
    .int()
    .min(0, "เงินร่วมค่าเดินทางต้องไม่ติดลบ")
    .max(1000000, "เงินร่วมค่าเดินทางไม่เกิน 10,000 บาทต่อคน"),
  luggageNotes: z
    .string()
    .trim()
    .max(200, "รายละเอียดสัมภาระยาวเกิน 200 ตัวอักษร")
    .default(""),
  conditions: z
    .string()
    .trim()
    .max(500, "เงื่อนไขยาวเกิน 500 ตัวอักษร")
    .default(""),
};
const different = (value: {
  originProvince: string;
  destinationProvince: string;
}) => value.originProvince !== value.destinationProvince;
const differentMessage = {
  message: "ต้นทางและปลายทางต้องเป็นคนละจังหวัด",
  path: ["destinationProvince"],
};
export const tripDraftSchema = z
  .object(fields)
  .strict()
  .refine(different, differentMessage);
export const createTripSchema = z
  .object({ ...fields, requestId: z.string().uuid() })
  .strict()
  .refine(different, differentMessage);
export const updateTripSchema = z
  .object({ ...fields, version: z.number().int().positive().max(2147483647) })
  .strict()
  .refine(different, differentMessage);
export const cancelTripSchema = z
  .object({
    version: z.number().int().positive().max(2147483647),
    reason: short("เหตุผลยกเลิก", 500),
  })
  .strict();
export const tripSchema = z
  .object({
    ...fields,
    id: z.string().uuid(),
    version: z.number().int().positive().max(2147483647),
    bookedSeats: z.number().int().min(0).max(8).default(0),
    status: z.enum(["active", "cancelled"]),
    cancellationReason: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const tripResponseSchema = z.object({ trip: tripSchema }).strict();
export const tripListSchema = z
  .object({
    trips: z.array(tripSchema),
    nextCursor: z.string().max(300).nullable(),
  })
  .strict();
export const tripCursorSchema = z
  .object({ id: z.string().uuid(), createdAt: z.string().datetime() })
  .strict();
export type TripDraft = z.infer<typeof tripDraftSchema>;
export type CreateTrip = z.infer<typeof createTripSchema>;
export type UpdateTrip = z.infer<typeof updateTripSchema>;
export type CancelTrip = z.infer<typeof cancelTripSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type TripList = z.infer<typeof tripListSchema>;
export type TripCursor = z.infer<typeof tripCursorSchema>;
export function toBangkokInput(instant: string) {
  const time = Date.parse(instant);
  return Number.isFinite(time)
    ? new Date(time + 7 * 3600000).toISOString().slice(0, 16)
    : "";
}
export function fromBangkokInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
  const time = Date.parse(`${value}:00+07:00`);
  if (!Number.isFinite(time)) return "";
  const iso = new Date(time).toISOString();
  return toBangkokInput(iso) === value ? iso : "";
}
export function bahtToSatang(value: string) {
  value = value.trim();
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value)) return NaN;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function satangToBaht(value: number) {
  return (value / 100).toFixed(2);
}
