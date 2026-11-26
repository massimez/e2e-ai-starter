# Security Policy

## Supported Versions

Security fixes are applied to the `main` branch of this template repository. Teams adopting this starter should monitor upstream security commits and run `bun audit` regularly in CI.

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, report vulnerabilities privately through GitHub Security Advisories (or your organization's designated security contact after cloning this template) with:

- A clear description of the vulnerability and affected files/endpoints.
- Reproduction steps or a minimal proof of concept.
- Potential impact and any suggested remediation.

### Response Targets

| Stage | Target SLA |
|---|---|
| Initial acknowledgement | Within 2 business days |
| Triage & severity assessment | Within 5 business days |
| Remediation plan / patch (Critical & High) | Within 14 days |
| Coordinated disclosure | After fix is released and verified |

## Built-In Security Controls

This starter kit implements defense-in-depth technical controls aligned with **ISO/IEC 27001:2022 Annex A** (see [docs/compliance/DATA-LIFECYCLE.md](docs/compliance/DATA-LIFECYCLE.md)):

- **Authentication & Access Control**: Better Auth with hashed Email OTPs, TOTP Multi-Factor Authentication (`twoFactor` plugin + single-use backup codes), configurable session lifetimes (`SESSION_EXPIRES_IN_SECONDS`, `SESSION_UPDATE_AGE_SECONDS`), active session listing & revocation, and dynamic organization RBAC (`hasOrgPermission`).
- **Tenant Isolation**: Strict `tenantBoundaryMiddleware` validating active organization context across headers, params, and query strings; tenant-scoped Drizzle helpers (`withOrg`, `withActiveOrg`); and `${organizationId}:${userId}` Mastra AI memory isolation.
- **Cryptography at Rest & in Transit**: Better Auth native OAuth token encryption (`account.encryptOAuthTokens: true`), AES-256-GCM envelope encryption (`@workspace/shared/crypto`) using HKDF-SHA256 for stored Web Push subscription keys, and fail-fast production enforcement of HTTPS origins and PostgreSQL TLS (`DATABASE_SSL=true` or `sslmode=require`).
- **Immutable Audit Trail**: Append-only `audit_log` protected by a PostgreSQL `BEFORE UPDATE OR DELETE` trigger (`prevent_audit_log_mutation`), automatic mutation/security-denial logging via `auditMiddleware`, and support impersonation attribution (`details.impersonatedBy`).
- **Storage & Network Hardening**: Private S3/R2/MinIO buckets, `HeadObject` MIME/size verification, no-SVG upload guard, SSRF IP blocking for Web Push endpoints, per-request CSP nonces, HSTS/security headers, and Redis-backed rate limiting.
- **Automated Data Retention**: Daily BullMQ retention job (`retention-queue`) pruning expired verifications, invitations, abandoned uploads, old read notifications, and expired audit logs.
