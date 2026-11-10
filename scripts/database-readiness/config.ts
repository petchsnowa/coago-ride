import { parseTestOrigin } from "../remote/config";

export function databaseProbeConfig(env: NodeJS.ProcessEnv) {
  const target = env.COAGO_DATABASE_TARGET;
  if (target !== "test" && target !== "production")
    throw new Error("DATABASE_TARGET_REQUIRED");
  const value =
    env[
      target === "test"
        ? "COAGO_TEST_DATABASE_URL"
        : "COAGO_PRODUCTION_DATABASE_URL"
    ];
  if (!value) throw new Error("DATABASE_SECRET_MISSING");
  const origin = parseTestOrigin(value);
  if (origin.port !== 5432) throw new Error("DATABASE_PORT_INVALID");
  if (target === "production") {
    if (env.COAGO_PROJECT_CONFIRMATION !== "coago-production")
      throw new Error("PRODUCTION_PROJECT_CONFIRMATION_REQUIRED");
    if (env.COAGO_PRODUCTION_DATABASE_HOST !== origin.host)
      throw new Error("PRODUCTION_HOST_MISMATCH");
    if (
      !env.COAGO_PRODUCTION_DATABASE_NAME ||
      env.COAGO_PRODUCTION_DATABASE_NAME !== origin.database
    )
      throw new Error("PRODUCTION_DATABASE_NAME_MISMATCH");
    if (!env.COAGO_TEST_DATABASE_URL)
      throw new Error("TEST_DATABASE_REFERENCE_REQUIRED");
    if (parseTestOrigin(env.COAGO_TEST_DATABASE_URL).host === origin.host)
      throw new Error("PRODUCTION_MUST_NOT_USE_TEST_HOST");
  }
  return { target, origin };
}

export function safeDatabaseFailure(error: unknown) {
  if (!error || typeof error !== "object") return "DATABASE_CONNECTION_FAILED";
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  if (/^[A-Z0-9_]{1,12}$/.test(code)) return `DATABASE_ERROR_${code}`;
  return "DATABASE_CONNECTION_FAILED";
}
