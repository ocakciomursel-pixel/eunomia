import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, mergeServer, serverEntry, writeClientConfig } from "./clientConfig.js";

const ENV = { EUNOMIA_TREASURY: "CTREASURY", EUNOMIA_NETWORK: "pubnet" };

test("the config is merged: other servers and settings survive", () => {
  const existing = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x", args: [] } } });
  const out = JSON.parse(mergeServer(existing, serverEntry(ENV, "linux")));
  assert.equal(out.theme, "dark");
  assert.deepEqual(out.mcpServers.other, { command: "x", args: [] });
  assert.deepEqual(out.mcpServers.eunomia, { command: "npx", args: ["-y", "eunomia-mcp"], env: ENV });
});

test("a missing or empty config starts fresh", () => {
  assert.deepEqual(Object.keys(JSON.parse(mergeServer(null, serverEntry(ENV, "linux"))).mcpServers), ["eunomia"]);
  assert.deepEqual(Object.keys(JSON.parse(mergeServer("  ", serverEntry(ENV, "linux"))).mcpServers), ["eunomia"]);
});

test("a config that is not a JSON object is never overwritten", () => {
  assert.throws(() => mergeServer("[1,2]", serverEntry(ENV, "linux")), /not a JSON object/);
  assert.throws(() => mergeServer("{ broken", serverEntry(ENV, "linux")));
});

test("on Windows the desktop clients start npx through cmd", () => {
  assert.deepEqual(serverEntry(ENV, "win32").args, ["/c", "npx", "-y", "eunomia-mcp"]);
  assert.equal(serverEntry(ENV, "win32").command, "cmd");
});

test("each client's config lives where the client reads it", () => {
  assert.match(configPath("claude-desktop", "win32", { APPDATA: "C:/Users/u/AppData/Roaming" }, "C:/Users/u"), /Roaming[\\/]Claude[\\/]claude_desktop_config\.json$/);
  assert.match(configPath("claude-desktop", "darwin", {}, "/Users/u"), /Library[\\/]Application Support[\\/]Claude[\\/]claude_desktop_config\.json$/);
  assert.match(configPath("claude-desktop", "linux", {}, "/home/u"), /\.config[\\/]Claude[\\/]claude_desktop_config\.json$/);
  assert.match(configPath("cursor", "linux", {}, "/home/u"), /\.cursor[\\/]mcp\.json$/);
});

test("the agent's secret never goes into a client config", () => {
  const entry = serverEntry(ENV, "linux");
  assert.ok(!JSON.stringify(entry).includes("SECRET"));
});

test("writeClientConfig writes fresh files, preserves .bak on overwrite, and invokes claude-code", () => {
  const home = mkdtempSync(join(tmpdir(), "eunomia-cfg-write-"));
  try {
    const first = writeClientConfig("cursor", ENV, { home, platform: "linux" });
    assert.equal(first.backup, undefined);
    const parsed1 = JSON.parse(readFileSync(first.where, "utf8"));
    assert.deepEqual(parsed1.mcpServers.eunomia, { command: "npx", args: ["-y", "eunomia-mcp"], env: ENV });

    writeFileSync(first.where, JSON.stringify({ mcpServers: { existing: { command: "foo", args: [] } } }));
    const second = writeClientConfig("cursor", ENV, { home, platform: "linux" });
    assert.equal(second.backup, `${first.where}.bak`);
    const parsed2 = JSON.parse(readFileSync(second.where, "utf8"));
    assert.ok(parsed2.mcpServers.existing);
    assert.ok(parsed2.mcpServers.eunomia);

    let spawned: { file: string; args: readonly string[] } | undefined;
    const codeRes = writeClientConfig("claude-code", ENV, {
      platform: "linux",
      exec: (file, args) => {
        spawned = { file, args };
      },
    });
    assert.equal(codeRes.client, "claude-code");
    assert.equal(spawned?.file, "claude");
    assert.ok(spawned?.args.includes("eunomia-mcp"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
