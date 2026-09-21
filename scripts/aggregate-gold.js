import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCsv, detectDelimiter, stringifyCsv } from '../utils/csv-io.js';
import {
  STATED_CONFIDENCE,
  canonicalFieldName,
  caseIdFromValue,
  coerceCell,
  fieldNamesFromSuite,
  goldFileName,
  isGoldField,
  isJunkHeader,
  loadNormalizeMap,
  loadSuiteEnums,
  suiteAnnotationsDir
} from '../utils/label-normalize.js';

const SKIP_REVIEW_FILES = /^\./;
const GENERATED_REVIEW_FILES = new Set(['_flags.csv', '_consensus.csv']);

export { coerceCell, loadNormalizeMap, detectDelimiter, isJunkHeader, caseIdFromValue };

export function parseArgs(argv) {
  const args = {
    inDir: null,
    outDir: null,
    idColumn: null,
    columns: null,
    majority: null,
    dryRun: false,
    help: false,
    normalize: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--in' && argv[i + 1]) {
      args.inDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--out' && argv[i + 1]) {
      args.outDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--id' && argv[i + 1]) {
      args.idColumn = argv[i + 1];
      i += 1;
    } else if (token === '--columns' && argv[i + 1]) {
      args.columns = argv[i + 1].split(/[,;]/).map(name => name.trim()).filter(Boolean);
      i += 1;
    } else if (token === '--normalize' && argv[i + 1]) {
      args.normalize = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--no-normalize') {
      args.normalize = false;
    } else if (token === '--majority') {
      args.majority = true;
    } else if (token === '--no-majority') {
      args.majority = false;
    } else if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

export function printHelp() {
  console.log(`Aggregate annotator CSVs into gold labels/{id}.json.

Usage:
  npm run aggregate-gold -- [--in DIR] [--out DIR] [--id COLUMN] [--columns a,b,c]
                            [--majority | --no-majority] [--normalize FILE | --no-normalize]
                            [--dry-run]
`);
}

export function cellKey(value) {
  if (value === true) {
    return 'true';
  }
  if (value === false) {
    return 'false';
  }
  return String(value);
}

export function majorityOf(votes, annotatorCount, options = {}) {
  const counts = new Map();
  for (const vote of votes) {
    const coerced = coerceCell(vote, options);
    if (coerced.skip) {
      continue;
    }
    const key = cellKey(coerced.value);
    const entry = counts.get(key) || { value: coerced.value, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }

  const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
  if (ranked.length === 0) {
    return { value: null, reason: 'missing', votes: [], weak: false };
  }
  if (ranked.length > 1 && ranked[0].count === ranked[1].count) {
    return { value: null, reason: 'tie', votes: ranked, weak: false };
  }
  const voted = ranked.reduce((sum, entry) => sum + entry.count, 0);
  if (ranked[0].count <= voted / 2) {
    return { value: null, reason: 'no_majority', votes: ranked, weak: false };
  }
  const weak = ranked[0].count <= annotatorCount / 2 ||
    (ranked.length > 1 && ranked[0].count === Math.ceil(voted / 2));
  return { value: ranked[0].value, reason: null, votes: ranked, weak };
}

export function listAnnotationCsvs(inPath) {
  if (!fs.existsSync(inPath)) {
    throw new Error(
      `Annotations path not found: ${inPath}. ` +
      `Set INPUT_EXPERIMENT or INPUT_ANNOTATIONS_DIR, or pass --in.`
    );
  }
  const stat = fs.statSync(inPath);
  if (stat.isFile()) {
    if (!inPath.toLowerCase().endsWith('.csv')) {
      throw new Error(`Expected a .csv file: ${inPath}`);
    }
    return [inPath];
  }
  return fs.readdirSync(inPath)
    .filter(name => name.toLowerCase().endsWith('.csv'))
    .filter(name => !SKIP_REVIEW_FILES.test(name) && !GENERATED_REVIEW_FILES.has(name))
    .sort()
    .map(name => path.join(inPath, name));
}

function dropJunkColumns(records) {
  const rawHeaders = Object.keys(records[0] || {});
  const headers = rawHeaders.filter(header => !isJunkHeader(header));
  const rows = records.map(record => {
    const next = {};
    for (const header of headers) {
      next[header] = record[header];
    }
    return next;
  });
  return { headers, rows };
}

export function parseAnnotationCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const records = parseCsv(text);
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`No data rows in ${filePath}`);
  }
  const { headers, rows } = dropJunkColumns(records);
  if (headers.length === 0) {
    throw new Error(`No columns in ${filePath}`);
  }
  return { filePath, name: path.basename(filePath), headers, rows };
}

export function requireColumn(headers, name, fileName) {
  if (!headers.includes(name)) {
    throw new Error(`Column "${name}" missing from ${fileName} (have: ${headers.join(', ')})`);
  }
}

export function fileNameFromId(id) {
  return goldFileName(id);
}

export function rowsById(table, idColumn) {
  requireColumn(table.headers, idColumn, table.name);
  const byId = new Map();
  for (const row of table.rows) {
    const id = caseIdFromValue(row[idColumn]);
    if (!id) {
      throw new Error(`Empty ${idColumn} in ${table.name}`);
    }
    if (byId.has(id)) {
      throw new Error(`Duplicate ${idColumn} "${id}" in ${table.name}`);
    }
    byId.set(id, row);
  }
  return byId;
}

function formatVoteCounts(ranked) {
  return ranked.map(entry => `${cellKey(entry.value)}:${entry.count}`).join(';');
}

export function mergeAnnotations(tables, { idColumn, columns, majority, aliases = {}, fieldNames = [], enums = {} }) {
  if (tables.length === 0) {
    throw new Error('No annotation CSVs to ingest');
  }
  for (const table of tables) {
    requireColumn(table.headers, idColumn, table.name);
    for (const column of columns) {
      if (column === STATED_CONFIDENCE) {
        throw new Error('stated_confidence is model-only; do not ingest it from annotations');
      }
      requireColumn(table.headers, column, table.name);
    }
  }

  const ids = new Set();
  const indexed = tables.map(table => {
    const byId = rowsById(table, idColumn);
    for (const id of byId.keys()) {
      ids.add(id);
    }
    return { table, byId };
  });

  const source = majority ? indexed : indexed.slice(0, 1);
  const annotatorCount = source.length;
  const labels = [];
  const flags = [];
  const consensusRows = [];

  for (const id of [...ids].sort()) {
    const record = {};
    const consensusRow = { [idColumn]: id };

    for (const column of columns) {
      const canonical = canonicalFieldName(column, fieldNames);
      const keepInGold = isGoldField(canonical, fieldNames);
      const coerceOptions = { column: canonical, aliases, enums };
      const rawVotes = source.map(({ byId }) => {
        const row = byId.get(id);
        return row ? row[column] : '';
      });

      if (!majority || annotatorCount === 1) {
        const coerced = coerceCell(rawVotes[0], coerceOptions);
        if (coerced.skip) {
          consensusRow[column] = '';
          continue;
        }
        if (keepInGold) {
          record[canonical] = coerced.value;
        }
        consensusRow[column] = cellKey(coerced.value);
        continue;
      }

      const result = majorityOf(rawVotes, annotatorCount, coerceOptions);
      if (result.reason) {
        if (keepInGold) {
          flags.push({ id, column: canonical, votes: formatVoteCounts(result.votes), reason: result.reason });
        }
        consensusRow[column] = '';
        continue;
      }
      if (keepInGold) {
        record[canonical] = result.value;
      }
      consensusRow[column] = cellKey(result.value);
      if (keepInGold && result.weak) {
        flags.push({ id, column: canonical, votes: formatVoteCounts(result.votes), reason: 'weak_majority' });
      }
    }

    if (Object.keys(record).length === 0) {
      flags.push({ id, column: '*', votes: '', reason: 'empty' });
      consensusRows.push(consensusRow);
      continue;
    }

    labels.push({ id, record });
    consensusRows.push(consensusRow);
  }

  return { labels, flags, consensusRows, idColumn, columns, annotatorCount };
}

export function writeOutputs({ outDir, annotationsDir, labels, flags, consensusRows, idColumn, columns, dryRun }) {
  const written = labels.filter(entry => Object.keys(entry.record).length > 0);
  const planned = {
    labels: written.map(entry => path.join(outDir, fileNameFromId(entry.id))),
    flagsPath: path.join(annotationsDir, '_flags.csv'),
    consensusPath: path.join(annotationsDir, '_consensus.csv')
  };

  if (dryRun) {
    return planned;
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of written) {
    fs.writeFileSync(
      path.join(outDir, fileNameFromId(entry.id)),
      `${JSON.stringify(entry.record, null, 2)}\n`
    );
  }

  fs.mkdirSync(annotationsDir, { recursive: true });
  fs.writeFileSync(planned.flagsPath, stringifyCsv(['id', 'column', 'votes', 'reason'], flags));
  fs.writeFileSync(planned.consensusPath, stringifyCsv([idColumn, ...columns], consensusRows));
  return planned;
}

async function defaultDirs() {
  const { CONFIGURATION } = await import('../src/config.js');
  const annotationsDir = suiteAnnotationsDir(CONFIGURATION.directories.root, CONFIGURATION.directories);
  return {
    inDir: annotationsDir,
    outDir: CONFIGURATION.directories.labels,
    annotationsDir
  };
}

async function promptChoices({ tables, args }) {
  const headers = tables[0].headers;
  let idColumn = args.idColumn;
  let columns = args.columns;
  let majority = args.majority;

  const needsTui = !idColumn || !columns ||
    (tables.length > 1 && majority === null) ||
    (tables.length > 1 && majority === false);

  if (needsTui) {
    const interactive = Boolean(process.stdin.isTTY);
    if (!interactive) {
      if (!idColumn) {
        idColumn = headers[0];
      }
      if (!columns) {
        throw new Error('Pass --columns or run in a terminal to pick columns');
      }
      if (tables.length > 1 && majority !== true) {
        throw new Error('Multiple annotation CSVs require --majority, or pass a single file to --in');
      }
    } else {
      const { checkbox, select, confirm } = await import('@inquirer/prompts');

      if (!idColumn) {
        idColumn = await select({
          message: 'Which column is the case id?',
          choices: headers.map(header => ({ name: header, value: header })),
          default: headers[0]
        });
      }

      if (!columns) {
        const choices = headers
          .filter(header => header !== idColumn && header !== STATED_CONFIDENCE)
          .map(header => ({ name: header, value: header, checked: true }));
        if (choices.length === 0) {
          throw new Error('No label columns left after picking the id column');
        }
        columns = await checkbox({
          message: 'Which columns become gold labels?',
          choices,
          required: true
        });
      }

      if (tables.length > 1 && majority === null) {
        majority = await confirm({
          message: `Majority-vote across ${tables.length} annotators?`,
          default: true
        });
      }

      if (tables.length > 1 && majority === false) {
        const picked = await select({
          message: 'Which annotation CSV to copy as gold?',
          choices: tables.map(table => ({ name: table.name, value: table.filePath }))
        });
        tables = tables.filter(table => table.filePath === picked);
      }
    }
  }

  if (!idColumn) {
    idColumn = headers[0];
  }
  if (!columns) {
    throw new Error('Pass --columns or run without it to pick columns in the TUI');
  }
  if (majority === null) {
    majority = tables.length > 1;
  }

  return { idColumn, columns, majority, tables };
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { help: true };
  }

  const defaults = args.inDir && args.outDir
    ? {
      inDir: args.inDir,
      outDir: args.outDir,
      annotationsDir: fs.existsSync(args.inDir) && fs.statSync(args.inDir).isFile()
        ? path.dirname(args.inDir)
        : args.inDir
    }
    : await defaultDirs();
  const inPath = args.inDir || defaults.inDir;
  const outDir = args.outDir || defaults.outDir;
  const annotationsDir = fs.existsSync(inPath) && fs.statSync(inPath).isFile()
    ? path.dirname(inPath)
    : inPath;

  const files = listAnnotationCsvs(inPath);
  if (files.length === 0) {
    throw new Error(`No annotation CSVs in ${inPath}`);
  }
  const aliases = args.normalize === false
    ? {}
    : loadNormalizeMap(args.normalize || path.join(annotationsDir, 'normalize.json'));
  const loaded = files.map(parseAnnotationCsv);
  const prompted = await promptChoices({ tables: loaded, args });
  const fieldNames = fieldNamesFromSuite({ root: path.dirname(outDir) });
  const enums = loadSuiteEnums({ root: path.dirname(outDir) });
  const merged = mergeAnnotations(prompted.tables, {
    idColumn: prompted.idColumn,
    columns: prompted.columns,
    majority: prompted.majority,
    aliases,
    fieldNames,
    enums
  });

  const planned = writeOutputs({
    outDir,
    annotationsDir,
    labels: merged.labels,
    flags: merged.flags,
    consensusRows: merged.consensusRows,
    idColumn: prompted.idColumn,
    columns: prompted.columns,
    dryRun: args.dryRun
  });

  const summary = {
    annotators: prompted.tables.map(table => table.name),
    majority: prompted.majority && prompted.tables.length > 1,
    cases: merged.labels.length,
    fields: prompted.columns,
    flags: merged.flags.length,
    outDir,
    dryRun: args.dryRun,
    ...planned
  };

  if (args.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  console.log(`Wrote ${merged.labels.length} gold labels to ${outDir}` +
    (merged.flags.length ? ` (${merged.flags.length} flags)` : ''));
  return summary;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  run().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
