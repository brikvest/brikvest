/** Shared by transports and queue claimers; importing it never opens SMTP or a database. */
export const EMAIL_QUEUE_PAUSE_PROTOCOL = "preclaim-notification-pause-v1";

export function emailDispatchPaused(): boolean {
  return process.env.BRIKVEST_EMAIL_DISPATCH_PAUSED === "true";
}
