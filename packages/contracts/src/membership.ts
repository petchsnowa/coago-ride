import { z } from "zod";
import { provinces } from "./trips";
export const consentVersion = "2026-11-11";
export const profileInputSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().regex(/^\+?[0-9]{9,15}$/),
    documentKind: z.enum(["thai_id", "passport"]),
    documentNumber: z.string().trim().toUpperCase().min(6).max(20),
    country: z.string().regex(/^[A-Z]{2}$/),
    portraitId: z.string().uuid(),
    documentId: z.string().uuid(),
    consentVersion: z.literal(consentVersion),
    version: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.documentKind === "thai_id") {
      const n = v.documentNumber;
      if (
        !/^\d{13}$/.test(n) ||
        (11 -
          ([...n.slice(0, 12)].reduce(
            (s, d, i) => s + Number(d) * (13 - i),
            0,
          ) %
            11)) %
          10 !==
          Number(n[12]) ||
        v.country !== "TH"
      )
        c.addIssue({
          code: "custom",
          path: ["documentNumber"],
          message: "เลขบัตรประชาชนไม่ถูกต้อง",
        });
    } else if (!/^[A-Z0-9]{6,20}$/.test(v.documentNumber))
      c.addIssue({
        code: "custom",
        path: ["documentNumber"],
        message: "เลขพาสปอร์ตไม่ถูกต้อง",
      });
  });
export const vehicleInputSchema = z
  .object({
    brand: z.string().trim().min(1).max(50),
    model: z.string().trim().min(1).max(80),
    color: z.string().trim().min(1).max(40),
    plate: z.string().trim().min(2).max(30),
    province: z.enum(provinces),
    seats: z.number().int().min(1).max(8),
    photoId: z.string().uuid(),
    platePhotoId: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const verificationDecisionSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(1).max(300),
    version: z.number().int().positive(),
  })
  .strict();
export const vehicleBrands: Record<string, string[]> = {
  Toyota: [
    "Yaris",
    "Yaris Ativ",
    "Vios",
    "Corolla Altis",
    "Camry",
    "Corolla Cross",
    "Fortuner",
    "Hilux",
  ],
  Honda: ["City", "Jazz", "Civic", "Accord", "HR-V", "CR-V", "BR-V"],
  Suzuki: ["Ciaz", "Swift", "Ertiga", "XL7"],
  Isuzu: ["D-Max", "MU-X"],
  Mitsubishi: ["Attrage", "Mirage", "Xpander", "Pajero Sport", "Triton"],
  Mazda: ["Mazda2", "Mazda3", "CX-3", "CX-30", "CX-5"],
  Nissan: ["Almera", "Note", "Kicks", "Navara", "Terra"],
  Ford: ["Ranger", "Everest"],
  BYD: ["Atto 3", "Dolphin", "Seal"],
  MG: ["MG3", "MG5", "ZS", "HS", "MG4"],
  Tesla: ["Model 3", "Model Y"],
};
export type MemberProfileInput = z.infer<typeof profileInputSchema>;
export type VehicleInput = z.infer<typeof vehicleInputSchema>;

const homeReviewStatus = z.enum(["pending", "approved", "rejected"]);
export const homeSummarySchema = z.object({
  member: z
    .object({ status: homeReviewStatus, portraitId: z.uuid() })
    .nullable(),
  vehicle: z
    .object({
      brand: z.string(),
      model: z.string(),
      color: z.string(),
      status: homeReviewStatus,
      photoId: z.uuid(),
    })
    .nullable(),
});
export type HomeSummary = z.infer<typeof homeSummarySchema>;

export const driverLicenseInputSchema = z
  .object({
    licenseNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9 -]{5,30}$/, "กรุณากรอกเลขใบขับขี่ให้ถูกต้อง"),
    licenseClass: z.enum(["private_car", "public_car"]),
    country: z.string().regex(/^[A-Z]{2}$/),
    expiresOn: z
      .string()
      .regex(/^20\d{2}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !isNaN(Date.parse(v + "T00:00:00Z")) &&
          new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v,
        "วันที่หมดอายุไม่ถูกต้อง",
      ),
    photoId: z.uuid(),
    consentVersion: z.literal(consentVersion),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type DriverLicenseInput = z.infer<typeof driverLicenseInputSchema>;
export function bangkokDate(value: Date | string = new Date()) {
  return new Date(new Date(value).getTime() + 7 * 3600000)
    .toISOString()
    .slice(0, 10);
}
