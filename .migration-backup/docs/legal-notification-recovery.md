# Single-request legal email recovery

The canonical public application origin confirmed by the site owner is
`https://brikvest.net`. Set `APP_BASE_URL` only in production; do not replace
SMTP credentials or set the workspace origin to production as a workaround.
Saving configuration does not establish that the published runtime has adopted it.

## Activation checks

Before republishing, confirm the main release contains the startup-maintenance
guard and retain `SKIP_STARTUP_DATA_MAINTENANCE=true`. Do not activate an older
release that ignores this setting: it can run reservation backfills at startup.
The marketplace route-registration path must honor this setting too: its
background offer-expiry and seller-alert retry intervals remain held while
publication recovery is in progress. Authenticated admin routes remain
available. Do not remove the hold to release unrelated queued alerts as part
of this operation.
Retain the existing development and post-merge mutation skips as well. This
operation authorizes no migrations, backfills, financial corrections, document
regeneration or PDF approval.

After publication completes, verify `GET /api/legal/rollout-status` is JSON and
reports:

- `notificationRecoveryProtocol: "exact-existing-notification-v1"`
- `applicationOrigin: "https://brikvest.net"`
- `notificationEmailConfigured: true`
- `pdfReviewSchemaInstalled: true`
- `startupDataMaintenanceSkipped: true`

These are read-only configuration checks; they do not send a readiness email or
prove every older worker instance has drained. The shared dispatch-maintenance
permit continues to apply to recovery, including timed-out SMTP operations.
The generated link is `/dashboard?holding=<existing reservation ID>` on the
validated HTTPS origin, not a public PDF URL.

## Recover the existing request

In the exact property's **Investor documents**, open the selected holding.
When its existing notification job is queued/retrying and both exact PDFs are
approved, use **Recover existing notification**, not resend or global dispatch.
The action submits the displayed existing job and cycle IDs to:

```http
POST /api/admin/legal/pairs/:id/recover-notification
Content-Type: application/json
```

```json
{
  "propertyId": 123,
  "jobId": 456,
  "cycleId": 789,
  "confirmed": true
}
```

IDs above are illustrative fixtures, not instructions to operate on a holding.
Use the authenticated admin UI; never forge an administrator session, change an
administrator password, or copy credentials into scripts.

The server rechecks the active confirmed holding, exact pair/property/job/cycle,
both PDF approvals and outstanding signatures. It claims only a queued/retry job
whose existing `available_at` has elapsed. It never resets backoff or retained
leases (even expired ones), creates a new cycle, regenerates artifacts, or wakes
the general worker. The normal durable send-intent boundary rechecks review and
quarantines unresolved delivery instead of duplicating a send.

The newer land-only consideration safety gate also applies. If neither the
retained purchase snapshot nor both current reviewed document revisions record
land consideration, recovery reports a historical-cost verification blocker
without consuming another retry. URL configuration does not authorize changing
purchase evidence or replacing those PDFs. Resolve verified historical costs
and any necessary document correction under separate authorization and exact-PDF
review; never infer the original purchase costs from today's property settings.

Responses distinguish waiting for retry (with the unchanged eligibility time),
retained leases, maintenance pause, uncertain delivery, terminal blockers and
provider acceptance. A failure retains the job error and existing history;
refresh the holding before trying again. If another admin has moved the job
to a newer cycle, the stale selected cycle is rejected.

## Outcome verification

Confirm the original cycle is `sent` and has its provider-acceptance timestamp,
and inspect the existing attempt/audit history and job completion separately.
A provider-accepted notification is not proof of inbox delivery; spam filtering,
bounces and recipient access require separate evidence. Preserve the document
pair, document identities/hashes, PDF approval, notification history and signatures.

No automatic legal retry scheduling service is introduced here. A queued retry
can remain eligible until this authenticated bounded action or an already
authorized scheduler runs. Do not substitute the global dispatcher, which can
claim unrelated jobs, without separate approval.

## Isolated email-failure regression checks

Run `npx vitest run --config vitest.email.config.ts` for the approved seller-alert
transport-contract correction. Its tests retain the real marketplace email
wrapper and both recovery paths, mocking only SMTP and persistence. They check
that `sendEmail` returning `false` retains failure details, retry/exhaustion
state and claim fencing instead of marking an alert completed. They also check
provider-accepted success and the startup hold. This configuration bypasses the
database-mutating integration setup and cannot contact the live database.