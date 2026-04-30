import sanitizeHtml from "sanitize-html";

/**
 * Sanitize developer-submitted HTML (project updates, notes, etc).
 * Allows TipTap's standard rich-text output but strips scripts,
 * iframes, event handlers, javascript: URIs, and other XSS vectors.
 *
 * Use this on the SERVER before persisting any HTML that originates
 * from a developer or other untrusted source. Investor dashboards
 * render this HTML via dangerouslySetInnerHTML.
 */
export function sanitizeRichText(input: unknown): string {
  if (typeof input !== "string") return "";
  return sanitizeHtml(input, {
    allowedTags: [
      "p", "br", "strong", "em", "u", "s", "code", "pre", "blockquote",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li",
      "a", "img",
      "hr", "span", "div",
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      span: ["class"],
      div: ["class"],
      "*": [],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      }),
    },
    disallowedTagsMode: "discard",
  });
}

/**
 * Allowlist a list of media URLs to defend against XSS via
 * `javascript:`, `data:`, malformed, or non-string entries.
 *
 * Returns the subset that:
 *   - is a string,
 *   - parses as a valid absolute URL,
 *   - uses an http: or https: scheme.
 */
export function sanitizeMediaUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const u = new URL(trimmed);
      if (u.protocol === "http:" || u.protocol === "https:") {
        out.push(trimmed);
      }
    } catch {
      // ignore unparseable URLs
    }
  }
  return out;
}
