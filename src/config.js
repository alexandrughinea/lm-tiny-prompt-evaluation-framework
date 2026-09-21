import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import {fileURLToPath} from 'url';
import { resolveExperiment, resolveInputDir } from '../utils/suite-resolve.js';

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

function loadExperimentConfig(suiteRoot) {
  const parsed = readJsonIfPresent(path.join(suiteRoot, 'config.json'));
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

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function readSuiteSettings(experiment = {}, env = {}) {
  const model = asObject(experiment.model);
  const evalBlock = asObject(experiment.eval);
  const temperature = parseFloat(configOrEnv(
    model.temperature ?? experiment.temperature,
    env.TEMPERATURE,
    DEFAULTS.models.temperature
  ));
  const top_p = parseFloat(configOrEnv(
    model.top_p ?? experiment.top_p,
    env.TOP_P,
    DEFAULTS.models.top_p
  ));
  const max_tokens = parseInt(
    configOrEnv(model.max_tokens ?? experiment.max_tokens, env.MAX_TOKENS, DEFAULTS.models.max_tokens),
    10
  );
  const structuredOutput = String(configOrEnv(
    model.structured_output ?? experiment.use_structured_output,
    env.USE_STRUCTURED_OUTPUT_SCHEMA,
    true
  )) === 'true';
  const evalRepeats = Math.max(1, parseInt(
    configOrEnv(evalBlock.repeats ?? experiment.consistency_n, env.CONSISTENCY_N, 3),
    10
  ) || 3);

  return {
    temperature,
    top_p,
    max_tokens,
    structuredOutput,
    evalRepeats
  };
}

const { name, root } = resolveExperiment({
  env: process.env,
  projectRoot: PROJECT_ROOT,
  examplesRoot: EXAMPLES_ROOT,
  inputsRoot: INPUT_ROOT,
  defaultExperiment: DEFAULT_EXPERIMENT
});
const experiment = loadExperimentConfig(root);
const suiteSettings = readSuiteSettings(experiment, process.env);

function resolveModels() {
  if (Array.isArray(experiment.models) && experiment.models.length > 0) {
    return experiment.models.filter(model => typeof model === 'string' && model.length > 0);
  }
  if (process.env.DEFAULT_MODELS) {
    return process.env.DEFAULT_MODELS.split(',').map(model => model.trim()).filter(Boolean);
  }
  return DEFAULTS.models.default;
}

function dirFromEnv(envKey, fallback) {
  return resolveInputDir(process.env, envKey, PROJECT_ROOT, fallback);
}

export const CONFIGURATION = {
  experiment: name,
  modelServer: {
    url: process.env.MODEL_SERVER_URL || DEFAULTS.modelServer.url,
  },
  models: {
    default: resolveModels(),
    max_tokens: suiteSettings.max_tokens,
    temperature: suiteSettings.temperature,
    top_p: suiteSettings.top_p
  },
  eval: {
    repeats: suiteSettings.evalRepeats
  },
  structuredOutput: suiteSettings.structuredOutput,
  directories: {
    root,
    prompts: dirFromEnv('INPUT_PROMPTS_DIR', path.join(root, 'prompts')),
    data: dirFromEnv('INPUT_DATA_DIR', path.join(root, 'data')),
    labels: dirFromEnv('INPUT_LABELS_DIR', path.join(root, 'labels')),
    annotations: dirFromEnv('INPUT_ANNOTATIONS_DIR', path.join(root, 'annotations')),
    reviews: path.join(root, 'reviews'),
    schemas: dirFromEnv('INPUT_SCHEMAS_DIR', path.join(root, 'schemas')),
    evaluators: dirFromEnv('INPUT_EVALUATORS_DIR', path.join(root, 'evaluators')),
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
