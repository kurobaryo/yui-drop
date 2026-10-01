/**
 * CSV / TSV parsing for the pickup table preview.
 *
 * RFC 4180: a field may be wrapped in `"`; inside it a doubled `""` is a
 * literal quote, and the delimiter and line breaks are ordinary characters.
 * Records end at CRLF, LF or a lone CR. A leading UTF-8 BOM is dropped.
 *
 * Lenient where real files are sloppy: a quote that does not open a field is
 * kept as text, characters after a closing quote are appended to the field,
 * and an unterminated quote runs to the end of the input (the preview may be
 * cut at 512 KB mid-field). Blank lines are skipped.
 *
 * Pure string work — no DOM. Callers render cells as text, never as HTML.
 */

export type Delimiter = ',' | ';' | '\t';

const CANDIDATES: Delimiter[] = [',', ';', '\t'];

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Guess a `.csv` file's delimiter: whichever of `,` `;` and tab occurs most
 * often outside quotes in the first record. Ties (and no hits at all) go to
 * the earlier one in that order, so plain comma CSV is the default.
 */
export function sniffDelimiter(text: string): Delimiter {
  const src = stripBom(text);
  const counts = new Map<string, number>(CANDIDATES.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      // A doubled quote inside a quoted field toggles twice: no net change.
      quoted = !quoted;
    } else if (!quoted) {
      if (c === '\n' || c === '\r') break;
      const n = counts.get(c);
      if (n !== undefined) counts.set(c, n + 1);
    }
  }
  let best: Delimiter = ',';
  for (const d of CANDIDATES) {
    if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d;
  }
  return best;
}

/**
 * Split delimited text into records of fields. Stops after `maxRows + 1`
 * records so a huge file costs no more than the rows that will be shown; the
 * extra record only signals that there was more.
 */
export function parseDelimited(text: string, delimiter: string, maxRows = Infinity): string[][] {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStart = true;

  const endRecord = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    field = '';
  };

  for (let i = 0; i < src.length && rows.length <= maxRows; i++) {
    const c = src[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (c === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      fieldStart = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRecord();
      fieldStart = true;
    } else {
      field += c;
      fieldStart = false;
    }
  }
  // Last record without a trailing newline.
  if (rows.length <= maxRows && (field !== '' || row.length > 0)) endRecord();
  return rows;
}

export interface Table {
  /** Rows (header first), each padded or cut to exactly `columns` cells. */
  rows: string[][];
  columns: number;
  /** The file had more rows / columns than the caps. */
  rowsCut: boolean;
  colsCut: boolean;
}

/** Parse and cap a delimited file for display. */
export function parseTable(
  text: string,
  delimiter: string,
  { maxRows, maxCols }: { maxRows: number; maxCols: number },
): Table {
  const parsed = parseDelimited(text, delimiter, maxRows);
  const rowsCut = parsed.length > maxRows;
  const kept = rowsCut ? parsed.slice(0, maxRows) : parsed;
  const widest = kept.reduce((w, r) => Math.max(w, r.length), 0);
  const columns = Math.min(widest, maxCols);
  const rows = kept.map((r) =>
    r.length === columns ? r : r.length > columns ? r.slice(0, columns) : [...r, ...Array<string>(columns - r.length).fill('')],
  );
  return { rows, columns, rowsCut, colsCut: widest > maxCols };
}
