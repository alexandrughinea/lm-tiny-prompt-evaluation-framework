import fs from 'fs/promises';
import path from 'path';
import {evaluate} from './evaluator.js';
import {CONFIGURATION} from './config.js';
import fetch from 'node-fetch';
import OpenAIAdapter from './adapters/openai.js';
import {ensureDir} from '../utils/file-utils.js';
import {CSV_FORMAT, escapeCSV, getCSVColumns, getCSVColumnsJoined, getCSVDataMap} from '../utils/csv-utils.js';
import {generateCacheKey, getFromCache, saveToCache} from '../utils/cache-utils.js';
import { sendTestResultsToSlack, sendErrorToSlack } from '../utils/slack.js';


/**
 * Load all available prompts from the prompts directory
 * 
 * Key implementation details:
 * - Only loads files with exact .txt extension
 * - Skips backup files and other non-txt files
 * - Categorizes prompts based on their prefix:
 *   - system_*: For system role in chat completions
 *   - user_*: For user role in chat completions
 *   - assistant_*: For assistant role in chat completions
 *   - others: For legacy completions endpoint
 */
async function loadPrompts() {
  try {
    const promptFiles = await fs.readdir(CONFIGURATION.directories.prompts);
    const prompts = Object.create(null);
    const extension = '.txt'

    for (const file of promptFiles) {
      if (path.extname(file) === extension) {
        const input_user_prompt = path.basename(file, extension);
        const promptPath = path.join(CONFIGURATION.directories.prompts, file);
        const promptContent = await fs.readFile(promptPath, 'utf8');

        let promptType = 'legacy';
        if (input_user_prompt.startsWith('system_')) {
          promptType = 'system';
        } else if (input_user_prompt.startsWith('user_')) {
          promptType = 'user';
        } else if (input_user_prompt.startsWith('assistant_')) {
          promptType = 'assistant';
        }

        console.log(`Loaded prompt file: ${file}`);

        prompts[input_user_prompt] = {
          type: promptType,
          content: promptContent,
          name: promptType !== 'legacy' ? input_user_prompt.substring(input_user_prompt.indexOf('_') + 1) : input_user_prompt
        };
      }
    }

    return prompts;
  } catch (error) {
    console.error('Error loading prompts:', error);
    return Object.create(null);
  }
}

/**
 * Load all available data from the data directory
 * 
 * Key implementation details:
 * - Only loads files with exact .txt extension
 * - Skips backup files and other non-txt files
 * - Creates a map of data files keyed by filename without extension
 */
async function loadData() {
  try {
    const dataFiles = await fs.readdir(CONFIGURATION.directories.data);
    const data = Object.create(null);
    const extension = '.txt';

    for (const file of dataFiles) {
      if (path.extname(file) === extension) {
        const inputDataFileBaseName = path.basename(file, extension);
        const inputDataFilePath = path.join(CONFIGURATION.directories.data, file);

        data[inputDataFileBaseName] = await fs.readFile(inputDataFilePath, 'utf8');
        console.log(`Loaded data file: ${file}`);
      } else {
        console.log(`Skipping non-txt file: ${file}`);
      }
    }

    return data;
  } catch (error) {
    console.error('Error loading data:', error);
    return Object.create(null);
  }
}

/**
 * Get available models from the server
 */
async function getAvailableModels() {
  try {
    const adapter = new OpenAIAdapter({
      baseUrl: CONFIGURATION.modelServer.url
    });
    
    const data = await adapter.listModels();
    return data.data?.map(model => model.id) || [];
  } catch (error) {
    console.error('Error getting available models:', error);
    return [];
  }
}

/**
 * Execute a prompt with a model
 * 
 * Key implementation details:
 * - Supports both chat (system/user/assistant roles) and legacy completion modes
 * - Automatically detects prompt type and uses appropriate API endpoint
 * - Combines prompts with the same base name but different roles (system/user/assistant)
 * - Handles JSON schema validation for structured outputs
 * - Sets default content for required roles if not found
 * - Uses OpenAIAdapter to make API requests with configurable timeout
 * 
 * @param {string} model - The model ID to use
 * @param {Object} prompt - The prompt object with type, content, and name
 * @param {string} file - The file text to analyze
 * @param {string} input_user_prompt - The original prompt file name (for reference)
 * @param {Object} allPrompts - All available prompts for finding matching pairs
 * @param {Object} options - Additional options for the request
 * @returns {Object} - The model response
 */
async function executePrompt(model, prompt, file, input_user_prompt, allPrompts, options = {}) {
  try {
    // Check cache first if caching is enabled
    if (CONFIGURATION.performance.caching && CONFIGURATION.performance.caching.enabled) {
      const cacheKey = generateCacheKey(model, prompt, file);
      const cachedResponse = await getFromCache(CONFIGURATION.performance.caching.directory, cacheKey);

      if (cachedResponse) {
        console.log(`Using cached response for model: ${model}, prompt: ${prompt.name}`);
        return cachedResponse;
      }
    }

    const useChatMode = prompt.type === 'system' || prompt.type === 'user';

    const fullPrompt = `${prompt.content}${file}`;
    const enhancedPrompt = fullPrompt;
    const useSchema = process.env.USE_STRUCTURED_OUTPUT_SCHEMA === 'true';
    let schema = null;

    console.log(`Using ${useChatMode ? 'chat' : 'legacy'} mode for prompt: ${prompt.name}`);

    if (useSchema) {
      try {
        const schemaPath = path.join(CONFIGURATION.directories.schemas, 'response_format.schema.json');
        const schemaContent = await fs.readFile(schemaPath, 'utf8');
        schema = JSON.parse(schemaContent);
        console.log('JSON schema loaded successfully');
      } catch (schemaError) {
        console.warn('Could not load JSON schema:', schemaError.message);
        console.log('Proceeding without schema validation');
      }
    } else {
      console.log('JSON schema validation disabled (temporarily)');
    }

    const modelAdapter = new OpenAIAdapter({
      model: model,
      baseUrl: CONFIGURATION.modelServer.url,
      temperature: CONFIGURATION.models.temperature,
      max_tokens: CONFIGURATION.models.max_tokens
    });

    console.log(`Request details: ${JSON.stringify({
      model: model,
      prompt_length: enhancedPrompt.length,
      max_tokens: CONFIGURATION.models.max_tokens,
      temperature: CONFIGURATION.models.temperature,
      top_p: CONFIGURATION.models.top_p
    })}`);

    console.log(`Using OpenAIAdapter to connect to ${CONFIGURATION.modelServer.url}`);

    // Prepare options for the adapter
    const adapterOptions = {
      temperature: options.temperature || CONFIGURATION.models.temperature,
      max_tokens: options.max_tokens || CONFIGURATION.models.max_tokens,
      top_p: options.top_p || CONFIGURATION.models.top_p,
      schema: useSchema ? schema : null
    };

    // Debug the request
    console.log('Request details:', JSON.stringify({
      model: model,
      prompt_length: enhancedPrompt.length,
      max_tokens: adapterOptions.max_tokens,
      temperature: adapterOptions.temperature,
      top_p: adapterOptions.top_p
    }));

    // Handle different prompt types
    if (useChatMode) {
      // Initialize messages array
      const messages = [];
      const contentMap = {
        system: null,
        user: null,
        assistant: null
      };

      // Add the current prompt to the appropriate content type
      switch (prompt.type) {
        case 'system':
          contentMap.system = enhancedPrompt;
          break;
        case 'user':
          contentMap.user = enhancedPrompt;
          break;
        case 'assistant':
          contentMap.assistant = enhancedPrompt;
          break;
      }

      // Look for matching prompts with the same base name but different roles
      const baseName = prompt.name;
      for (const [otherPromptFile, otherPrompt] of Object.entries(allPrompts)) {
        // Skip if it's the same prompt we're already using
        if (otherPromptFile === input_user_prompt) continue;

        // Only process if it's a matching prompt with the same base name
        if (otherPrompt.name === baseName && !contentMap[otherPrompt.type]) {
          // Add content for this role
          contentMap[otherPrompt.type] = `${otherPrompt.content}${file}`;
          console.log(`Found matching ${otherPrompt.type} prompt: ${otherPromptFile}`);
        }
      }

      // Set default content for required roles if not found
      if (!contentMap.system) {
        contentMap.system = 'You are an AI assistant analyzing data. Provide structured analysis based on the document text.';
        console.log('Using default system content');
      }

      if (!contentMap.user) {
        contentMap.user = 'Please analyze this document.';
        console.log('Using default user content');
      }

      // Build messages array in the correct order
      messages.push({ role: 'system', content: contentMap.system });
      messages.push({ role: 'user', content: contentMap.user });

      // Add assistant message if available
      if (contentMap.assistant) {
        messages.push({ role: 'assistant', content: contentMap.assistant });
        console.log(`Using messages with system (${contentMap.system.length} chars), user (${contentMap.user.length} chars), and assistant (${contentMap.assistant.length} chars) roles`);
      } else {
        console.log(`Using messages with system (${contentMap.system.length} chars) and user (${contentMap.user.length} chars) roles`);
      }

      // Use the adapter's chat method
      console.log('Using chat completion endpoint with messages format');
      const data = await modelAdapter.chat(messages, adapterOptions);

      // Cache the response if caching is enabled
      if (CONFIGURATION.performance.caching && CONFIGURATION.performance.caching.enabled) {
        const cacheKey = generateCacheKey(model, prompt, file);
        await saveToCache(CONFIGURATION.performance.caching.directory, cacheKey, data);
      }

      return data;
    } else {
      // For legacy prompts, use the execute method which will internally convert to chat format
      console.log('Using legacy completion endpoint (will be converted to chat format)');
      const data = await modelAdapter.execute(enhancedPrompt, adapterOptions);

      // Cache the response if caching is enabled
      if (CONFIGURATION.performance.caching && CONFIGURATION.performance.caching.enabled) {
        const cacheKey = generateCacheKey(model, prompt, file);
        await saveToCache(CONFIGURATION.performance.caching.directory, cacheKey, data);
      }

      return data;
    }
  } catch (error) {
    // Extract the root error message without stack trace
    const errorMessage = error.cause ? error.cause.code : error.message;
    console.error(`Error executing prompt with model ${model}: ${errorMessage}`);
    throw error;
  }
}

/**
 * Parse JSON from model response
 * 
 * @param {Object} response - The raw model response
 * @returns {Object|string} - Parsed JSON or raw text
 */
async function parseJsonFromResponse(response) {
  try {
    // Extract the text from the response - handle both completions and chat formats
    const text = response.choices?.[0]?.message?.content || response.choices?.[0]?.text || '';

    // Try multiple approaches to extract JSON

    // Approach 1: Try to parse the entire text as JSON
    try {
      return JSON.parse(text);
    } catch (e) {
      // Not valid JSON, continue to next approach
    }

    // Approach 2: Try to find JSON object pattern with regex
    const jsonMatch = text.match(/\{[\s\S]*\}/m);
    if (jsonMatch) {
      try {
        // Clean up the JSON string - remove any markdown code block markers
        let jsonStr = jsonMatch[0];
        jsonStr = jsonStr.replace(/^```json\n|^```\n|\n```$/gm, '');

        return JSON.parse(jsonStr);
      } catch (e) {
        console.warn('Found JSON-like pattern but failed to parse:', e.message);
      }
    }

    // Approach 3: Try to find JSON array pattern
    const arrayMatch = text.match(/\[[\s\S]*\]/m);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch (e) {
        console.warn('Found array-like pattern but failed to parse:', e.message);
      }
    }

    // Approach 4: Try to fix common JSON issues and parse again
    try {
      // Replace single quotes with double quotes
      let fixedText = text.replace(/'/g, '"');
      // Remove trailing commas in objects and arrays
      fixedText = fixedText.replace(/,\s*(\}|\])/g, '$1');
      // Remove comments
      fixedText = fixedText.replace(/\/\/.*$/gm, '');

      // Try to extract JSON again with the fixed text
      const fixedJsonMatch = fixedText.match(/\{[\s\S]*\}/m);
      if (fixedJsonMatch) {
        return JSON.parse(fixedJsonMatch[0]);
      }
    } catch (e) {
      console.warn('Failed to parse after fixing common issues:', e.message);
    }

    // If all parsing attempts fail, return the text as is
    console.warn('All JSON parsing attempts failed, returning raw text');
    return text;
  } catch (error) {
    console.warn('Error in parseJsonFromResponse:', error.message);
    return response.choices?.[0]?.text || '';
  }
}

/**
 * Evaluate a model's response
 * 
 * @param {Object|string} parsedResponse - The parsed model response
 * @param {Object} evaluationOptions - Options for evaluation
 * @returns {Object} - Evaluation results with metrics
 */
async function evaluateResponse(parsedResponse, evaluationOptions = {}) {
  try {
    // Use the generic evaluate function to evaluate the response
    const evaluation = await evaluate(parsedResponse, evaluationOptions);

    // Extract quantitative metrics from the evaluation
    const quantitative = {
      accuracy: evaluation.quantitative?.accuracy || 0,
      completeness: evaluation.quantitative?.completeness || 0,
      relevance: evaluation.quantitative?.relevance || 0,
      overall: evaluation.quantitative?.overall || 0
    };

    // Get qualitative assessment
    const qualitative = evaluation.qualitative || {
      strengths: [],
      weaknesses: [],
      suggestions: []
    };

    return {
      qualitative,
      quantitative
    };
  } catch (error) {
    console.warn('Error evaluating response:', error.message);
    return null;
  }
}

/**
 * Generate a markdown report from the results
 * 
 * @param {Array} results - The test results to generate a report from
 * @returns {string} - Markdown report
 */
function generateReport(results) {
  // Create a markdown report with tables for each model and prompt
  let report = `# Model Evaluation Report\n\n`;
  report += `Generated: ${new Date().toLocaleString()}\n\n`;

  // Summary table
  report += `## Summary\n\n`;
  report += `| Model | Prompt | Document | Overall Score | Accuracy | Completeness | Relevance |\n`;
  report += `|-------|--------|----------|--------------|----------|--------------|-----------|\n`;

  for (const result of results) {
    const { model, input_user_prompt, input_data_file, quantitative } = result;
    report += `| ${model} | ${input_user_prompt} | ${input_data_file} | ${quantitative.overall.toFixed(2)} | ${quantitative.accuracy.toFixed(2)} | ${quantitative.completeness.toFixed(2)} | ${quantitative.relevance.toFixed(2)} |\n`;
  }

  // Model comparison
  report += `\n## Model Comparison\n\n`;

  // Group results by model
  const modelGroups = {};
  for (const result of results) {
    const { model, quantitative } = result;
    if (!modelGroups[model]) {
      modelGroups[model] = [];
    }
    modelGroups[model].push(quantitative);
  }

  // Calculate average metrics for each model
  const modelAverages = Object.entries(modelGroups).reduce((acc, [model, quantitative]) => {
    const count = quantitative.length;
    const sums = quantitative.reduce((sum, item) => {
      sum.overall += item.overall;
      sum.accuracy += item.accuracy;
      sum.completeness += item.completeness;
      sum.relevance += item.relevance;
      return sum;
    }, { overall: 0, accuracy: 0, completeness: 0, relevance: 0 });

    acc[model] = {
      overall: sums.overall / count,
      accuracy: sums.accuracy / count,
      completeness: sums.completeness / count,
      relevance: sums.relevance / count
    };

    return acc;
  }, Object.create(null));

  // Create model comparison table
  report += `| Model | Overall Score | Accuracy | Completeness | Relevance |\n`;
  report += `|-------|--------------|----------|--------------|-----------|\n`;

  for (const [model, metrics] of Object.entries(modelAverages)) {
    report += `| ${model} | ${metrics.overall.toFixed(CSV_FORMAT.FRACTION_DIGITS)} | ${metrics.accuracy.toFixed(CSV_FORMAT.FRACTION_DIGITS)} | ${metrics.completeness.toFixed(CSV_FORMAT.FRACTION_DIGITS)} | ${metrics.relevance.toFixed(CSV_FORMAT.FRACTION_DIGITS)} |\n`;
  }

  // Prompt comparison
  report += `\n## Prompt Comparison\n\n`;

  // Group results by prompt type and name
  const promptGroups = {};
  for (const result of results) {
    // Create a display key that shows all prompt types used
    let displayKey = '';

    if (result.input_system_prompt) {
      displayKey += `System: ${result.input_system_prompt} `;
    }

    if (result.input_user_prompt) {
      displayKey += `User: ${result.input_user_prompt} `;
    }

    if (result.input_assistant_prompt) {
      displayKey += `Assistant: ${result.input_assistant_prompt}`;
    }

    // If no specific prompts found, use the original input_user_prompt
    if (!displayKey) {
      displayKey = `Legacy: ${result.input_user_prompt}`;
    }

    // Initialize group if needed
    if (!promptGroups[displayKey]) {
      promptGroups[displayKey] = [];
    }

    promptGroups[displayKey].push(result.quantitative);
  }

  // Calculate average metrics for each prompt
  const promptAverages = Object.entries(promptGroups).reduce((acc, [input_user_prompt, quantitative]) => {
    const count = quantitative.length;
    const sums = quantitative.reduce((sum, item) => {
      sum.overall += item.overall;
      sum.accuracy += item.accuracy;
      sum.completeness += item.completeness;
      sum.relevance += item.relevance;
      return sum;
    }, { overall: 0, accuracy: 0, completeness: 0, relevance: 0 });

    acc[input_user_prompt] = {
      overall: sums.overall / count,
      accuracy: sums.accuracy / count,
      completeness: sums.completeness / count,
      relevance: sums.relevance / count
    };

    return acc;
  }, Object.create(null));

  // Create prompt comparison table
  report += `| Prompt | Overall Score | Accuracy | Completeness | Relevance |\n`;
  report += `|--------|--------------|----------|--------------|-----------|\n`;

  for (const [input_user_prompt, quantitative] of Object.entries(promptAverages)) {
    report += `| ${input_user_prompt} | ${quantitative.overall.toFixed(2)} | ${quantitative.accuracy.toFixed(2)} | ${quantitative.completeness.toFixed(2)} | ${quantitative.relevance.toFixed(2)} |\n`;
  }

  return report;
}

/**
 * Save an individual test result to disk immediately
 * 
 * @param {Object} result - The individual test result to save
 * @returns {Object} - The paths to the saved files
 */
async function saveIndividualResult(result) {
  try {
    // Create a unique directory for this specific test result
    const resultId = `${result.model}-${result.prompt_name}-${result.input_data_file}`;
    const timestamp = result.timestamp.replace(/[:.]/g, '-');
    const resultDir = path.join(CONFIGURATION.directories.results, 'incremental', `${resultId}_${timestamp}`);
    await ensureDir(resultDir);

    // Save JSON result
    const jsonPath = path.join(resultDir, 'result.json');
    await fs.writeFile(jsonPath, JSON.stringify(result, null, 2));

    // Save a simple markdown summary
    const summaryPath = path.join(resultDir, 'summary.md');
    const summary = `# Test Result: ${resultId}

    ## Model: ${result.model}

    ## Prompt: ${result.prompt_name} (${result.prompt_type})

    ## Data File: ${result.input_data_file}

    ## Metrics
    - Overall: ${result.quantitative.overall.toFixed(2)}
    - Accuracy: ${result.quantitative.accuracy.toFixed(2)}
    - Completeness: ${result.quantitative.completeness.toFixed(2)}
    - Relevance: ${result.quantitative.relevance.toFixed(2)}

    ## Timestamp
    ${result.timestamp}
    `;
    await fs.writeFile(summaryPath, summary);

    // Save CSV result
    const csvPath = path.join(resultDir, 'result.csv');
    const headers = getCSVColumnsJoined();

    // Create CSV content with headers and a single row for this result
    let csvContent = headers + CSV_FORMAT.NEW_LINE;

    // Create a data object that maps header fields to values
    const dataMap = getCSVDataMap(result);

    // Use the same header fields order to build the row
    const row = getCSVColumns().map(field => dataMap[field]);

    csvContent += row.map(cell => escapeCSV(cell)).join(CSV_FORMAT.COMMA);

    await fs.writeFile(csvPath, csvContent);

    console.log(`Individual result saved to ${resultDir}`);
    return { resultDir, jsonPath, summaryPath, csvPath };
  } catch (error) {
    console.warn(`Error saving individual result: ${error.message}`);
    return Object.create(null);
  }
}

/**
 * Save test results to file
 * 
 * @param {Array} results - The test results to save
 * @returns {Object} - The paths to the saved files
 */
async function saveResults(results) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(CONFIGURATION.directories.results, `run_${timestamp}`);
    await ensureDir(runDir);

    // Save JSON results
    const jsonPath = path.join(runDir, 'results.json');
    await fs.writeFile(jsonPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to ${jsonPath}`);

    // Generate and save markdown report
    const reportPath = path.join(runDir, 'report.md');
    const report = generateReport(results);
    await fs.writeFile(reportPath, report);
    console.log(`Report saved to ${reportPath}`);

    // Export CSV files by model without correlation
    await exportCsvByModel(results, timestamp, runDir);

    return {
      jsonPath,
      reportPath,
      runDir
    };
  } catch (error) {
    console.error('Error saving results:', error);
    return Object.create(null);
  }
}

/**
 * Export results to CSV files organized by model
 * 
 * @param {Array} results - The test results to export
 * @param {string} timestamp - The timestamp for the file names
 * @param {string} runDir - Directory for this test run
 */
async function exportCsvByModel(results, timestamp, runDir) {
  try {
    const modelGroups = Object.create(null);

    for (const result of results) {
      const { model } = result;
      if (!modelGroups[model]) {
        modelGroups[model] = [];
      }
      modelGroups[model].push(result);
    }

    for (const [model, results] of Object.entries(modelGroups)) {
      let csvContent = getCSVColumnsJoined() + CSV_FORMAT.NEW_LINE;

      for (const result of results) {
        // Create a data object that maps header fields to values
        const dataMap = getCSVDataMap(result);

        // Use the same header fields order to build the row
        const rowValues = getCSVColumns().map(field => escapeCSV(dataMap[field]));
        csvContent += rowValues.join(CSV_FORMAT.COMMA).concat(CSV_FORMAT.NEW_LINE);
      }

      const normalizedModelId = OpenAIAdapter.getModelIdForFilePath(model);
      const csvFilePath = path.join(runDir, `${normalizedModelId}_results_${timestamp}.csv`);
      await fs.writeFile(csvFilePath, csvContent, 'utf8');
      console.log(`Exported CSV for model ${model} to ${csvFilePath}`);
    }
  } catch (error) {
    console.error('Error exporting to CSV:', error);
  }
}

/**
 * Main function to run the tests
 * 
 * Key implementation details:
 * - Loads available models from the server and filters based on configuration
 * - Loads prompts (system, user, assistant) and data files from directories
 * - Only evaluates user prompts and legacy prompts, skips system and assistant prompts
 * - Executes prompts with models and evaluates responses
 * - Correlates matching system, user, and assistant prompts based on base name
 * - Generates reports and exports results to CSV files
 * - Implements request timeout controlled by REQUEST_TIMEOUT_MS environment variable
 */
async function runTests() {
  try {
    console.log('Starting tests...');

    await ensureDir(CONFIGURATION.directories.results);

    const availableModels = await getAvailableModels();
    const modelsToTest = CONFIGURATION.models.default.filter(model => availableModels.includes(model));

    console.log(`Available models: ${availableModels.join(', ')}`);

    if (modelsToTest.length === 0) {
      console.error('No models available for testing. Please check your configuration.');
      return;
    }

    console.log(`Models to test: ${modelsToTest.join(', ')}`);

    const prompts = await loadPrompts();
    const data = await loadData();

    if (Object.keys(prompts).length === 0) {
      console.error('No prompts found. Please add prompt files to the prompts directory.');
      return;
    }

    if (Object.keys(data).length === 0) {
      console.error('No data found. Please add file files to the data directory.');
      return;
    }

    console.log(`Loaded ${Object.keys(prompts).length} prompts and ${Object.keys(data).length} data.`);

    const results = [];
    const evaluationOptions = {
      expectedFields: [
        { alternateNames: ['main_points', 'mainPoints', 'key_points', 'keyPoints'], description: 'key points' },
        { alternateNames: ['summary', 'overview'], description: 'summary' },
        { alternateNames: ['analysis', 'evaluation'], description: 'analysis' },
        { alternateNames: ['recommendations', 'suggestions'], description: 'recommendations' },
        { alternateNames: ['details', 'specifics'], description: 'details' }
      ],
      relevantTerms: ['analysis', 'file', 'text', 'content', 'information', 'important', 'key', 'critical']
    };

    // Create a function to process a single test case
    async function processTestCase(model, input_user_prompt, promptContent, input_data_file, documentContent, testId = 'N/A') {
      const displayName = promptContent.type !== 'legacy' ?
        `${promptContent.type}_${promptContent.name}` : input_user_prompt;

      // Clear visual separator for test start
      console.log(`\n\n${'='.repeat(50)}`);
      console.log(`🧪 TEST ${testId} - STARTED`);
      console.log(`${'='.repeat(50)}`);
      console.log(`📋 Test Details:`);
      console.log(`  • Model: ${model}`);
      console.log(`  • Prompt: ${displayName} (${promptContent.type} type)`);
      console.log(`  • File: ${input_data_file}`);
      console.log(`${'─'.repeat(50)}`);

      try {
        console.log(`⏳ Executing prompt...`);
        const response = await executePrompt(model, promptContent, documentContent, input_user_prompt, prompts);
        
        console.log(`🔍 Parsing response...`);
        const parsedResponse = await parseJsonFromResponse(response);
        
        console.log(`📝 Evaluating response...`);
        const evaluation = await evaluateResponse(parsedResponse, evaluationOptions);

        if (!evaluation) {
          console.error(`❌ Error: Failed to evaluate response for model ${model}, prompt ${input_user_prompt}, file ${input_data_file}.`);
          return null;
        }

        const {quantitative, qualitative} = evaluation;
        let input_system_prompt = null;
        let input_assistant_prompt = null;

        console.log(`\n${'─'.repeat(50)}`);
        console.log(`✅ TEST ${testId} - COMPLETED in ${response.usage?.completion_ms || 'unknown'} ms`);
        console.log(`📊 Scores:`);
        console.log(`  • Overall: ${quantitative.overall.toFixed(CSV_FORMAT.FRACTION_DIGITS)}`);
        console.log(`  • Accuracy: ${quantitative.accuracy.toFixed(CSV_FORMAT.FRACTION_DIGITS)}`);
        console.log(`  • Completeness: ${quantitative.completeness.toFixed(CSV_FORMAT.FRACTION_DIGITS)}`);
        console.log(`  • Relevance: ${quantitative.relevance.toFixed(CSV_FORMAT.FRACTION_DIGITS)}`);
        console.log(`${'='.repeat(50)}`);

        const baseName = promptContent.name;
        let foundMatchingSystem = false;
        let fallbackSystemPrompt = null;

        for (const [otherPromptFile, otherPrompt] of Object.entries(prompts)) {
          if (otherPrompt.name === baseName) {
            if (otherPrompt.type === 'system') {
              input_system_prompt = otherPromptFile;
              foundMatchingSystem = true;
            } else if (otherPrompt.type === 'assistant') {
              input_assistant_prompt = otherPromptFile;
            }
          }

          // Store any system prompt as potential fallback
          if (otherPrompt.type === 'system' && !fallbackSystemPrompt) {
            fallbackSystemPrompt = otherPromptFile;
          }
        }

        // If no matching system prompt was found, use the fallback
        if (!foundMatchingSystem && fallbackSystemPrompt) {
          input_system_prompt = fallbackSystemPrompt;
          console.log(`No matching system prompt found for ${input_user_prompt}, using fallback: ${fallbackSystemPrompt}`);
        }

        const result = {
          id: `${model}-${input_user_prompt}-${input_data_file}`,
          timestamp: new Date().toISOString(),
          model,
          input_user_prompt: promptContent.type === 'user' ? input_user_prompt : null,
          input_system_prompt,
          input_assistant_prompt,
          prompt_type: promptContent.type,
          prompt_name: promptContent.name,
          input_data_file,
          quantitative,
          qualitative,
          response: parsedResponse,
        };

        // Write individual result to disk immediately
        await saveIndividualResult(result);

        return result;
      } catch (error) {
        // Extract the most useful part of the error message
        let errorMessage = 'Unknown error';
        if (error.cause && error.cause.code) {
          errorMessage = `${error.cause.code}`;
        } else if (error.message) {
          // Limit error message length for readability
          errorMessage = error.message.length > 100 ? 
            `${error.message.substring(0, 100)}...` : error.message;
        }
        
        // Format error output with clear visual indicators
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`❌ TEST ${testId} - FAILED`);
        console.log(`🚨 Error details:`);
        console.log(`  • Model: ${model}`);
        console.log(`  • Prompt: ${input_user_prompt}`);
        console.log(`  • File: ${input_data_file}`);
        console.log(`  • Error: ${errorMessage}`);
        console.log(`${'='.repeat(50)}`);
        return null;
      }
    }

    // Generate all test cases
    const testCases = modelsToTest.reduce((acc, model) => {
      const modelCases = Object.entries(prompts).reduce((promptAcc, [input_user_prompt, promptContent]) => {
        if (promptContent.type === 'system' || promptContent.type === 'assistant') {
          console.log(`Skipping evaluation for ${promptContent.type} prompt: ${input_user_prompt} (will be correlated with user prompts)`);
          return promptAcc;
        }

        const promptCases = Object.entries(data).map(([input_data_file, documentContent]) => ({
          model,
          input_user_prompt,
          promptContent,
          input_data_file,
          documentContent
        }));

        return promptAcc.concat(promptCases);
      }, []);

      return acc.concat(modelCases);
    }, []);

    // No sampling - using all test cases
    console.log(`Running all ${testCases.length} test cases`);


    // Get concurrency limit from environment or use default
    const concurrencyLimit = parseInt(process.env.CONCURRENCY_LIMIT || '3', 10);
    console.log(`Running tests with concurrency limit: ${concurrencyLimit}`);

    // Group test cases by model
    const testCasesByModel = Object.create(null);
    for (const testCase of testCases) {
      if (!testCasesByModel[testCase.model]) {
        testCasesByModel[testCase.model] = [];
      }
      testCasesByModel[testCase.model].push(testCase);
    }

    // Process test cases for a single model in parallel with concurrency limit
    const processModelTestCases = async (modelTestCases, limit) => {
      const results = [];
      const inProgress = new Set();

      for (let i = 0; i < modelTestCases.length; i++) {
        const testCase = modelTestCases[i];
        const testId = `${i + 1}/${modelTestCases.length}`;
        // Wait if we've reached the concurrency limit
        while (inProgress.size >= limit) {
          await Promise.race(inProgress);
        }

        // Process the next test case
        const promise = processTestCase(
          testCase.model,
          testCase.input_user_prompt,
          testCase.promptContent,
          testCase.input_data_file,
          testCase.documentContent,
          testId
        ).then(result => {
          inProgress.delete(promise);
          if (result) results.push(result);
        });

        inProgress.add(promise);
      }

      // Wait for any remaining tasks
      await Promise.all(inProgress);
      return results;
    };

    // Process models sequentially, but prompt-data combinations in parallel
    const allResults = [];
    const modelEntries = Object.entries(testCasesByModel);
    const totalModels = modelEntries.length;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 STARTING TEST EXECUTION - ${testCases.length} total test cases across ${totalModels} models`);
    console.log(`${'='.repeat(60)}`);
    
    for (let i = 0; i < modelEntries.length; i++) {
      const [model, modelTestCases] = modelEntries[i];
      const modelProgress = `(${i + 1}/${totalModels})`;
      
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`📦 Processing model ${modelProgress}: ${model}`);
      console.log(`📋 Test cases: ${modelTestCases.length}`);
      console.log(`⏳ Estimated time: ~${Math.round(modelTestCases.length * 5 / concurrencyLimit)} minutes`);
      console.log(`${'─'.repeat(60)}`);
      
      const startTime = Date.now();
      const modelResults = await processModelTestCases(modelTestCases, concurrencyLimit);
      const elapsedTime = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
      
      console.log(`\n✅ Model ${model} completed in ${elapsedTime} minutes`);
      console.log(`📊 Results: ${modelResults.length}/${modelTestCases.length} tests passed`);
      
      allResults.push(...modelResults);
    }

    results.push(...allResults.filter(result => result !== null));

    if (results.length > 0) {
      const saveInfo = await saveResults(results);
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📊 TEST EXECUTION SUMMARY`);
      console.log(`${'='.repeat(60)}`);
      
      const totalTests = testCases.length;
      const successfulTests = results.length;
      const failedTests = totalTests - successfulTests;
      
      const avgScores = {
        overall: 0,
        accuracy: 0,
        completeness: 0,
        relevance: 0
      };
      
      results.forEach(result => {
        avgScores.overall += result.quantitative.overall;
        avgScores.accuracy += result.quantitative.accuracy;
        avgScores.completeness += result.quantitative.completeness;
        avgScores.relevance += result.quantitative.relevance;
      });
      
      Object.keys(avgScores).forEach(key => {
        avgScores[key] = (avgScores[key] / successfulTests).toFixed(CSV_FORMAT.FRACTION_DIGITS);
      });
      
      console.log(`📊 Test Statistics:`);
      console.log(`  • Total Tests: ${totalTests}`);
      console.log(`  • Successful: ${successfulTests} (${Math.round(successfulTests/totalTests*100)}%)`);
      console.log(`  • Failed: ${failedTests} (${Math.round(failedTests/totalTests*100)}%)`);
      
      console.log(`\n📊 Average Scores:`);
      console.log(`  • Overall: ${avgScores.overall}`);
      console.log(`  • Accuracy: ${avgScores.accuracy}`);
      console.log(`  • Completeness: ${avgScores.completeness}`);
      console.log(`  • Relevance: ${avgScores.relevance}`);
      
      console.log(`\n✅ Tests completed successfully!`);
      console.log(`${'='.repeat(60)}`);
      
      try {
        const runDir = saveInfo.runDir;
        const files = await fs.readdir(runDir);
        let csvContent = '';
        
        const csvFile = files.find(file => file.endsWith('.csv'));
        if (csvFile) {
          const csvPath = path.join(runDir, csvFile);
          try {
            csvContent = await fs.readFile(csvPath, 'utf8');
            console.log(`Found CSV file for Slack webhook: ${csvPath}`);
          } catch (err) {
            console.warn(`Could not read CSV file ${csvPath} for Slack webhook:`, err.message);
          }
        }
        
        const testSummary = {
          totalTests,
          successful: successfulTests,
          failed: failedTests,
          averageScores: {
            overall: parseFloat(avgScores.overall),
            accuracy: parseFloat(avgScores.accuracy),
            completeness: parseFloat(avgScores.completeness),
            relevance: parseFloat(avgScores.relevance)
          }
        };
        
        console.log('Sending test results to Slack...');
        await sendTestResultsToSlack(testSummary, csvContent);
      } catch (slackError) {
        console.error('Error sending test results to Slack:', slackError);
      }
    } else {
      console.error('\n❌ No test results were generated.');
    }
  } catch (error) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`❌ TEST EXECUTION FAILED`);
    console.log(`${'='.repeat(60)}`);
    
    let errorMessage = 'Unknown error';
    if (error.cause && error.cause.code) {
      errorMessage = `${error.cause.code}`;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    console.log(`🚨 Error details:`);
    console.log(`  • Error: ${errorMessage}`);
    
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT')) {
      console.log(`\n🔧 Troubleshooting suggestions:`);
      console.log(`  • Check if the model server is running at ${CONFIGURATION.modelServer.url}`);
      console.log(`  • Verify network connectivity to the model server`);
      console.log(`  • Consider increasing the request timeout in the environment variables`);
    } else if (errorMessage.includes('HeadersTimeoutError')) {
      console.log(`\n🔧 Troubleshooting suggestions:`);
      console.log(`  • The server took too long to respond. Try increasing the REQUEST_TIMEOUT_MS value in .env`);
      console.log(`  • Current timeout: ${process.env.REQUEST_TIMEOUT_MS || 'default'} ms`);
      console.log(`  • Consider reducing concurrency with CONCURRENCY_LIMIT in .env`);
    }
    
    console.log(`${'='.repeat(60)}`);
    
    try {
      const context = {
        status: 'failed',
        task_type: 'test_execution',
        models: CONFIGURATION.models.default.join(','),
        error_type: error.cause?.code || 'runtime_error'
      };
      console.log('Sending error notification to Slack...');
      await sendErrorToSlack(context, error);
    } catch (slackError) {
      console.error('Failed to send error notification to Slack:', slackError);
    }
  }
}

// Run the tests
runTests().catch(console.error);
