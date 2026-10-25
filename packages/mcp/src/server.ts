import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fileCache, type KnownPayeeCache } from "./cache.js";
import type { callService } from "./call.js";
import type { searchServices } from "./catalog.js";
import { resolveCredential, type Credential } from "./credential.js";
import type { closeException, readExceptionEntry, submitException } from "./exception.js";
import type { fundFloat, sweepFloat, tokenBalance } from "./float.js";
import { homeDir, resolveNetwork, type NetworkConfig } from "./network.js";
import type { payFromTreasury, preflightReasons } from "./pay.js";
import type { listAllowedPayees } from "./payees.js";
import type { lacksTrustline } from "./receiver.js";
import { fileExceptionStore, filePurchaseLog, type ExceptionStore, type PurchaseLog } from "./store.js";
import { registerSpendTools } from "./spendTools.js";
import { registerTools } from "./tools.js";
import type { isPayee, makeClient, readTreasury } from "./treasury.js";
import type { treasuryUnit } from "./unit.js";

export const SERVER_NAME = "eunomia-mcp";
export const SERVER_VERSION = "0.3.0";

export interface ServerDeps {
  makeClient?: typeof makeClient;
  readTreasury?: typeof readTreasury;
  isPayee?: typeof isPayee;
  treasuryUnit?: typeof treasuryUnit;
  listAllowedPayees?: typeof listAllowedPayees;
  lacksTrustline?: typeof lacksTrustline;
  payFromTreasury?: typeof payFromTreasury;
  preflightReasons?: typeof preflightReasons;
  submitException?: typeof submitException;
  readExceptionEntry?: typeof readExceptionEntry;
  closeException?: typeof closeException;
  searchServices?: typeof searchServices;
  fundFloat?: typeof fundFloat;
  callService?: typeof callService;
  sweepFloat?: typeof sweepFloat;
  tokenBalance?: typeof tokenBalance;
}

export interface ServerContext {
  net: NetworkConfig;
  /** null until EUNOMIA_TREASURY is set — tools then explain how, instead of crashing */
  treasuryId: string | null;
  credential: Credential | null;
  cache: KnownPayeeCache;
  /** exception requests this agent filed (bookmarks; the chain is the truth) */
  exceptions: ExceptionStore;
  /** what call_service bought (absent in tests that do not buy) */
  purchases?: PurchaseLog;
  /** where the owner approves things — budget requests link here */
  appUrl?: string;
  /** unix seconds; injectable for tests */
  now?: () => number;
  /** optional dependency overrides for offline protocol tests */
  deps?: ServerDeps;
}

export function contextFromEnv(env: NodeJS.ProcessEnv): ServerContext {
  const net = resolveNetwork(env);
  const home = homeDir(env);
  const treasuryId = env.EUNOMIA_TREASURY?.trim() || null;
  return {
    net,
    treasuryId,
    credential: treasuryId ? resolveCredential(env, home, net.name, treasuryId) : null,
    cache: fileCache(join(home, net.name)),
    exceptions: fileExceptionStore(join(home, net.name)),
    purchases: filePurchaseLog(join(home, net.name)),
    appUrl: env.EUNOMIA_APP_URL?.trim() || "https://eunomia.finance",
  };
}

export function createServer(ctx: ServerContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, ctx);
  registerSpendTools(server, ctx);
  return server;
}
