import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeProofHex, encodePublicHex, hex32 } from "./encode.js";

test("hex32 pads decimal strings to 32-byte big-endian hex without 0x prefix", () => {
  assert.equal(hex32("0"), "0".repeat(64));
  assert.equal(hex32("255"), `${"0".repeat(62)}ff`);
  const max256 = ((1n << 256n) - 1n).toString(10);
  assert.equal(hex32(max256), "f".repeat(64));
});

test("encodeProofHex packs G1 || G2 (with EIP-197 c1||c0 swap) || G1 into 256 bytes", () => {
  const proof = {
    pi_a: ["1", "2", "1"],
    pi_b: [
      ["3", "4"], // X: c0=3, c1=4 -> encoded as c1(4) || c0(3)
      ["5", "6"], // Y: c0=5, c1=6 -> encoded as c1(6) || c0(5)
      ["1", "0"],
    ],
    pi_c: ["7", "8", "1"],
  };
  const encoded = encodeProofHex(proof);
  assert.equal(encoded.length, 512); // 256 bytes = 512 hex chars
  const chunks = encoded.match(/.{64}/g) ?? [];
  assert.deepEqual(chunks, [
    hex32("1"),
    hex32("2"),
    hex32("4"), // pi_b[0][1] (X.c1)
    hex32("3"), // pi_b[0][0] (X.c0)
    hex32("6"), // pi_b[1][1] (Y.c1)
    hex32("5"), // pi_b[1][0] (Y.c0)
    hex32("7"),
    hex32("8"),
  ]);
});

test("encodePublicHex concatenates 32-byte big-endian public inputs in order", () => {
  const pub = ["10", "20", "30"];
  const hex = encodePublicHex(pub);
  assert.equal(hex.length, 3 * 64);
  assert.equal(hex, hex32("10") + hex32("20") + hex32("30"));
});
