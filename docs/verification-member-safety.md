# Verification — member safety, vehicles, maps and staff email

Checked 11 November 2026 on `codex/member-safety-maps`, based on the tree merged by PR #14.

- Frozen lockfile installation, ESLint, TypeScript and production frontend/Workers dry-run build passed.
- 258 unit/API/UI/configuration tests passed.
- 60 Chromium browser checks passed across desktop and mobile, including separate staff email login, disabled document collection without storage, map point selection and fixed-share estimates.
- Existing PostgreSQL/PostGIS integration and Workers suites passed locally. The member-safety suite was repeated after the final image-header validation change and passed against real disposable PostgreSQL/PostGIS and local Workers/R2. Neon Auth responses and routing responses were fixtures, not live external authentication or road-routing acceptance.
- Profile/document ownership, encrypted evidence, staff audit, approved profile/vehicle gates, vehicle capacity/version checks, immutable accepted-trip terms, separate staff cookies, provider-session revocation and password-reset revocation were exercised.
- Migration generation reports no drift; repeated local migrations succeed. Expected application schema: 11 migrations and 13 tables. Historical migrations 0000–0009 remain unchanged.
- Dependency audit reported no known vulnerabilities; `git diff --check` passed.

## Not yet verified on external services

No production deployment/migration, actual email delivery, live managed-auth login, real R2 upload, real routing-key request or billing-plan change was performed for this change. Browser tests use mocked tile/network responses. Existing production LINE login remains unchanged until the reviewed release is deployed.

Before manual testing, follow `admin-email-auth.md` and `member-safety-and-maps.md`: configure the auth provider and Root email, preserve the member encryption key, upgrade the selected database with backup/restore reviewed, and deploy while service/registrations remain closed. R2 is optional for staff-login testing; member evidence submission stays disabled until a private bucket is configured. Do not use actual identity documents in automated tests.
