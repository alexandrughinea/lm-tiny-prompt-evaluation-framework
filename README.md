# lm-tiny-prompt-evaluation-framework

## Overview
This project provides a tiny framework for testing different prompt versions with various AI models. 
It includes tools for evaluating the performance of different prompt-model combinations, correlating results, and visualizing the analysis.

## Features
- Test different prompt versions against multiple AI models
- Support for plain text prompts and data
- Correlation system to track relationships between models, data, prompts, and results
- Evaluate responses using quantitative and qualitative metrics
- Compare and visualize results across different models and prompts
- Environment variable configuration for flexibility

## Prerequisites
- Node.js (v14 or higher recommended)
- npm or yarn
- A local or remote server exposing OpenAI-compatible API endpoints
- Environment variables configured (see Configuration section)

### Supported API Endpoints
The framework requires a server that exposes the following OpenAI-compatible endpoints:
- `GET /v1/models` - Lists available models
- `POST /v1/chat/completions` - Executes chat completions
- `POST /v1/completions` - Executes completions (legacy)
- `POST /v1/embeddings` - Generates embeddings (optional)

### Compatible Model Servers
Several open-source projects provide OpenAI-compatible API servers:

| Software | OpenAI API Compatible | GUI | Setup Difficulty | Deployment |
|----------|----------------------|-----|-----------------|------------|
| vLLM     | ✅ Yes               | ❌   | Medium          | Local/Cloud |
| LM Studio| ✅ Yes               | ✅   | Easy            | Local      |
| Ollama   | ✅ Yes               | ❌   | Very Easy       | Local      |
| FastChat | ✅ Yes               | ❌   | Medium          | Local/Cloud |
| TGI      | ❌ Not directly      | ❌   | Medium          | Cloud      |

You can use any of these solutions or any other server that implements the required OpenAI-compatible endpoints.

## Installation

1. Clone the repository
2. Install the dependencies:

```bash
npm install
# or
yarn install
```

3. Copy the `.env.example` file to `.env` and configure your environment variables:

```bash
cp .env.example .env
```

4. Edit the `.env` file with your specific configuration

## Project Structure
- `src/` - Core source code
  - `adapters/` - Model adapters for different AI services
  - `config.js` - Configuration management
  - `correlator.js` - Correlation system implementation
  - `evaluator.js` - Response evaluation logic
  - `framework.js` - Main framework implementation
- `input/` - Input files for testing
  - `data/` - Test data files
  - `evaluators/` - Custom evaluation scripts
  - `prompts/` - Prompt templates
  - `schemas/` - JSON schemas for structured output
- `utils/` - Utility scripts
  - `convert-to-csv.js` - CSV conversion utilities
  - `correlation-viewer.js` - Tool for viewing correlations
  - `csv-exporter.js` - CSV export functionality
  - `test-connection.js` - Connection testing utility
- `results/` - Test results output directory

## Usage

### Running Tests

To run the tests with all available models, prompts, and input files:

```
npm run test
```

This will:
1. Load all prompts from the configured prompts directory
2. Load all input files from the configured data directory
3. Run tests for each combination of model, prompt, and input file
4. Create a timestamped run directory with all results
5. Generate CSV files, a JSON result file, and a markdown report

### Testing Connection

To test the connection to the model server:

```
npm run test-connection
```

### Viewing Correlations

To view correlations between models, prompts, and input files:

```
npm run correlations
```

The correlation viewer supports various options:

- `--list` or `-l`: List all correlations (default)
- `--compare` or `-c`: Compare multiple correlations
- `--detail` or `-d`: Show detailed information for a correlation
- `--model=<modelId>`: Filter by model ID
- `--file=<input_data_file>`: Filter by input file
- `--prompt=<input_user_prompt>`: Filter by prompt file
- `--id=<correlationId>`: Specify a correlation ID (can be used multiple times)
- `--format=<format>`: Output format (table, json)

## Extending the Framework

### Adding Input Files

Place your input files in the configured data directory (default: `input/data/`). Each file should be a plain text file with a `.txt` extension.

### Adding Prompts

Add new prompt templates in the configured prompts directory (default: `input/prompts/`). Each prompt should be a plain text file with a `.txt` extension.

### Adding Schemas

If using structured output (enabled by default with `USE_STRUCTURED_OUTPUT_SCHEMA=true`), place your JSON schemas in the `input/schemas/` directory. These schemas define the expected structure of model responses.

### Custom Evaluators

The framework supports custom evaluators for both quantitative and qualitative assessment. To create custom evaluators:

1. Create JavaScript files in the `input/evaluators/` directory:
   - `qualitative.js` - For qualitative assessment (strengths, weaknesses, suggestions)
   - `quantitative.js` - For quantitative metrics (accuracy, completeness, relevance)

2. Export the appropriate functions:

```javascript
// quantitative.js
export function evaluateQuantitative(result, options = {}) {
  // Your custom quantitative evaluation logic
  return {
    accuracy: 0.8,    // Score between 0-1
    completeness: 0.7, // Score between 0-1
    relevance: 0.9,   // Score between 0-1
    overall: 0.8      // Overall score between 0-1
  };
}

// qualitative.js
export function evaluateQualitative(result, options = {}) {
  // Your custom qualitative evaluation logic
  return {
    strengths: ['Clear explanation', 'Well structured'],
    weaknesses: ['Missing some details'],
    suggestions: ['Add more specific examples']
  };
}
```

3. The framework will automatically load and use your custom evaluators if they exist.

### Runtime Assessment Functions

Both the default and custom evaluators support runtime assessment functions passed via options:

```javascript
// Example of passing custom assessment function
const options = {
  assessmentFn: (result, options) => {
    // Custom assessment logic
    return {
      accuracy: 0.95,
      // other metrics or qualitative assessments
    };
  }
};
```

## Results Organization

Each test run creates a timestamped directory in the results folder with the following structure:

```
results/
└── run_2025-05-14T15-00-00-000Z/
    ├── model1_results_2025-05-14T15-00-00-000Z.csv
    ├── model2_results_2025-05-14T15-00-00-000Z.csv
    ├── correlation_index_2025-05-14T15-00-00-000Z.json
    ├── results_2025-05-14T15-00-00-000Z.json
    └── report_2025-05-14T15-00-00-000Z.md
```

This organization keeps all files related to a single test run together, making it easier to manage and archive test results.

## Configuration

The framework is configured using environment variables. Copy the `.env.example` file to `.env` and customize as needed:

```
# Model Server Configuration
MODEL_SERVER_URL=http://127.0.0.1:1234

# Model Configuration
DEFAULT_MODELS=phi-4,mistralai/mistral-nemo-instruct-2407
MAX_TOKENS=60000
TEMPERATURE=0.7
TOP_P=0.95
USE_STRUCTURED_OUTPUT_SCHEMA=true

# Directory Configuration
INPUT_PROMPTS_DIR=input/prompts
INPUT_SCHEMAS_DIR=input/schemas
INPUT_DATA_DIR=input/data
RESULTS_DIR=results

# Request Configuration
REQUEST_TIMEOUT_MS=120000
```

Key configuration options:

- `MODEL_SERVER_URL`: URL of your AI model server
- `DEFAULT_MODELS`: Comma-separated list of models to test
- `USE_STRUCTURED_OUTPUT_SCHEMA`: Enable structured output using JSON schemas
- Directory paths for inputs and outputs
- Model parameters like temperature and max tokens

## Correlation System

The correlation system tracks relationships between models, input files, prompts, and results, enabling comprehensive analysis of different combinations.

### How Correlations Work

Each time a test is run, the system automatically creates correlations that link:
- The model used (e.g., `phi-4`)
- The input file analyzed (e.g., `sample_document.txt`)
- The prompt used (e.g., `detailed_analysis.txt`)
- The results and metrics from the analysis

These correlations are stored in the run directory and can be queried to answer questions like:
- Which prompt performs best with a specific model?
- How does a particular model handle different types of input files?
- Which model-prompt combination yields the highest accuracy?

### Using Correlations for Analysis

The correlation viewer supports several analysis workflows:

1. **Filtering**: Find all correlations involving a specific model, input file, or prompt
2. **Comparison**: Directly compare metrics between different correlations
3. **Detailed Analysis**: Examine the full details of a specific correlation

This system makes it easy to identify patterns and make data-driven decisions about which combinations work best for your specific use case.

### Sample program output

```bash
> lm-tiny-prompt-evaluation-framework@1.0.0 test
> node src/framework.js

Starting tests...
Available models: mistral-nemo-instruct-2407, text-embedding-nomic-embed-text-v1.5, mistralai/mistral-nemo-instruct-2407, yarn-mistral-7b-128k, phi-4, mistral-7b-instruct-v0.2
Models to test: mistralai/mistral-nemo-instruct-2407
Loaded prompt file: system_v1_basic.txt
Loaded prompt file: user_v1_advanced.txt
Loaded prompt file: user_v3_advanced.txt
Skipping non-txt file: .DS_Store
Loaded data file: en_sample_one.txt
Loaded data file: en_sample_two.txt
Loaded 3 prompts and 2 data files.
Skipping evaluation for system prompt: system_v1_basic (will be correlated with user prompts)
Running all 30 test cases
Running tests with concurrency limit: 1

============================================================
🔍 STARTING TEST EXECUTION - 4 total test cases across 1 models
============================================================

────────────────────────────────────────────────────────────
📦 Processing model (1/1): mistralai/mistral-nemo-instruct-2407
📋 Test cases: 4
⏳ Estimated time: ~15 minutes
────────────────────────────────────────────────────────────


==================================================
🧪 TEST 1/30 - STARTED
==================================================
📋 Test Details:
  • Model: mistralai/mistral-nemo-instruct-2407
  • Prompt: user_v1_advanced (user type)
  • File: en_sample_one
──────────────────────────────────────────────────
⏳ Executing prompt...
Using chat mode for prompt: v1_advanced
JSON schema loaded successfully
OpenAIAdapter initialized with model: mistral-nemo-instruct-2407, max_tokens: 60000
Request details: {"model":"mistralai/mistral-nemo-instruct-2407","prompt_length":13320,"max_tokens":60000,"temperature":0.7,"top_p":0.95}
Using OpenAIAdapter to connect to http://127.0.0.1:1234
Request details: {"model":"mistralai/mistral-nemo-instruct-2407","prompt_length":13320,"max_tokens":60000,"temperature":0.7,"top_p":0.95}
Using default system content
Using messages with system (95 chars) and user (13320 chars) roles
Using chat completion endpoint with messages format
Request timeout set to 600000ms
```

### Sample program results folder structure

For each combination of `model` + `prompt_file` + `data_file`, you will get a dedicated result entry.
At the end of the run you also get

#### Incremental results structure
```
results/
├── incremental
│  ├── deepseek-r1-distill-qwen-7b-v1_advanced-en_2025-05-21T17-38-45-165Z
│  │  ├── result.json
│  │  └── summary.md
│  ├── deepseek-r1-distill-qwen-7b-v1_basic-en_2025-05-21T18-29-53-624Z
│  │  ├── result.json
│  │  └── summary.md
│  ├── gemma-3-12b-it-v1_advanced-en_2025-05-21T12-52-08-182Z
│  │  ├── result.json
│  │  └── summary.md
│  ├── gemma-3-12b-it-v1_advanced-v1_basic-en_2025-05-21T13-31-17-392Z
│  │  ├── result.json
│  │  └── summary.md
......
└── run_2025-05-22T18-19-00-970Z
    ├── report.md
    ├── results.csv
    ├── results.json
```


#### Complete results sample table

```markdown
| Model | Prompt | Document | Overall Score | Accuracy | Completeness | Relevance |
|-------|--------|----------|--------------|----------|--------------|-----------|
| deepseek-r1-distill-qwen-7b | user_v1_advanced | en_sample | 0.07 | 0.00 | 1.00 | 0.53 |
| deepseek-r1-distill-qwen-7b | user_v1_advanced | en_sample_two | 0.07 | 0.00 | 0.92 | 0.55 |
| deepseek-r1-distill-qwen-7b | user_v1_advanced | en_sample_three | 0.71 | 0.58 | 1.00 | 0.66 |
| deepseek-r1-distill-qwen-7b | user_v1_advanced | fr_sample_one | 0.84 | 0.76 | 1.00 | 0.80 |
| deepseek-r1-distill-qwen-7b | user_v1_advanced | fr_sample_two | 0.07 | 0.00 | 1.00 | 0.55 |
| deepseek-r1-distill-qwen-7b | user_v1_advanced | ro_sample_one | 0.07 | 0.00 | 1.00 | 0.58 |
| deepseek-r1-distill-qwen-7b | user_v1_advanced | ro_sample_two | 0.07 | 0.00 | 1.00 | 0.60 |
| deepseek-r1-distill-qwen-7b | user_v1_basic | en_sample | 0.06 | 0.00 | 0.83 | 0.54 |
| deepseek-r1-distill-qwen-7b | user_v1_basic | en_sample_two | 0.07 | 0.00 | 0.92 | 0.55 |
| deepseek-r1-distill-qwen-7b | user_v1_basic | en_sample_three | 0.07 | 0.00 | 1.00 | 0.58 |
| deepseek-r1-distill-qwen-7b | user_v1_basic | fr_sample_one | 0.07 | 0.00 | 1.00 | 0.57 |
| deepseek-r1-distill-qwen-7b | user_v1_basic | fr_sample_two | 0.07 | 0.00 | 1.00 | 0.58 |
| deepseek-r1-distill-qwen-7b | user_v1_basic | ro_sample_one | 0.07 | 0.00 | 1.00 | 0.43 |
| deepseek-r1-distill-qwen-7b | user_v1_basic | ro_sample_two | 0.06 | 0.00 | 0.83 | 0.58 |
| mistral-nemo-instruct-2407 | user_v1_advanced | en_sample | 0.07 | 0.00 | 1.00 | 0.39 |
| mistral-nemo-instruct-2407 | user_v1_advanced | en_sample_two | 0.07 | 0.00 | 1.00 | 0.39 |
| mistral-nemo-instruct-2407 | user_v1_advanced | en_sample_three | 0.07 | 0.00 | 1.00 | 0.41 |
| mistral-nemo-instruct-2407 | user_v1_advanced | fr_sample_one | 0.07 | 0.00 | 1.00 | 0.58 |
| mistral-nemo-instruct-2407 | user_v1_advanced | fr_sample_two | 0.07 | 0.00 | 1.00 | 0.41 |
| mistral-nemo-instruct-2407 | user_v1_advanced | ro_sample_one | 0.07 | 0.00 | 1.00 | 0.58 |
| mistral-nemo-instruct-2407 | user_v1_advanced | ro_sample_two | 0.07 | 0.00 | 1.00 | 0.44 |
| mistral-nemo-instruct-2407 | user_v1_basic | en_sample | 0.65 | 0.49 | 1.00 | 0.59 |
| mistral-nemo-instruct-2407 | user_v1_basic | en_sample_two | 0.07 | 0.00 | 1.00 | 0.44 |
| mistral-nemo-instruct-2407 | user_v1_basic | en_sample_three | 0.07 | 0.00 | 1.00 | 0.58 |
| mistral-nemo-instruct-2407 | user_v1_basic | fr_sample_one | 0.07 | 0.00 | 1.00 | 0.44 |
| mistral-nemo-instruct-2407 | user_v1_basic | fr_sample_two | 0.66 | 0.51 | 1.00 | 0.57 |
| mistral-nemo-instruct-2407 | user_v1_basic | ro_sample_one | 0.07 | 0.00 | 1.00 | 0.46 |
| mistral-nemo-instruct-2407 | user_v1_basic | ro_sample_two | 0.67 | 0.52 | 1.00 | 0.58 |
```



