import dotenv from 'dotenv';
import path from 'path';
import {fileURLToPath} from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default configuration values
const DEFAULT_CONFIGURATION = {
  modelServer: {
    url: 'http://127.0.0.1:1234',
  },
  models: {
    default: ['phi-3.1-mini-128k-instruct'],
    max_tokens: 30000,
    temperature: 0.7,
    top_p: 0.95,
  },
  directories: {
    data: path.join(__dirname, '..', 'input', 'data'),
    prompts: path.join(__dirname, '..', 'input', 'prompts', 'txt'),
    schemas: path.join(__dirname, '..', 'input', 'schemas'),
    evaluators: path.join(__dirname, '..', 'input', 'evaluators'),
    results: path.join(__dirname, '..', 'results'),
  },
};
export const CONFIGURATION = {
  modelServer: {
    url: process.env.MODEL_SERVER_URL || DEFAULT_CONFIGURATION.modelServer.url,
  },
  models: {
    default: process.env.DEFAULT_MODELS ? 
      process.env.DEFAULT_MODELS.split(',').map(model => model.trim()) : 
      DEFAULT_CONFIGURATION.models.default,
    max_tokens: parseInt(process.env.MAX_TOKENS || DEFAULT_CONFIGURATION.models.max_tokens, 10),
    temperature: parseFloat(process.env.TEMPERATURE || DEFAULT_CONFIGURATION.models.temperature),
    top_p: parseFloat(process.env.TOP_P || DEFAULT_CONFIGURATION.models.top_p),
  },
  directories: {
    prompts: process.env.INPUT_PROMPTS_DIR ? 
      path.resolve(process.env.INPUT_PROMPTS_DIR) : 
      DEFAULT_CONFIGURATION.directories.prompts,
    data: process.env.INPUT_DATA_DIR ? 
      path.resolve(process.env.INPUT_DATA_DIR) : 
      DEFAULT_CONFIGURATION.directories.data,
    results: process.env.RESULTS_DIR ? 
      path.resolve(process.env.RESULTS_DIR) : 
      DEFAULT_CONFIGURATION.directories.results,
    schemas: process.env.INPUT_SCHEMAS_DIR ? 
      path.resolve(process.env.INPUT_SCHEMAS_DIR) : 
      DEFAULT_CONFIGURATION.directories.schemas,
    evaluators: process.env.INPUT_EVALUATORS_DIR ? 
      path.resolve(process.env.INPUT_EVALUATORS_DIR) : 
      DEFAULT_CONFIGURATION.directories.evaluators,
  },
  performance: {
    concurrencyLimit: parseInt(process.env.CONCURRENCY_LIMIT || '3', 10),
    // Enable caching to avoid re-evaluating identical combinations
    caching: {
      enabled: process.env.ENABLE_RESPONSE_CACHING === 'true',
      directory: process.env.CACHE_DIR || path.join(__dirname, '..', 'cache')
    }
  },
};
