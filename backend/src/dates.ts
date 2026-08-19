/**
 * Deadline parsing for the "... and deadline is 25 may 2026" replies.
 *
 * Deliberately not a date library: the input is a short human phrase typed
 * into Slack, and the only thing done with the result is printing it back into
 * a WhatsApp message. Anything unparseable is passed through verbatim rather
 * than rejected -- a deadline written "end of next week" should still reach the
 * student.
 */

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function monthIndex(word: string): number {
  const w = word.toLowerCase();
  return MONTHS.findIndex((m) => m === w || m.slice(0, 3) === w.slice(0, 3));
}

const MONTH_NAMES = MONTHS.map((m) => m[0]!.toUpperCase() + m.slice(1));

export interface Deadline {
  /** What goes into the message, e.g. "25 May 2026". */
  text: string;
  /** Null when the phrase couldn't be read as a calendar date. */
  date: Date | null;
}

function format(day: number, month: number, year: number): string {
  return `${day} ${MONTH_NAMES[month]} ${year}`;
}

export function parseDeadline(raw: string): Deadline {
  const input = raw.trim().replace(/[.,]+$/, '');
  if (!input) return { text: '', date: null };

  // "25 may 2026", "25th May 2026", "25 May" (year assumed)
  const dmy = input.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*(\d{4})?$/);
  if (dmy) {
    const month = monthIndex(dmy[2]!);
    if (month >= 0) {
      const day = Number(dmy[1]);
      const year = dmy[3] ? Number(dmy[3]) : assumedYear(day, month);
      return { text: format(day, month, year), date: new Date(year, month, day) };
    }
  }

  // "may 25 2026", "May 25th, 2026"
  const mdy = input.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})?$/);
  if (mdy) {
    const month = monthIndex(mdy[1]!);
    if (month >= 0) {
      const day = Number(mdy[2]);
      const year = mdy[3] ? Number(mdy[3]) : assumedYear(day, month);
      return { text: format(day, month, year), date: new Date(year, month, day) };
    }
  }

  // "2026-05-25"
  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    if (month >= 0 && month <= 11) {
      return { text: format(day, month, year), date: new Date(year, month, day) };
    }
  }

  // "25/05/2026" and "25-05-2026". Day first: the team writes dates the Indian
  // way, and there is no reading of "25/05" that makes 25 a month.
  const numeric = input.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const rawYear = Number(numeric[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return { text: format(day, month, year), date: new Date(year, month, day) };
    }
  }

  return { text: input, date: null };
}

/** A deadline written without a year means the next time that date comes round. */
function assumedYear(day: number, month: number): number {
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), month, day);
  return thisYear >= new Date(now.toDateString())
    ? now.getFullYear()
    : now.getFullYear() + 1;
}
