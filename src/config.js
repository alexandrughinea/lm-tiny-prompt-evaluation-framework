import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const INPUT_ROOT = path.join(PROJECT_ROOT, 'inputs');
const EXAMPLES_ROOT = path.join(PROJECT_ROOT, 'examples');
const DEFAULT_EXPERIMENT = 'cat-detector-suite';

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const DEFAULTS = {
  modelServer: {
    url: 'http://127.0.0.1:1234',
  },
  models: {
    default: ['phi-3.1-mini-128k-instruct'],
    max_tokens: 30000,
    temperature: 0.7,
    top_p: 0.95,
  },
  performance: {
    imageTokenAllowance: 2000,
  },
};

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listSuiteNames(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

function experimentName() {
  return (process.env.INPUT_EXPERIMENT || process.env.EXPERIMENT || DEFAULT_EXPERIMENT).trim();
}

function isSuiteDir(dir) {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

function experimentRoot() {
  const name = experimentName();
  const bundled = path.resolve(EXAMPLES_ROOT, name);
  if (isSuiteDir(bundled)) {
    return bundled;
  }
  const local = path.resolve(INPUT_ROOT, name);
  if (isSuiteDir(local)) {
    return local;
  }

  const examples = listSuiteNames(EXAMPLES_ROOT);
  const inputs = listSuiteNames(INPUT_ROOT);
  const hint = [
    examples.length ? `examples: ${examples.join(', ')}` : '',
    inputs.length ? `inputs: ${inputs.join(', ')}` : ''
  ].filter(Boolean).join('; ');
  throw new Error(
    `Suite "${name}" not found under inputs/ or examples/. Set INPUT_EXPERIMENT to a suite folder name.` +
    (hint ? ` Available (${hint}).` : '')
  );
}

function loadExperimentConfig(root) {
  const parsed = readJsonIfPresent(path.join(root, 'config.json'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function configOrEnv(configValue, envValue, fallback) {
  if (configValue !== undefined && configValue !== '') {
    return configValue;
  }
  if (envValue !== undefined && envValue !== '') {
    return envValue;
  }
  return fallback;
}

const root = experimentRoot();
const experiment = loadExperimentConfig(root);
const name = experimentName() || path.basename(root);

function resolveModels() {
  if (Array.isArray(experiment.models) && experiment.models.length > 0) {
    return experiment.models.filter(model => typeof model === 'string' && model.length > 0);
  }
  if (process.env.DEFAULT_MODELS) {
    return process.env.DEFAULT_MODELS.split(',').map(model => model.trim()).filter(Boolean);
  }
  return DEFAULTS.models.default;
}

export const CONFIGURATION = {
  experiment: name,
  modelServer: {
    url: process.env.MODEL_SERVER_URL || DEFAULTS.modelServer.url,
  },
  models: {
    default: resolveModels(),
    max_tokens: parseInt(
      configOrEnv(experiment.max_tokens, process.env.MAX_TOKENS, DEFAULTS.models.max_tokens),
      10
    ),
    temperature: parseFloat(
      configOrEnv(experiment.temperature, process.env.TEMPERATURE, DEFAULTS.models.temperature)
    ),
    top_p: parseFloat(
      configOrEnv(experiment.top_p, process.env.TOP_P, DEFAULTS.models.top_p)
    ),
  },
  structuredOutput: String(configOrEnv(
    experiment.use_structured_output,
    process.env.USE_STRUCTURED_OUTPUT_SCHEMA,
    true
  )) === 'true',
  directories: {
    root,
    prompts: path.join(root, 'prompts'),
    data: path.join(root, 'data'),
    labels: path.join(root, 'labels'),
    schemas: path.join(root, 'schemas'),
    evaluators: path.join(root, 'evaluators'),
    results: process.env.RESULTS_DIR
      ? path.resolve(process.env.RESULTS_DIR)
      : path.join(PROJECT_ROOT, 'results', name),
  },
  performance: {
    concurrencyLimit: parseInt(process.env.CONCURRENCY_LIMIT || '3', 10),
    imageTokenAllowance: parseInt(
      process.env.IMAGE_TOKEN_ALLOWANCE || DEFAULTS.performance.imageTokenAllowance,
      10
    ),
    caching: {
      enabled: process.env.ENABLE_RESPONSE_CACHING === 'true',
      directory: process.env.CACHE_DIR || path.join(PROJECT_ROOT, 'cache')
    }
  },
};
