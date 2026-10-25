// Verify that REGISTRY_ID in workers/chain-indexer/wrangler.jsonc matches
// PUBNET.registryId in web/src/networks.ts.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wranglerPath = resolve(here, "../wrangler.jsonc");
const networksPath = resolve(here, "../../../web/src/networks.ts");

const wranglerText = readFileSync(wranglerPath, "utf8");
const networksText = readFileSync(networksPath, "utf8");

const wranglerMatch = wranglerText.match(/"REGISTRY_ID"\s*:\s*"([A-Z0-9]+)"/);
const networksMatch = networksText.match(/registryId\s*:\s*"([A-Z0-9]+)"/);

if (!wranglerMatch) {
  console.error(`Could not find REGISTRY_ID in ${wranglerPath}`);
  process.exit(1);
}
if (!networksMatch) {
  console.error(`Could not find registryId in ${networksPath}`);
  process.exit(1);
}

if (wranglerMatch[1] !== networksMatch[1]) {
  console.error(
    `REGISTRY_ID mismatch: wrangler.jsonc has ${wranglerMatch[1]} but web/src/networks.ts has ${networksMatch[1]}`,
  );
  process.exit(1);
}
