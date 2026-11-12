import { adminProvider } from "../../apps/api/src/admin-auth/provider";
import { bootstrapConfig } from "./bootstrap";
export const productionWorker = "coago-production";
export const productionOwner = "petchsnowa/coago-ride:production";
export const productionHyperdriveId = "2e437b2ff82c46b99963380be05335f0";
export const productionChannelId = "2009685358";
export const productionOrigin = "https://coago.space";
export function productionWorkerSettings(env: NodeJS.ProcessEnv) {
  const { origin } = bootstrapConfig({
    ...env,
    COAGO_BOOTSTRAP_OPERATION: "check",
  });
  if (env.CLOUDFLARE_ACCOUNT_ID !== "ca1d36a602c74e57ebacaf8676da3eeb")
    throw new Error("PRODUCTION_ACCOUNT_MISMATCH");
  if (env.COAGO_PRODUCTION_HYPERDRIVE_ID !== productionHyperdriveId)
    throw new Error("PRODUCTION_HYPERDRIVE_ID_MISMATCH");
  if (env.LINE_CHANNEL_ID !== productionChannelId)
    throw new Error("PRODUCTION_LINE_CHANNEL_MISMATCH");
  if (!env.LINE_CHANNEL_SECRET)
    throw new Error("PRODUCTION_LINE_SECRET_MISSING");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.ROOT_ADMIN_EMAIL ?? ""))
    throw new Error("PRODUCTION_ROOT_EMAIL_REQUIRED");
  try {
    adminProvider({
      NEON_ADMIN_AUTH_URL: env.NEON_ADMIN_AUTH_URL,
      ROOT_ADMIN_EMAIL: env.ROOT_ADMIN_EMAIL,
    });
  } catch {
    throw new Error("PRODUCTION_ADMIN_AUTH_REQUIRED");
  }
  if (
    !env.MEMBER_DATA_KEY ||
    Buffer.from(env.MEMBER_DATA_KEY, "base64").length !== 32
  )
    throw new Error("PRODUCTION_PRIVATE_DATA_KEY_REQUIRED");
  if (
    env.COAGO_PRIVATE_DOCUMENTS_BUCKET &&
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(
      env.COAGO_PRIVATE_DOCUMENTS_BUCKET ?? "",
    )
  )
    throw new Error("PRODUCTION_PRIVATE_BUCKET_REQUIRED");
  if (!/^[a-f\d]{40}$/.test(env.GITHUB_SHA ?? ""))
    throw new Error("PRODUCTION_RELEASE_SHA_REQUIRED");
  if (
    env.LINE_MESSAGING_ENABLED === "true" &&
    (!env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ||
      env.LINE_MESSAGING_PROVIDER_CONFIRMED !== "true")
  )
    throw new Error("PRODUCTION_MESSAGING_CONFIGURATION_REQUIRED");
  return {
    origin,
    vars: {
      ENVIRONMENT: "production",
      LINE_MESSAGING_ENABLED:
        env.LINE_MESSAGING_ENABLED === "true" ? "true" : "false",
      LINE_MESSAGING_PROVIDER_CONFIRMED:
        env.LINE_MESSAGING_PROVIDER_CONFIRMED === "true" ? "true" : "false",
      NEON_ADMIN_AUTH_URL: env.NEON_ADMIN_AUTH_URL,
      COAGO_PRODUCTION_OWNER: productionOwner,
      APP_ORIGIN: productionOrigin,
      LINE_CALLBACK_URL: `${productionOrigin}/api/auth/line/callback`,
      LINE_CHANNEL_ID: productionChannelId,
      ALLOWED_ORIGINS: "",
      RELEASE_COMMIT: env.GITHUB_SHA!,
    },
  };
}
