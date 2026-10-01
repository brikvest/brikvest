import { describe, expect, it } from "vitest";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../server/objectStorage";

describe("legal object privacy", () => {
  const storage = new ObjectStorageService();

  it.each([
    "/objects/legal/signed/final.pdf",
    "/objects/legal-documents/v1/source.docx",
    "/objects/%6cegal/signed/final.pdf",
    "/objects/ordinary/path/legal_private/file.pdf",
  ])("rejects public object access to %s", async (path) => {
    await expect(storage.getObjectEntityFile(path)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("does not search public buckets for legal namespaces", async () => {
    await expect(storage.searchPublicObject("legal/templates/deed.docx"))
      .rejects.toBeInstanceOf(ObjectNotFoundError);
  });
});