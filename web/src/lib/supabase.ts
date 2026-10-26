import { createClient } from "@supabase/supabase-js";

// Strip any non-printable-ASCII bytes from env values. A BOM / zero-width char (U+FEFF,
// U+200B) can sneak in when pasting env vars; supabase-js sets the anon key as
// an HTTP header, and a non-ISO-8859-1 code point throws "Failed to execute 'set' on
// 'Headers'" — so the insert never even goes out. `.trim()` misses U+200B, so strip
// everything outside printable ASCII (keys and URLs are ASCII anyway).
const clean = (s?: string): string | undefined => s?.replace(/[^\x20-\x7E]/g, "");
const url = clean(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

// Telemetry is optional infrastructure — if env is missing in a build, the loggers
// degrade gracefully (see lib/activity.ts and lib/funnel.ts) instead of crashing the app.
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = supabaseConfigured
  ? createClient(url as string, anonKey as string, { auth: { persistSession: false } })
  : null;
