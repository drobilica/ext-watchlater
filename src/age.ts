export function parseAgeDays(text: string): number | null {
  const lower = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!lower) return null;
  if (/just now|\btoday\b/.test(lower) && !/\d+\s+(day|week|month|year)/.test(lower)) {
    return 0;
  }
  if (/\byesterday\b/.test(lower)) return 1;

  const rel = lower.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    if (unit === "second" || unit === "minute" || unit === "hour") return 0;
    if (unit === "day") return n;
    if (unit === "week") return n * 7;
    if (unit === "month") return n * 30;
    if (unit === "year") return n * 365;
  }

  const abs = Date.parse(
    text.replace(/^(streamed|premiered|uploaded|published)\s+/i, "").replace(/.*•\s*/, ""),
  );
  if (!Number.isNaN(abs) && abs < Date.now() && abs > Date.parse("2005-01-01")) {
    return Math.max(0, Math.floor((Date.now() - abs) / 86400000));
  }
  return null;
}

export function olderThanMonths(ageDays: number, months: 6 | 12 | 24): boolean {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return Date.now() - ageDays * 86400000 <= cutoff.getTime();
}
