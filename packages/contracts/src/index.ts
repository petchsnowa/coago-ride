import { z } from "zod";
export const liveSchema = z.object({ status: z.literal("ok") }).strict();
export const readySchema = z
  .object({ status: z.enum(["ready", "unavailable"]) })
  .strict();
export const errorSchema = z
  .object({ error: z.enum(["not_found", "internal_error"]) })
  .strict();
