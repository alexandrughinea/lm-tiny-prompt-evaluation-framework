import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isPlainObject, loadFieldNames } from '../evaluators/labels.js';
import { loadSidecarImages, loadStandaloneImageCases } from '../utils/media-utils.js';
import { FORMATTERS } from '../utils/sft-formats.js';
import { loadNormalizeMap, loadSuiteEnums, normalizeScalar, PASSTHROUGH_GOLD_KEYS, readGoldFile } from '../utils/label-normalize.js';
import { indexTextFiles, resolveTextPath } from '../utils/text-files.js';
import { CONFIGURATION } from '../src/config.js';

const FORMATS = new Set(Object.keys(FORMATTERS));

export function parseArgs(argv) {
  const args = {
    format: null,
    prompt: null,
    out: null,
    holdout: null,
    dropImages: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--format' && argv[i + 1]) {
      args.format = argv[i + 1];
      i += 1;
    } else if (token === '--prompt' && argv[i + 1]) {
      args.prompt = argv[i + 1];
      i += 1;
    } else if (token === '--out' && argv[i + 1]) {
      args.out = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--holdout' && argv[i + 1]) {
      args.holdout = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--drop-images') {
      args.dropImages = true;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

export function printHelp() {
  console.log(`Export gold + cases to SFT JSONL (does not train).

Usage:
  npm run export-sft -- --format text|unsloth|qwen-vl|llama --prompt v1 --out train.jsonl
                         [--holdout ids.txt] [--drop-images]
`);
}

export function readHoldout(filePath) {
  if (!filePath) {
    return new Set();
  }
  return new Set(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
  );
}

export function goldAssistant(label, aliases = {}, options = {}) {
  if (!isPlainObject(label)) {
    return null;
  }
  const out = {};
  for (const [key, value] of Object.entries(label)) {
    if (PASSTHROUGH_GOLD_KEYS.has(key)) {
      continue;
    }
    out[key] = normalizeScalar(value, key, aliases, options) ?? value;
  }
  return out;
}

export function loadPromptPair(promptsDir, suffix) {
  const systemPath = resolveTextPath(promptsDir, `system_${suffix}`);
  const userPath = resolveTextPath(promptsDir, `user_${suffix}`);
  if (!systemPath || !userPath) {
    throw new Error(`Missing prompt pair system_${suffix}.txt|md / user_${suffix}.txt|md in ${promptsDir}`);
  }
  return {
    system: fs.readFileSync(systemPath, 'utf8').trimEnd(),
    user: fs.readFileSync(userPath, 'utf8').trimEnd()
  };
}

export async function listCases(dataDir) {
  if (!fs.existsSync(dataDir)) {
    return [];
  }
  const files = fs.readdirSync(dataDir);
  const cases = [];
  const textBasenames = [];

  for (const [id, file] of indexTextFiles(files)) {
    const text = fs.readFileSync(path.join(dataDir, file), 'utf8');
    const images = await loadSidecarImages(dataDir, id, files);
    textBasenames.push(id);
    cases.push({
      id,
      text,
      imagePaths: images.map(img => path.resolve(dataDir, img.filename))
    });
  }

  for (const imageCase of await loadStandaloneImageCases(dataDir, files, textBasenames)) {
    cases.push({
      id: imageCase.name,
      text: imageCase.text || '',
      imagePaths: imageCase.images.map(img => path.resolve(dataDir, img.filename))
    });
  }

  cases.sort((a, b) => a.id.localeCompare(b.id));
  return cases;
}

export async function runExport(options) {
  const format = options.format;
  if (!FORMATS.has(format)) {
    throw new Error(`Unknown --format ${format} (use text, unsloth, qwen-vl, llama)`);
  }
  if (!options.prompt) {
    throw new Error('--prompt is required');
  }
  if (!options.out) {
    throw new Error('--out is required');
  }

  const dataDir = options.dataDir;
  const labelsDir = options.labelsDir;
  const promptsDir = options.promptsDir;
  const dropImages = Boolean(options.dropImages);
  const holdout = options.holdout instanceof Set
    ? options.holdout
    : readHoldout(options.holdout);
  const aliases = options.aliases ?? {};
  const prompts = loadPromptPair(promptsDir, options.prompt);
  const formatter = FORMATTERS[format];
  const cases = await listCases(dataDir);
  const rows = [];
  const skipped = { holdout: [], noGold: [], droppedImages: [] };
  const warnings = [];

  for (const item of cases) {
    if (holdout.has(item.id)) {
      skipped.holdout.push(item.id);
      continue;
    }
    if (format === 'text' && item.imagePaths.length > 0) {
      if (dropImages) {
        skipped.droppedImages.push(item.id);
        continue;
      }
      throw new Error(
        `Case ${item.id} has images; --format text cannot include them (use --drop-images or a vision --format)`
      );
    }
    const gold = readGoldFile(labelsDir, item.id, options.fieldNames);
    if (gold.error) {
      skipped.noGold.push(item.id);
      warnings.push(gold.error);
      continue;
    }
    const user = `${prompts.user}${item.text}`;
    rows.push(formatter({
      id: item.id,
      system: prompts.system,
      user,
      assistant: goldAssistant(gold.label, aliases, { enums: options.enums }),
      imagePaths: item.imagePaths
    }));
  }

  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));

  return { out: options.out, n: rows.length, skipped, warnings };
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return null;
  }
  const aliases = loadNormalizeMap(path.join(CONFIGURATION.directories.annotations, 'normalize.json'));
  const summary = await runExport({
    format: args.format,
    prompt: args.prompt,
    out: args.out,
    holdout: args.holdout,
    dropImages: args.dropImages,
    dataDir: CONFIGURATION.directories.data,
    labelsDir: CONFIGURATION.directories.labels,
    promptsDir: CONFIGURATION.directories.prompts,
    fieldNames: loadFieldNames(),
    aliases,
    enums: loadSuiteEnums({
      root: CONFIGURATION.directories.root,
      schemasDir: CONFIGURATION.directories.schemas
    })
  });
  for (const warning of summary.warnings) {
    console.warn(warning);
  }
  console.log(`Wrote ${summary.n} SFT rows to ${summary.out}`);
  return summary;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  run().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
