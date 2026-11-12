// Timeline lookups. Every query is keyed by logical timestamp, never by frame.
// Append order never matters, only `fromAt` / `startAt`.

export function normalize180Deg(degValue) {
  return ((degValue % 360) + 540) % 360 - 180;
}

// Most recent entry at or before `at`. Ties are won by the entry appended later,
// i.e. the state change that happened at the same instant.
export function latestEntryAt(entries, at) {
  let found = null;
  for (const entry of entries || []) {
    if (!Number.isFinite(entry.fromAt) || entry.fromAt > at) continue;
    if (found === null || entry.fromAt >= found.fromAt) found = entry;
  }
  return found;
}

// Open interval coverage: startAt <= at < endAt. `endAt === null` stays open.
// Releasing guard at `at` therefore deactivates it at that same instant.
export function activeIntervalAt(intervals, at) {
  let found = null;
  for (const interval of intervals || []) {
    if (!Number.isFinite(interval.startAt) || interval.startAt > at) continue;
    if (interval.endAt != null && at >= interval.endAt) continue;
    if (found === null || interval.startAt >= found.startAt) found = interval;
  }
  return found;
}

// True when some guard interval ended at or before `at`.
export function someGuardEndedBy(intervals, at) {
  return (intervals || []).some(
    (interval) => interval.endAt != null && interval.endAt <= at,
  );
}
