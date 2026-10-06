/** Date / trading-session helpers. All timestamps are ISO-8601 UTC strings. */

export const DAY_MS = 86400000;

export function nowIso() {
  return new Date().toISOString();
}

export function parseDate(v) {
  if (v instanceof Date) return v;
  const d = new Date(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toDateStr(v) {
  const d = parseDate(v);
  return d ? d.toISOString().slice(0, 10) : null;
}

export function addDays(v, n) {
  const d = parseDate(v);
  if (!d) return null;
  return new Date(d.getTime() + n * DAY_MS).toISOString();
}

export function addHours(v, n) {
  const d = parseDate(v);
  if (!d) return null;
  return new Date(d.getTime() + n * 3600000).toISOString();
}

export function diffDays(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return NaN;
  return (db - da) / DAY_MS;
}

/** US equity regular session: 09:30-16:00 America/New_York. */
export function nyHourMinute(v) {
  const d = parseDate(v);
  if (!d) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return { hour: h, minute: m, minutes: h * 60 + m };
}

export function isWeekday(v) {
  const wd = nyWeekday(v);
  return wd !== null && wd !== 'Sat' && wd !== 'Sun';
}

export function nyWeekday(v) {
  const d = parseDate(v);
  if (!d) return null;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d);
}

/**
 * Session state relative to the US cash equity session.
 * This is what makes the `closed-window` channel possible: rToken trades 24/7 while
 * the native share only prices information for 6.5h a day, 5 days a week.
 */
export function sessionState(v = new Date()) {
  const d = parseDate(v);
  if (!d) return { state: 'unknown' };
  const wd = nyWeekday(d);
  const { minutes } = nyHourMinute(d);
  const weekend = wd === 'Sat' || wd === 'Sun';
  if (weekend) return { state: 'closed', reason: 'weekend', weekday: wd, nyMinutes: minutes };
  if (minutes < 9 * 60 + 30) return { state: 'pre-market', weekday: wd, nyMinutes: minutes };
  if (minutes > 16 * 60) return { state: 'after-hours', weekday: wd, nyMinutes: minutes };
  return { state: 'open', weekday: wd, nyMinutes: minutes };
}

/** Horizon label -> { hours, expiryIso }. Signals are time-boxed; expired cards auto-retire. */
export const HORIZONS = {
  intraday: { hours: 8, label: 'Intraday' },
  swing: { hours: 24 * 5, label: '1-5 days' },
  days: { hours: 24 * 5, label: '1-5 days' },
  weeks: { hours: 24 * 21, label: '1-3 weeks' },
  event: { hours: 24 * 3, label: 'Until event resolves' },
};

export function expiryFor(horizon, from = new Date()) {
  const h = HORIZONS[horizon] || HORIZONS.days;
  return addHours(from, h.hours);
}

/** Exponential time-decay weight in [0,1]; halfLife in hours. */
export function decayWeight(createdIso, atIso, halfLifeHours = 72) {
  const hrs = (parseDate(atIso) - parseDate(createdIso)) / 3600000;
  if (!Number.isFinite(hrs) || hrs <= 0) return 1;
  return 0.5 ** (hrs / halfLifeHours);
}

export function fmtClock(iso) {
  const d = parseDate(iso);
  if (!d) return 'n/a';
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}