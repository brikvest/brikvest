import {afterEach, describe, expect, it, vi} from "vitest";
const database = vi.hoisted(() => ({
  execute: vi.fn(() => {throw new Error("Unexpected queue database access");}),
  transaction: vi.fn(() => {throw new Error("Unexpected queue transaction");}),
}));
vi.mock("../server/db", () => ({db:database}));
import {claimExistingLegalNotification} from "../server/legal/notification-recovery";

afterEach(() => {vi.unstubAllEnvs();vi.clearAllMocks();});
describe("direct notification recovery pause", () => {
  it("does not enter a transaction, claim a job or consume a retry while paused", async () => {
    vi.stubEnv("BRIKVEST_EMAIL_DISPATCH_PAUSED","true");
    for (let tick=0;tick<3;tick++) {
      await expect(claimExistingLegalNotification({
        pairId:60,propertyId:7,jobId:10,cycleId:99,adminId:1,
      })).resolves.toMatchObject({state:"maintenance",jobId:10,cycleId:99});
    }
    expect(database.transaction).not.toHaveBeenCalled();
    expect(database.execute).not.toHaveBeenCalled();
  });
});
