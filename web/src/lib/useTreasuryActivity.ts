// Durable per-treasury activity: server-side indexed `chain_events` + `activity` rows for
// this treasury (with pagination) + the Realtime INSERT stream. Overview derives its counters
// (blocked, whitelist-ever, paid-ever) from this instead of device-local monitors —
// the numbers must not reset when the browser changes or when 120 newer platform rows arrive.
import { useCallback, useEffect, useState } from "react";
import type { FeedEvent } from "./events";
import { fetchTreasuryHistory, mergeFeedEvents, subscribeActivity } from "./activity";
import { filterFeed } from "./feedFilter";

const PAGE_SIZE = 50;

export function useTreasuryActivity(
  treasuryId: string,
  refreshKey: number,
): {
  rows: FeedEvent[];
  freshId: string | null;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
} {
  const [rows, setRows] = useState<FeedEvent[]>([]);
  const [freshId, setFreshId] = useState<string | null>(null); // just-arrived row (flash cue)
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    setOffset(0);
  }, [treasuryId, refreshKey]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const page = await fetchTreasuryHistory(treasuryId, {
          limit: PAGE_SIZE,
          offset,
        });
        if (!alive) return;
        setError(null);
        setHasMore(page.length >= PAGE_SIZE);
        setRows((prev) =>
          offset === 0
            ? page
            : mergeFeedEvents(prev, page, prev.length + page.length),
        );
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Could not load treasury history.");
      }
    })();
    const unsub = subscribeActivity((e) => {
      const [mine] = filterFeed([e], { groups: null, treasuryId });
      if (!mine) return;
      setRows((list) => mergeFeedEvents([mine], list, list.length + 1));
      setFreshId(mine.id);
      setTimeout(() => setFreshId(null), 1200);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [treasuryId, refreshKey, offset]);

  const loadMore = useCallback(() => {
    setOffset((prev) => prev + PAGE_SIZE);
  }, []);

  return { rows, freshId, error, hasMore, loadMore };
}
