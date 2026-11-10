import { checkRelease } from "./release/check";

try {
  const origin = process.argv[2];
  if (!origin || process.argv.length !== 3)
    throw new Error("EXPECTED_HTTPS_ORIGIN");
  const checks = await checkRelease(origin);
  for (const check of checks)
    console.log(`${check.passed ? "PASS" : "FAIL"} ${check.name}`);
  if (checks.some((check) => !check.passed)) process.exitCode = 1;
  else
    console.log(
      "READ_ONLY_CHECKS_PASSED (does not verify real LINE login, backups or production configuration)",
    );
} catch {
  // Do not echo URLs, response bodies, personal data or unexpected errors.
  console.error(
    "RELEASE_CHECK_FAILED: use pnpm release:check https://your-app-origin",
  );
  process.exitCode = 1;
}
