import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHeaders, inlineScriptHashes } from "./headers.mjs";

const DOCS_HEADERS = resolve(import.meta.dirname, "../docs/security-headers.md");
const SECURITY_MD = resolve(import.meta.dirname, "../../SECURITY.md");

describe("headers.mjs", () => {
  it("normalises CRLF to LF before hashing inline scripts", () => {
    const lf = inlineScriptHashes("<script>\nconst x = 1;\n</script>");
    const crlf = inlineScriptHashes("<script>\r\nconst x = 1;\r\n</script>");
    expect(lf).toHaveLength(1);
    expect(crlf).toEqual(lf);
    expect(inlineScriptHashes('<script src="/app.js"></script><script>   </script>')).toEqual([]);
  });

  it("writes exact build origins in connect-src without stellar/supabase wildcards", () => {
    const out = buildHeaders(
      {
        rpcOrigin: "https://eunomia.finance",
        horizonOrigin: "https://horizon.stellar.org",
        supabaseOrigin: "https://proj.supabase.co",
      },
      ["'sha256-abc='"],
    );
    expect(out).toContain("script-src 'self' 'sha256-abc=' https://static.cloudflareinsights.com");
    expect(out).toContain("connect-src 'self' https://eunomia.finance https://horizon.stellar.org https://proj.supabase.co wss://proj.supabase.co");
    expect(out).not.toContain("*.stellar.org");
    expect(out).not.toContain("*.supabase.co");
    expect(out).toContain("Cross-Origin-Opener-Policy: same-origin-allow-popups");
  });

  it("keeps security-headers.md and SECURITY.md F4 aligned with headers.mjs", () => {
    const doc = readFileSync(DOCS_HEADERS, "utf8");
    for (const header of [
      "Content-Security-Policy",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
    ]) {
      expect(doc).toContain(header);
    }
    expect(doc).not.toContain("in vercel.json");

    const security = readFileSync(SECURITY_MD, "utf8");
    const f4Line = security.split(/\r?\n/).find((l) => l.startsWith("| F4 |"));
    expect(f4Line).toBeDefined();
    expect(f4Line).toContain("✅ Fixed");
    expect(f4Line).toContain("headers.mjs");
    expect(f4Line).not.toContain("vercel.json");
  });
});
