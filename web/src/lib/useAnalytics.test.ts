import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookTestHarness, hookMocks } from "../test-stubs/hookRunner";
import type { FeedEvent } from "./events";

const { getHealthMock, getLatestLedgerMock, fetchAllEventsMock } = vi.hoisted(() => ({
  getHealthMock: vi.fn(),
  getLatestLedgerMock: vi.fn(),
  fetchAllEventsMock: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, ...hookMocks };
});

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: class {
        getHealth = getHealthMock;
        getLatestLedger = getLatestLedgerMock;
      },
    },
  };
});

vi.mock("./events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./events")>();
  return {
    ...actual,
    fetchAllEvents: fetchAllEventsMock,
  };
});

import { useAnalyticsScore } from "./useAnalytics";

const CONTRACT = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";

describe("useAnalyticsScore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cold-loads from getHealth oldestLedger, computes scorecard, and incrementally pages from cached cursor", async () => {
    const e1: FeedEvent = {
      id: "ev-1",
      kind: "paid",
      label: "Agent paid 10 XLM to GABC · task 1",
      txHash: "h1",
      at: "2026-10-26T12:00:00.000Z",
      amountXlm: 10,
      treasuryId: CONTRACT,
    };
    const e2: FeedEvent = {
      id: "ev-2",
      kind: "paid",
      label: "Agent paid 5 XLM to GDEF · task 2",
      txHash: "h2",
      at: "2026-10-26T12:01:00.000Z",
      amountXlm: 5,
      treasuryId: CONTRACT,
    };

    getHealthMock.mockResolvedValueOnce({ oldestLedger: 500 });
    fetchAllEventsMock.mockResolvedValueOnce({
      events: [e1],
      cursor: "cur-1",
      truncated: false,
    });

    const h = createHookTestHarness(
      ({ id, k }: { id: string; k: number }) => useAnalyticsScore(id, k),
      { id: CONTRACT, k: 0 },
    );

    await vi.waitFor(() => {
      expect(h.result.status).toBe("ready");
    });
    expect(fetchAllEventsMock).toHaveBeenCalledWith(expect.anything(), {
      contractIds: [CONTRACT],
      startLedger: 501,
    });
    expect(h.result.events).toHaveLength(1);
    expect(h.result.score.payments).toBe(1);
    expect(h.result.truncated).toBe(false);

    // Trigger refresh -> should use cached cursor "cur-1"
    fetchAllEventsMock.mockResolvedValueOnce({
      events: [e2],
      cursor: "cur-2",
      truncated: true,
    });
    h.result.refresh();

    await vi.waitFor(() => {
      expect(h.result.events).toHaveLength(2);
    });
    expect(fetchAllEventsMock).toHaveBeenLastCalledWith(expect.anything(), {
      contractIds: [CONTRACT],
      cursor: "cur-1",
    });
    expect(h.result.truncated).toBe(true);
    expect(h.result.score.payments).toBe(2);
    h.unmount();
  });

  it("falls back to getLatestLedger when getHealth fails, and sets error status when fetchAllEvents fails", async () => {
    getHealthMock.mockRejectedValueOnce(new Error("health unsupported"));
    getLatestLedgerMock.mockResolvedValueOnce({ sequence: 10_000 });
    fetchAllEventsMock.mockRejectedValueOnce(new Error("rpc down"));

    const h = createHookTestHarness(
      ({ id, k }: { id: string; k: number }) => useAnalyticsScore(id, k),
      { id: CONTRACT, k: 1 },
    );

    await vi.waitFor(() => {
      expect(h.result.status).toBe("error");
    });
    expect(fetchAllEventsMock).toHaveBeenCalledWith(expect.anything(), {
      contractIds: [CONTRACT],
      startLedger: 1000,
    });
    h.unmount();
  });
});
