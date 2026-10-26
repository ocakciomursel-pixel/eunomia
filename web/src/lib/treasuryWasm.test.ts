import { describe, expect, it } from "vitest";
import { allowedWasmHashes } from "./relayGuard";
import { LEGACY_TREASURY_WASM_HASHES, TREASURY_WASM_HASH } from "./treasuryWasm";

describe("treasuryWasm", () => {
  it("exports a 64-character lowercase hex SHA-256 wasm hash", () => {
    expect(TREASURY_WASM_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps legacy treasury wasm hashes as valid 64-character lowercase hex strings without duplicates", () => {
    expect(Array.isArray(LEGACY_TREASURY_WASM_HASHES)).toBe(true);
    for (const h of LEGACY_TREASURY_WASM_HASHES) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(h).not.toBe(TREASURY_WASM_HASH);
    }
    expect(new Set(LEGACY_TREASURY_WASM_HASHES).size).toBe(LEGACY_TREASURY_WASM_HASHES.length);
  });

  it("is admitted by relayGuard.allowedWasmHashes alongside any legacy hashes", () => {
    const allowed = allowedWasmHashes(undefined);
    expect(allowed).toContain(TREASURY_WASM_HASH);
    for (const h of LEGACY_TREASURY_WASM_HASHES) {
      expect(allowed).toContain(h);
    }
  });
});
