---
name: Browser signature PNG colour metadata
description: Accept bounded browser colour metadata without interpreting profiles or changing signature evidence.
---

Signature PNG validation must accommodate browser-added colour-profile metadata,
while the PDF renderer receives only verified pixel data. Keep the original
signature bytes and hash as the signing evidence.

**Why:** A signing attempt from an iPhone hit an unsupported-chunk error.
Rejecting all colour profiles blocks ordinary browser exports; trusting or
inflating arbitrary profiles is unnecessary for a monochrome signature.

**How to apply:** Check PNG framing, CRC, dimensions, pixel format and visible
ink before embedding. Strip permitted metadata before decoding and rendering,
without relaxing animation, text, unknown-chunk, corruption or allocation limits.
Do not substitute the normalized image hash for the consented original hash.