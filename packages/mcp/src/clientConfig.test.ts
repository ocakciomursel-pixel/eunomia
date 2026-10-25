import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { claudeCodeCommand, configPath, mergeServer, serverEntry, writeClientConfig } from "./clientConfig.js";

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

test("on Windows claude-code goes through cmd /c rather than spawning claude.cmd directly", () => {
  const args = ["mcp", "add", "--scope", "user", "eunomia"];
  assert.deepEqual(claudeCodeCommand(args, "win32"), {
    command: "cmd",
    args: ["/c", "claude", ...args],
  });
  assert.deepEqual(claudeCodeCommand(args, "linux"), {
    command: "claude",
    args,
  });
});

test("writeClientConfig spawns claude-code on the current platform without EINVAL", () => {
  const dir = mkdtempSync(join(tmpdir(), "eunomia-claude-cli-"));
  try {
    const outFile = join(dir, "args.json");
    const dumpScript = join(dir, "dump.mjs");
    writeFileSync(
      dumpScript,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(outFile)}, JSON.stringify(process.argv.slice(2)));\n`,
    );
    if (process.platform === "win32") {
      writeFileSync(
        join(dir, "claude.cmd"),
        `@"${process.execPath}" "${dumpScript}" %*\r\n`,
      );
    } else {
      const shPath = join(dir, "claude");
      writeFileSync(
        shPath,
        `#!/bin/sh\nexec "${process.execPath}" "${dumpScript}" "$@"\n`,
      );
      chmodSync(shPath, 0o755);
    }
    const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      [pathKey]: `${dir}${delimiter}${process.env[pathKey] ?? ""}`,
    };
    const res = writeClientConfig("claude-code", ENV, { env: childEnv });
    assert.equal(res.client, "claude-code");
    assert.equal(
      res.where,
      "claude mcp add --scope user eunomia -e EUNOMIA_TREASURY=CTREASURY -e EUNOMIA_NETWORK=pubnet -- npx -y eunomia-mcp",
    );
    const captured = JSON.parse(readFileSync(outFile, "utf8")) as string[];
    assert.deepEqual(captured, [
      "mcp",
      "add",
      "--scope",
      "user",
      "eunomia",
      "-e",
      "EUNOMIA_TREASURY=CTREASURY",
      "-e",
      "EUNOMIA_NETWORK=pubnet",
      "--",
      "npx",
      "-y",
      "eunomia-mcp",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
