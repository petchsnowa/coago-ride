import { expect, it } from "vitest";
import {
  bootstrapConfig,
  productionHost,
} from "../scripts/production/bootstrap";
const env = {
  COAGO_DATABASE_TARGET: "production",
  COAGO_PROJECT_CONFIRMATION: "coago-production",
  COAGO_BOOTSTRAP_OPERATION: "bootstrap",
  COAGO_PRODUCTION_DATABASE_URL: `postgresql://fixture:fixture-only@${productionHost}/neondb?sslmode=require`,
  COAGO_PRODUCTION_DATABASE_HOST: productionHost,
  COAGO_PRODUCTION_DATABASE_NAME: "neondb",
  COAGO_TEST_DATABASE_URL:
    "postgresql://fixture:fixture-only@ep-test.neon.tech/neondb?sslmode=require",
};
it("accepts only the previously verified production target and explicit operation", () => {
  expect(bootstrapConfig(env).operation).toBe("bootstrap");
  expect(
    bootstrapConfig({ ...env, COAGO_BOOTSTRAP_OPERATION: "check" }).operation,
  ).toBe("check");
});
it.each([
  { COAGO_BOOTSTRAP_OPERATION: "" },
  { COAGO_BOOTSTRAP_OPERATION: "deploy" },
  { COAGO_PROJECT_CONFIRMATION: "coago-test" },
  {
    COAGO_PRODUCTION_DATABASE_URL: env.COAGO_PRODUCTION_DATABASE_URL.replace(
      productionHost,
      "ep-other.neon.tech",
    ),
    COAGO_PRODUCTION_DATABASE_HOST: "ep-other.neon.tech",
  },
  {
    COAGO_PRODUCTION_DATABASE_URL: env.COAGO_PRODUCTION_DATABASE_URL.replace(
      "/neondb",
      "/other",
    ),
    COAGO_PRODUCTION_DATABASE_NAME: "other",
  },
  { COAGO_DATABASE_TARGET: "test" },
])(
  "refuses other targets or unspecified write intent before connecting",
  (changes) => {
    expect(() => bootstrapConfig({ ...env, ...changes })).toThrow();
  },
);
