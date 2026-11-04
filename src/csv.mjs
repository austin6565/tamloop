import { readFile } from 'node:fs/promises';

/** RFC 4180 style quoted CSV, including embedded commas and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quote');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const [header, ...data] = rows;
  return data.map((values) => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ''])));
}

/** Saved CSVs enter as candidate evidence; source labels do not imply verification. */
export function csvSource({ name, path, columns, pageSize = 50 }) {
  if (!name || !path || !columns?.name) throw new Error('CSV source requires name, path, and columns.name');
  return {
    name,
    async *pages() {
      const records = parseCsv(await readFile(path, 'utf8'));
      for (let i = 0; i < records.length; i += pageSize) {
        const rows = records.slice(i, i + pageSize).map((record, offset) => {
          const evidenceUrl = record[columns.evidenceUrl] ?? '';
          return {
            name: record[columns.name], domain: record[columns.domain] ?? '',
            region: record[columns.region] ?? '',
            entityType: record[columns.entityType] ?? 'company',
            sourceStatus: record[columns.sourceStatus] ?? '',
            sourceRef: `${name}:${i + offset + 2}`,
            evidence: evidenceUrl ? [evidenceUrl] : [],
          };
        });
        yield { id: `${name}:${i / pageSize}`, rows };
      }
    },
  };
}
