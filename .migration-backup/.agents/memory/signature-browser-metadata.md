---
name: Browser signature PNG colour metadata
description: Accept bounded browser colour metadata without interpreting profiles or changing signature evidence.
---

Signature PNG validation must accommodate browser-added colour-profile metadata,
while the PDF renderer receives only verified pixel data. Keep the original
signature bytes and hash as the signing evidence.

For new submissions, encode a canonical RGBA PNG directly from canvas pixels
instead of relying on native browser PNG export.

**Why:** An iPhone signing attempt still hit the unsupported-chunk error after
colour-profile compatibility was added. The exact rejected chunk was not
captured, so widening the server allowlist again would be guesswork. A pixel-only
export avoids platform-specific metadata without weakening server validation.

**How to apply:** Check PNG framing, CRC, dimensions, pixel format and visible
ink before embedding. Strip permitted metadata before decoding and rendering,
without relaxing animation, text, unknown-chunk, corruption or allocation limits.
Do not substitute the normalized image hash for the consented original hash.
Exercise the real server image validator against PNGs submitted by browser
tests for both typed and drawn signatures. Include a test that disables native
canvas PNG export, so a future refactor cannot silently reintroduce it.