// Minimal synchronous React hook state machine for testing hooks in Vitest's node environment
// without requiring jsdom. Supports useState (including render-phase state updates), useRef,
// useMemo, useCallback, and useEffect (with dependency tracking and cleanup).

type Deps = readonly unknown[] | undefined;

interface StateSlot<T = unknown> {
  kind: "state";
  value: T;
  setter: (next: T | ((prev: T) => T)) => void;
}

interface RefSlot<T = unknown> {
  kind: "ref";
  ref: { current: T };
}

interface MemoSlot<T = unknown> {
  kind: "memo";
  value: T;
  deps: Deps;
}

interface EffectSlot {
  kind: "effect";
  effect: () => void | (() => void);
  deps: Deps;
  cleanup?: void | (() => void);
  needsRun: boolean;
}

type Slot = StateSlot | RefSlot | MemoSlot | EffectSlot;

function depsChanged(prev: Deps, next: Deps): boolean {
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) return true;
  }
  return false;
}

interface ActiveHost {
  slots: Slot[];
  cursor: number;
  inRender: boolean;
  dirtyDuringRender: boolean;
  scheduleRender: () => void;
}

let currentHost: ActiveHost | null = null;

function requireHost(): ActiveHost {
  if (!currentHost) throw new Error("Hook called outside of renderHook");
  return currentHost;
}

export const hookMocks = {
  useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
    const host = requireHost();
    const idx = host.cursor++;
    let slot = host.slots[idx] as StateSlot<T> | undefined;
    if (!slot) {
      const value = typeof initial === "function" ? (initial as () => T)() : initial;
      const setter = (next: T | ((prev: T) => T)) => {
        const s = host.slots[idx] as StateSlot<T>;
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(s.value) : next;
        if (Object.is(s.value, resolved)) return;
        s.value = resolved;
        if (host.inRender) {
          host.dirtyDuringRender = true;
        } else {
          host.scheduleRender();
        }
      };
      slot = { kind: "state", value, setter };
      host.slots[idx] = slot as unknown as Slot;
    }
    return [slot.value, slot.setter];
  },

  useRef<T>(initial: T): { current: T } {
    const host = requireHost();
    const idx = host.cursor++;
    let slot = host.slots[idx] as RefSlot<T> | undefined;
    if (!slot) {
      slot = { kind: "ref", ref: { current: initial } };
      host.slots[idx] = slot;
    }
    return slot.ref;
  },

  useMemo<T>(factory: () => T, deps?: Deps): T {
    const host = requireHost();
    const idx = host.cursor++;
    const prev = host.slots[idx] as MemoSlot<T> | undefined;
    if (!prev || depsChanged(prev.deps, deps)) {
      const value = factory();
      host.slots[idx] = { kind: "memo", value, deps };
      return value;
    }
    return prev.value;
  },

  useCallback<T extends (...args: never[]) => unknown>(cb: T, deps?: Deps): T {
    return hookMocks.useMemo(() => cb, deps);
  },

  useEffect(effect: () => void | (() => void), deps?: Deps): void {
    const host = requireHost();
    const idx = host.cursor++;
    const prev = host.slots[idx] as EffectSlot | undefined;
    if (!prev) {
      host.slots[idx] = { kind: "effect", effect, deps, needsRun: true };
    } else if (depsChanged(prev.deps, deps)) {
      prev.effect = effect;
      prev.deps = deps;
      prev.needsRun = true;
    } else {
      prev.effect = effect;
    }
  },
};

export function createHookTestHarness<P, R>(hookFn: (props: P) => R, initialProps: P) {
  let props = initialProps;
  let latestResult!: R;
  let unmounted = false;

  const host: ActiveHost = {
    slots: [],
    cursor: 0,
    inRender: false,
    dirtyDuringRender: false,
    scheduleRender: () => {
      if (!unmounted) runRender();
    },
  };

  function runRender() {
    let guards = 0;
    do {
      if (++guards > 20) throw new Error("Too many re-renders");
      host.dirtyDuringRender = false;
      host.cursor = 0;
      host.inRender = true;
      const prevHost = currentHost;
      currentHost = host;
      try {
        latestResult = hookFn(props);
      } finally {
        currentHost = prevHost;
        host.inRender = false;
      }
    } while (host.dirtyDuringRender);

    for (const slot of host.slots) {
      if (slot.kind === "effect" && slot.needsRun) {
        slot.needsRun = false;
        if (typeof slot.cleanup === "function") slot.cleanup();
        slot.cleanup = slot.effect();
      }
    }
  }

  runRender();

  return {
    get result(): R {
      return latestResult;
    },
    rerender(nextProps: P) {
      props = nextProps;
      runRender();
    },
    unmount() {
      unmounted = true;
      for (const slot of host.slots) {
        if (slot.kind === "effect" && typeof slot.cleanup === "function") {
          slot.cleanup();
          slot.cleanup = undefined;
        }
      }
    },
  };
}
