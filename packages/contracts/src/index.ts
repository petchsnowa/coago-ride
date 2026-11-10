import { z } from "zod";
export const liveSchema = z.object({ status: z.literal("ok") }).strict();
export const readySchema = z
  .object({ status: z.enum(["ready", "unavailable"]) })
  .strict();
export const errorSchema = z
  .object({ error: z.enum(["not_found", "internal_error"]) })
  .strict();

export const authUserSchema = z
  .object({ id: z.string().uuid(), displayName: z.string().min(1).max(256) })
  .strict();
export const authStateSchema = z.union([
  z
    .object({
      user: z.null(),
      csrfToken: z.null(),
      loginAvailable: z.boolean(),
    })
    .strict(),
  z
    .object({
      user: authUserSchema,
      csrfToken: z.string().regex(/^[\da-f]{64}$/),
      loginAvailable: z.literal(true),
    })
    .strict(),
]);
export type AuthState = z.infer<typeof authStateSchema>;

export * from "./trips";
