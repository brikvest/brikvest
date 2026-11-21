// Sandbox-only policy. A local timer, missing charge, or absent dashboard entry
// is never provider evidence that an external checkout cannot collect.
export async function recoveryStatus(pg, attempt, exactAmount) {
  const charges = (await pg.query(
    "SELECT * FROM flutterwave_charges WHERE attempt_id=$1 OR tx_ref=$2",
    [attempt.id, attempt.tx_ref],
  )).rows;
  const closure = (await pg.query(
    "SELECT * FROM flutterwave_checkout_closures WHERE attempt_id=$1", [attempt.id],
  )).rows[0];
  const terminal = ["failed", "cancelled"].includes(attempt.state) &&
    !attempt.verified_at && !attempt.provider_transaction_id &&
    charges.length > 0 && charges.every(c =>
      c.attempt_id === attempt.id && c.tx_ref === attempt.tx_ref &&
      ["failed", "cancelled"].includes(c.provider_status) &&
      c.currency === attempt.expected_currency &&
      exactAmount(c.amount, attempt.expected_amount));
  const linkClosed = !!attempt.checkout_url && closure?.status === "done" &&
    closure.checkout_url === attempt.checkout_url;
  return {
    hasSavedLink: !!attempt.checkout_url,
    chargeCount: charges.length,
    resumeAllowed: false,
    canClose: terminal && !!attempt.checkout_url && !linkClosed,
    // Disabling a hosted link prevents new submissions, but does not prove
    // an earlier in-flight submission cannot settle later. The current v3
    // adapter has no provider-backed finality contract permitting deletion.
    resetEligible: false,
    explanation: attempt.verified_at || charges.some(c => c.provider_status === "successful")
      ? "Payment evidence is retained. Do not pay again; this sandbox cannot approve or refund it."
      : !terminal
        ? "Outcome unresolved. A missing dashboard entry, not-found response, or elapsed timer does not prove failure. Recheck receipt; keep this reference and do not pay again."
        : !linkClosed
          ? "The provider verified a failed/cancelled transaction. Disable the saved hosted link with the provider to prevent new submissions; evidence will remain protected and reset unavailable. Do not retry payment."
          : "Provider link closure confirmed. Evidence remains protected: closure and an elapsed deadline do not prove an earlier submission cannot settle later. Reset is unavailable for attempted payments.",
    resumeExplanation: "Same-link resume is unavailable: the v3 transaction checks used here do not establish that reopening a saved hosted link is safe from another collection.",
  };
}
