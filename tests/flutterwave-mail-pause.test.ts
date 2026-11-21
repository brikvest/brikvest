import {afterEach, describe, expect, it, vi} from "vitest";
const transport = vi.hoisted(() => ({sendMail:vi.fn()}));
vi.mock("nodemailer", () => ({default:{createTransport:() => transport}}));
import {sendEmail} from "../server/emailService";

afterEach(() => { vi.unstubAllEnvs(); transport.sendMail.mockReset(); });
describe("live preparation application-mail fence", () => {
  it("blocks all application mail without calling SMTP or claiming delivery", async () => {
    vi.stubEnv("BRIKVEST_EMAIL_DISPATCH_PAUSED", "true");
    await expect(sendEmail({to:"fixture@example.test",subject:"Fixture",html:"fixture"})).resolves.toBe(false);
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it("preserves ordinary transport behaviour when the explicit pause is off", async () => {
    vi.stubEnv("BRIKVEST_EMAIL_DISPATCH_PAUSED", "false");
    transport.sendMail.mockResolvedValue({messageId:"fixture"});
    await expect(sendEmail({to:"fixture@example.test",subject:"Fixture",html:"fixture"})).resolves.toBe(true);
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
  });
});
