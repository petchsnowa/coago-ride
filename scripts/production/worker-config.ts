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
  if (!/^[a-f\d]{40}$/.test(env.GITHUB_SHA ?? ""))
    throw new Error("PRODUCTION_RELEASE_SHA_REQUIRED");
  return {
    origin,
    vars: {
      ENVIRONMENT: "production",
      COAGO_PRODUCTION_OWNER: productionOwner,
      APP_ORIGIN: productionOrigin,
      LINE_CALLBACK_URL: `${productionOrigin}/api/auth/line/callback`,
      LINE_CHANNEL_ID: productionChannelId,
      ALLOWED_ORIGINS: "",
      RELEASE_COMMIT: env.GITHUB_SHA!,
    },
  };
}
