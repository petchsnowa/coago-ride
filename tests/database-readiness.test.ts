import { expect, it } from "vitest";
import {
  databaseProbeConfig,
  safeDatabaseFailure,
} from "../scripts/database-readiness/config";

const testUrl =
  "postgresql://tester:fixture-only@ep-test-abc.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const productionUrl =
  "postgresql://owner:fixture-only@ep-production-abc.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const env = {
  COAGO_DATABASE_TARGET: "production",
  COAGO_PROJECT_CONFIRMATION: "coago-production",
  COAGO_PRODUCTION_DATABASE_URL: productionUrl,
  COAGO_PRODUCTION_DATABASE_HOST:
    "ep-production-abc.ap-southeast-1.aws.neon.tech",
  COAGO_PRODUCTION_DATABASE_NAME: "neondb",
  COAGO_TEST_DATABASE_URL: testUrl,
};
it("accepts direct TLS test origin and independently pinned production origin", () => {
  expect(
    databaseProbeConfig({
      COAGO_DATABASE_TARGET: "test",
      COAGO_TEST_DATABASE_URL: testUrl,
    }).target,
  ).toBe("test");
  expect(databaseProbeConfig(env).origin.host).toBe(
    env.COAGO_PRODUCTION_DATABASE_HOST,
  );
});
it.each([
  { COAGO_DATABASE_TARGET: "other" },
  { COAGO_PRODUCTION_DATABASE_URL: "" },
  { COAGO_PROJECT_CONFIRMATION: "coago-test" },
  {
    COAGO_PRODUCTION_DATABASE_HOST: "ep-test-abc.ap-southeast-1.aws.neon.tech",
  },
  { COAGO_PRODUCTION_DATABASE_NAME: "wrong" },
  { COAGO_TEST_DATABASE_URL: "" },
  { COAGO_TEST_DATABASE_URL: productionUrl },
  {
    COAGO_PRODUCTION_DATABASE_URL: productionUrl.replace(
      "ep-production",
      "ep-production-pooler",
    ),
  },
  {
    COAGO_PRODUCTION_DATABASE_URL: productionUrl.replace(
      "sslmode=require",
      "sslmode=disable",
    ),
  },
  {
    COAGO_PRODUCTION_DATABASE_URL: productionUrl.replace(
      ".aws.neon.tech",
      ".example.com",
    ),
  },
  {
    COAGO_PRODUCTION_DATABASE_URL: productionUrl.replace(
      "/neondb?",
      ":9999/neondb?",
    ),
  },
])(
  "fails closed when the target/host/database/TLS confirmation is wrong",
  (changes) => {
    expect(() => databaseProbeConfig({ ...env, ...changes })).toThrow();
  },
);
it("never returns raw connection error messages or unvalidated error codes", () => {
  expect(safeDatabaseFailure({ code: "28P01", message: "secret URL" })).toBe(
    "DATABASE_ERROR_28P01",
  );
  expect(
    safeDatabaseFailure({ code: "secret.example", message: "secret URL" }),
  ).toBe("DATABASE_CONNECTION_FAILED");
  expect(safeDatabaseFailure(new Error("secret URL"))).toBe(
    "DATABASE_CONNECTION_FAILED",
  );
});
