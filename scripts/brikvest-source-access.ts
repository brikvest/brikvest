import type { IncomingMessage, ServerResponse } from "node:http";

/** Block Vite workspace/static access before its unauthenticated middleware. */
export const rejectLegalTemplateSourcePaths = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
  // Vite uses Connect's IncomingMessage, not Express: req.path/res.status do
  // not exist here. Keep the same source-file boundary on the separate server.
  let path = (req.url || "/").split("?")[0];
  try {
    for (let pass = 0; pass < 4; pass++) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
  } catch { res.statusCode = 404; res.end(); return; }
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/template-assets/") ||
      /\/(?:deed_of_assignment_brikvest|transfer_and_exit_right_agreement)_\d+\.docx$/.test(normalized)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  next();
};