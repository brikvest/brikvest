# Admin duplicate-investor consolidation

Available from **Admin → User Portfolio → Account consolidation**.
This workflow is deliberately not a general investor-to-investor transfer.

## Supported accounts

Both accounts must be active, approved standalone investors with verified email
and approved KYC. Their legal full name, birth date, government ID type and ID
number must match exactly. Shared first names, approximate names, administrator
assertions alone and unapproved KYC never establish identity. Formatting conflicts
must go through the normal KYC review process separately.

Admins preview the two exact IDs, both identities, holdings, retained certificates
and blockers. They must attest that they reviewed identity evidence, record an
evidence reference and type the exact source-to-destination confirmation. Do not
put full government ID numbers or document contents in the audit note.

Only confirmed existing source reservations can move. No reservation is created,
combined, recalculated or resold. Destination KYC, property inventory, historical
payment rows, unit allocations, financial/valuation snapshots and ownership
certificates remain untouched. Certificates continue to show their original
evidence, not a regenerated owner name.

The optional operational-contact update changes **only the moved reservations'
email** to the destination's existing verified email. It does not change either
account's login email or email verification. Original reservation contacts and
source/destination account contact details remain in the immutable audit. Source
KYC and the original account row remain retained; source login, existing sessions
and password-reset access are disabled.

## Fail-closed boundaries

Any legal history/signing records, resale history/work on either account, unknown
source dependencies, unresolved payments, non-confirmed source reservations,
developer accounts, consolidation chains and stale previews block the operation.
Database legal triggers remain enabled; exceptions roll back the entire operation.
This conservative first version also rejects completed resale/legal dependencies;
it never attempts to rewrite evidence. No mail or other notifications are sent.

The write transaction uses short bounded table locks to exclude legacy writers
that do not participate in a consolidation protocol. Busy systems may return a
retryable unavailable message; preview again rather than weakening safeguards.
An identical request ID and instructions return the original audit reference;
reusing that ID for different instructions is rejected.

## Installation and verification

`scripts/ensure-account-consolidations.sql` is an additive, repeatable schema-only
prerequisite. Apply it explicitly to the intended database after merge under the
normal controlled schema process. It is **not** applied automatically at startup
or by tests. Missing prerequisites return a safe unavailable error.

Implementation and tests must never modify real users. `npm run test:consolidation`
uses only in-memory disposable PGlite and mocked route connections. No live
database connection or migration is required for those checks.
