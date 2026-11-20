// Isolated port-review backend. Deliberately imports NO application modules.
// No database, provider, mail, uploads, account creation, or document generation.
import http from "node:http";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("PORT is required");
http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Brikvest-Fixture", "synthetic-only");
  res.setHeader("Cache-Control", "no-store");
  const path = new URL(req.url, "http://fixture.invalid").pathname;
  const reply = (status, data) => {
    res.writeHead(status);
    res.end(JSON.stringify(data));
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    return reply(503, { message: "Isolated port-review preview: writes, mail and payments are unavailable." });
  }
  if (path === "/api/healthz") return reply(200, { status: "ok", mode: "isolated-fixture" });
  if (path === "/api/auth/user") return reply(401, { message: "Authentication required" });
  if (["/api/properties", "/api/marketplace/listings", "/api/marketplace/listings-public"].includes(path)) return reply(200, []);
  if (path === "/api/exchange-rates") return reply(200, {
    rates: { NGN: 1 },
    currencies: { NGN: { symbol: "₦", name: "Nigerian Naira" } },
  });
  if (path === "/api/payments/flutterwave/config") return reply(200, { enabled: false });
  return reply(503, { message: "No synthetic fixture for this endpoint. The real backend is intentionally stopped." });
}).listen(port, "0.0.0.0", () => console.info("Isolated Brikvest fixture API ready; real backend remains stopped."));
