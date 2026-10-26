import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXCEPTION_PAYLOAD_BYTES,
  REFUSAL_SLOTS,
  decodeExceptionPayload,
  encodeExceptionPayload,
  exceptionEntryName,
  exceptionIdOf,
  isExceptionEntryFor,
  refusalEntryName,
} from "./exceptionCodec.js";

const T = "CDVCLLGGMV6MJSJZYCPJI36BG6SGKSWVD44PORHVVFRBTSACEABBYNJ2";
const G = "GAF74ROXHKLAW4JKHJQVYR3O27VTQJF7QA4GLWDBTZACWEPKMPCAVCEZ";

test("payload round-trips for G and C payees in 56 bytes", () => {
  for (const payee of [G, T]) {
    const p = { payee, amount: 150_000_000n, taskId: 42n, reasonCodes: [2, 3], requestedAt: 1_757_900_000 };
    const bytes = encodeExceptionPayload(p);
    assert.equal(bytes.length, EXCEPTION_PAYLOAD_BYTES);
    assert.deepEqual(decodeExceptionPayload(bytes), p);
  }
});

test("decoder refuses foreign data", () => {
  assert.throws(() => decodeExceptionPayload(new Uint8Array(10)), /length/);
  const bad = encodeExceptionPayload({ payee: G, amount: 1n, taskId: 0n, reasonCodes: [], requestedAt: 1 });
  bad[0] = 9;
  assert.throws(() => decodeExceptionPayload(bad), /version/);
  assert.throws(() => encodeExceptionPayload({ payee: "nope", amount: 1n, taskId: 0n, reasonCodes: [], requestedAt: 1 }), /address/);
});

test("entry names are scoped to the treasury and stay under 64 bytes", () => {
  const name = exceptionEntryName(T, 1_757_900_000_123);
  assert.ok(name.startsWith("eunomia.x.CDVCLLGG."));
  assert.ok(Buffer.byteLength(name) <= 64);
  assert.equal(isExceptionEntryFor(name, T), true);
  assert.equal(isExceptionEntryFor(name, "CAAAAAAA" + T.slice(8)), false);
  assert.equal("eunomia.x." + exceptionIdOf(name), name);
});

test("passive refusal flag round-trips and rolling refusal slots stay bounded", () => {
  const p = {
    payee: G,
    amount: 25_000_000n,
    taskId: 7n,
    reasonCodes: [2, 3],
    requestedAt: 1_758_000_000,
    refusal: true,
  };
  const bytes = encodeExceptionPayload(p);
  assert.equal(bytes.length, EXCEPTION_PAYLOAD_BYTES);
  assert.deepEqual(decodeExceptionPayload(bytes), p);

  const slots = new Set(Array.from({ length: 12 }, (_, i) => refusalEntryName(T, i)));
  assert.equal(slots.size, REFUSAL_SLOTS);
  for (const name of slots) {
    assert.equal(isExceptionEntryFor(name, T), true);
    assert.ok(Buffer.byteLength(name) <= 64);
  }
});
