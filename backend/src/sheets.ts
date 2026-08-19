import { config } from './config';
import { googleAccessToken } from './google-auth';

/**
 * Writes back to the intake Google Sheet -- the same spreadsheet the
 * Automations service reads from. We only write specific cells on a known row
 * (the case's sheet_row): mentor details when a mentor is introduced, and the
 * project title/description when they're set in the dashboard.
 *
 * Header names are read from row 1 and cached, so a column can move without a
 * code change. A header we don't recognise is skipped (and reported), never
 * guessed at by position.
 */

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export function sheetsConfigured(): boolean {
  return Boolean(config.google.creds && config.sheet.id);
}

/** Zero-based column index -> A1 letter (0 -> A, 26 -> AA). */
function columnLetter(index: number): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

async function call<T>(
  method: 'GET' | 'POST',
  pathname: string,
  body?: unknown
): Promise<T> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetch(`${API}/${config.sheet.id}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets ${method} ${pathname.split('?')[0]} returned ${res.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

// Header row is stable across a deploy; read it once and cache the name->index.
let headerIndex: Map<string, number> | null = null;

async function loadHeaderIndex(): Promise<Map<string, number>> {
  if (headerIndex) return headerIndex;
  const range = `${quoteTab(config.sheet.tab)}!A1:ZZ1`;
  const data = await call<{ values?: string[][] }>(
    'GET',
    `/values/${encodeURIComponent(range)}`
  );
  const headers = (data.values?.[0] ?? []).map((h) => String(h ?? '').trim());
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    if (h && !map.has(h)) map.set(h, i);
  });
  headerIndex = map;
  return map;
}

/**
 * Set the given header -> value cells on one row (1-based). USER_ENTERED so
 * values land as the sheet would parse them. Unknown headers are returned so
 * the caller can warn. A no-op (nothing to write / no known headers) is fine.
 */
export async function writeRowCells(
  rowNumber: number,
  values: Record<string, string>
): Promise<{ skippedHeaders: string[] }> {
  const index = await loadHeaderIndex();
  const data: { range: string; values: string[][] }[] = [];
  const skippedHeaders: string[] = [];

  for (const [header, value] of Object.entries(values)) {
    const col = index.get(header.trim());
    if (col === undefined) {
      skippedHeaders.push(header);
      continue;
    }
    const cell = `${quoteTab(config.sheet.tab)}!${columnLetter(col)}${rowNumber}`;
    data.push({ range: cell, values: [[value]] });
  }

  if (data.length > 0) {
    await call('POST', `/values:batchUpdate`, {
      valueInputOption: 'USER_ENTERED',
      data,
    });
  }
  return { skippedHeaders };
}
