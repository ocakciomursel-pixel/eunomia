import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookTestHarness, hookMocks } from "../test-stubs/hookRunner";
import type { FeedEvent } from "./events";

const { fetchActivityHistoryMock, subscribeActivityMock } = vi.hoisted(() => ({
  fetchActivityHistoryMock: vi.fn(),
  subscribeActivityMock: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, ...hookMocks };
});

vi.mock("./activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./activity")>();
  return {
    ...actual,
    fetchActivityHistory: fetchActivityHistoryMock,
    subscribeActivity: subscribeActivityMock,
  };
});

import { useTreasuryActivity } from "./useTreasuryActivity";

const T1 = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
const T2 = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

describe("useTreasuryActivity", () => {
  let subscriber: ((e: FeedEvent) => void) | null = null;
  const unsubMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    subscriber = null;
    subscribeActivityMock.mockImplementation((cb: (e: FeedEvent) => void) => {
      subscriber = cb;
      return unsubMock;
    });
  });

  it("loads history filtered to the active treasury and merges realtime events for that treasury only", async () => {
    vi.useFakeTimers();
    const initialHistory: FeedEvent[] = [
      { id: "e1", kind: "paid", label: "Paid 5 XLM", at: "2026-10-26T12:00:00.000Z", treasuryId: T1, txHash: "h1" },
      { id: "e2", kind: "paid", label: "Other treasury", at: "2026-10-26T12:01:00.000Z", treasuryId: T2, txHash: "h2" },
    ];
    fetchActivityHistoryMock.mockResolvedValueOnce(initialHistory);

    const h = createHookTestHarness(
      ({ id, k }: { id: string; k: number }) => useTreasuryActivity(id, k),
      { id: T1, k: 0 },
    );

    await vi.waitFor(() => {
      expect(h.result.rows).toHaveLength(1);
    });
    expect(h.result.rows[0].id).toBe("e1");
    expect(h.result.freshId).toBeNull();

    // Event for another treasury is ignored
    subscriber?.({ id: "e3", kind: "fund", label: "Funded other", txHash: "h3", at: "2026-10-26T12:02:00.000Z", treasuryId: T2 });
    expect(h.result.rows).toHaveLength(1);
    expect(h.result.freshId).toBeNull();

    // Event for T1 is merged and flashes freshId for 1200ms
    subscriber?.({ id: "e4", kind: "fund", label: "Funded 10 XLM", txHash: "h4", at: "2026-10-26T12:03:00.000Z", treasuryId: T1 });
    expect(h.result.rows.map((r) => r.id)).toEqual(["e4", "e1"]);
    expect(h.result.freshId).toBe("e4");

    vi.advanceTimersByTime(1200);
    expect(h.result.freshId).toBeNull();

    h.unmount();
    expect(unsubMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
