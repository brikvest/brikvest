import type { RequestHandler } from "express";

/** Block Vite workspace/static access before its unauthenticated middleware. */
export const rejectLegalTemplateSourcePaths: RequestHandler = (req, res, next) => {
  let path = req.path;
  try {
    for (let pass = 0; pass < 4; pass++) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
  } catch { return res.status(404).end(); }
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/server/legal/template-assets/") ||
      /\/(?:deed_of_assignment_brikvest|transfer_and_exit_right_agreement)_\d+\.docx$/.test(normalized)) {
    return res.status(404).end();
  }
  next();
};