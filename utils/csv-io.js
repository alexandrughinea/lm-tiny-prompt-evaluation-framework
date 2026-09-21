import { parse } from 'csv-parse/sync';
import { escapeCSV } from './csv-utils.js';

export function detectDelimiter(text) {
  const line = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .find(row => row.trim()) || '';
  let comma = 0;
  let semicolon = 0;
  let tab = 0;
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      continue;
    }
    if (char === ',') {
      comma += 1;
    } else if (char === ';') {
      semicolon += 1;
    } else if (char === '\t') {
      tab += 1;
    }
  }
  if (tab > 0 && tab >= comma && tab >= semicolon) {
    return '\t';
  }
  if (semicolon > comma) {
    return ';';
  }
  return ',';
}

function parseRows(text, delimiter) {
  return parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    delimiter,
    columns: false
  });
}

function expandCells(cells, headerCount, delimiter) {
  if (headerCount <= 1 || cells.length >= headerCount) {
    return cells;
  }
  const joined = cells.join(delimiter);
  const unwrapped = unwrapQuoted(joined);
  const fromJoined = parseRows(unwrapped, delimiter)[0] || [];
  if (fromJoined.length > cells.length) {
    return fromJoined;
  }
  if (cells.length !== 1) {
    return cells;
  }
  const inner = String(cells[0] ?? '').trim();
  if (!inner || !inner.includes(delimiter)) {
    return cells;
  }
  const expanded = parseRows(inner, delimiter)[0] || [];
  return expanded.length > 1 ? expanded : cells;
}

function unwrapQuoted(value) {
  const text = String(value ?? '').trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/""/g, '"');
  }
  return text;
}

export function parseCsv(text, options = {}) {
  const { columns: columnsOption, ...rest } = options;
  const delimiter = rest.delimiter ?? detectDelimiter(text);
  const rows = parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    ...rest,
    delimiter,
    columns: false
  });

  if (columnsOption === false) {
    return rows;
  }

  const headers = (rows[0] || []).map(header => String(header ?? '').trim());
  return rows.slice(1).map(cells => {
    const fields = expandCells(cells, headers.length, delimiter);
    const record = Object.create(null);
    for (let index = 0; index < headers.length; index += 1) {
      record[headers[index]] = fields[index] ?? '';
    }
    return record;
  });
}

export function stringifyCsv(headers, rows) {
  const lines = [headers.map(header => escapeCSV(header)).join(',')];
  for (const row of rows) {
    lines.push(headers.map(header => escapeCSV(row[header] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}
