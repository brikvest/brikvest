/** A schema-only publication must not also repair/expire business records. */
export async function runStartupDataMaintenance(operation: () => Promise<unknown>): Promise<void> {
  if (process.env.SKIP_STARTUP_DATA_MAINTENANCE === "true") return;
  await operation();
}