import fs from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';
import {evaluate} from './evaluator.js';
import {CONFIGURATION} from './config.js';
import OpenAIAdapter from './adapters/openai.js';
import {ensureDir} from '../utils/file-utils.js';
import {CSV_FORMAT, escapeCSV, getCSVColumns, getCSVColumnsJoined, getCSVDataMap, formatProcessingTime, writeMetricsCsv} from '../utils/csv-utils.js';
import { detectReportMeta, fieldMatchScore, fieldMissCount, formatGold, formatMatch, formatPredicted, humanizeFieldName, macroF1FromResults, markdownTable, perFieldClassification, resolveFieldNames } from '../utils/report-utils.js';
import { selfConsistency } from '../utils/consistency.js';
import { loadFieldNames } from '../evaluators/labels.js';
import {generateCacheKey, getFromCache, saveToCache} from '../utils/cache-utils.js';
import { sendTestResultsToSlack, sendErrorToSlack } from '../utils/slack.js';
import { isImageExtension, loadSidecarImages, loadStandaloneImageCases, toChatImageUrl } from '../utils/media-utils.js';
import { indexTextFiles, isTextExtension } from '../utils/text-files.js';

/** Load `.txt` / `.md` prompts and tag them as system, user, assistant, or legacy. */
async function loadPrompts() {
  try {
    const promptFiles = await fs.readdir(CONFIGURATION.directories.prompts);
    const prompts = Object.create(null);

    for (const [input_user_prompt, file] of indexTextFiles(promptFiles)) {
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

    return prompts;
  } catch (error) {
    console.error('Error loading prompts:', error);
    return Object.create(null);
  }
}

/** Load text cases (with sidecar images) and standalone image-only cases. */
async function loadData() {
  try {
    const dataDir = CONFIGURATION.directories.data;
    const files = await fs.readdir(dataDir);
    const data = Object.create(null);
    const textBasenames = [];
    const claimedText = indexTextFiles(files);

    for (const file of files) {
      if (!isTextExtension(file) && !isImageExtension(file)) {
        console.log(`Skipping non-text file: ${file}`);
      }
    }

    for (const [name, file] of claimedText) {
      const text = await fs.readFile(path.join(dataDir, file), 'utf8');
      const images = await loadSidecarImages(dataDir, name, files);
      data[name] = { text, images, textFile: file };
      textBasenames.push(name);

      const sidecarNote = images.length
        ? ` (${images.length} sidecar image${images.length === 1 ? '' : 's'})`
        : '';
      console.log(`Loaded data file: ${file}${sidecarNote}`);
    }

    for (const imageCase of await loadStandaloneImageCases(dataDir, files, textBasenames)) {
      data[imageCase.name] = { text: imageCase.text, images: imageCase.images };
      console.log(`Loaded image-only data: ${imageCase.name} (${imageCase.images.map(img => img.filename).join(', ')})`);
    }

    return data;
  } catch (error) {
    console.error('Error loading data:', error);
    return Object.create(null);
  }
}

function dataText(dataRecord) {
  return typeof dataRecord === 'string' ? dataRecord : (dataRecord?.text || '');
}

function inputKind(dataRecord) {
  const hasText = dataText(dataRecord).trim().length > 0;
  const hasImages = (dataRecord?.images?.length || 0) > 0;
  if (hasText && hasImages) {
    return 'mixed';
  }
  if (hasImages) {
    return 'image';
  }
  return 'text';
}

const PROMPT_EXCERPT_MAX = 1500;

function excerptText(text, max = PROMPT_EXCERPT_MAX) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) {
    return '';
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max).trimEnd()}\n...`;
}

function pairedPromptContent(allPrompts, promptName, type) {
  for (const prompt of Object.values(allPrompts)) {
    if (prompt.name === promptName && prompt.type === type) {
      return prompt.content || '';
    }
  }
  return '';
}

function buildTask(allPrompts, promptContent) {
  const system = promptContent.type === 'system'
    ? promptContent.content
    : pairedPromptContent(allPrompts, promptContent.name, 'system');
  const user = promptContent.type === 'user' || promptContent.type === 'legacy'
    ? promptContent.content
    : pairedPromptContent(allPrompts, promptContent.name, 'user');
  return {
    experiment: CONFIGURATION.experiment,
    prompt_name: promptContent.name,
    system: excerptText(system),
    user: excerptText(user)
  };
}

function inputFiles(caseName, dataRecord) {
  const files = [];
  if (dataText(dataRecord).trim().length > 0) {
    files.push(dataRecord.textFile || `${caseName}.txt`);
  }
  for (const image of dataRecord?.images || []) {
    files.push(image.filename);
  }
  if (files.length === 0) {
    files.push(caseName);
  }
  return files;
}

function buildInput(caseName, dataRecord) {
  return {
    case: caseName,
    kind: inputKind(dataRecord),
    files: inputFiles(caseName, dataRecord)
  };
}

function fence(text) {
  return `\`\`\`\n${text || ''}\n\`\`\`\n`;
}

function uniqueValues(results, getter) {
  return [...new Set(results.map(getter).filter(Boolean))];
}

function contentCharLength(content) {
  if (typeof content === 'string') {
    return content.length;
  }
  if (Array.isArray(content)) {
    return content.reduce((n, part) => n + (part.text?.length || 0), 0);
  }
  return 0;
}

function buildUserContent(promptAndDocumentText, dataRecord) {
  const images = dataRecord?.images || [];
  if (images.length === 0) {
    return promptAndDocumentText;
  }

  const names = images.map(img => img.filename).join(', ');
  return [
    { type: 'text', text: `${promptAndDocumentText}\n\nAttached images: ${names}` },
    ...images.map(img => ({
      type: 'image_url',
      image_url: { url: toChatImageUrl(img.buffer, img.mime) }
    }))
  ];
}

function buildRoleContent(role, promptText, dataRecord) {
  const text = `${promptText}${dataText(dataRecord)}`;
  if (role === 'user') {
    return buildUserContent(text, dataRecord);
  }
  return text;
}

function isCachingEnabled() {
  return Boolean(CONFIGURATION.performance.caching?.enabled);
}

async function readCachedResponse(model, prompt, dataRecord, extras = {}) {
  if (!isCachingEnabled()) {
    return null;
  }
  return getFromCache(
    CONFIGURATION.performance.caching.directory,
    generateCacheKey(model, prompt, dataRecord, extras)
  );
}

async function writeCachedResponse(model, prompt, dataRecord, response, extras = {}) {
  if (!isCachingEnabled()) {
    return;
  }
  await saveToCache(
    CONFIGURATION.performance.caching.directory,
    generateCacheKey(model, prompt, dataRecord, extras),
    response
  );
}

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

async function executePrompt(model, prompt, dataRecord, input_user_prompt, allPrompts, options = {}) {
  try {
    const sampleTemperature = options.temperature ?? CONFIGURATION.models.temperature;
    const cacheExtras = {
      sampleIndex: options.sampleIndex ?? 0,
      repeats: options.repeats ?? CONFIGURATION.eval.repeats,
      temperature: sampleTemperature
    };
    const cachedResponse = await readCachedResponse(model, prompt, dataRecord, cacheExtras);
    if (cachedResponse) {
      console.log(`Using cached response for model: ${model}, prompt: ${prompt.name}`);
      return cachedResponse;
    }

    const useChatMode = prompt.type === 'system' || prompt.type === 'user';

    const documentText = dataText(dataRecord);
    const imageCount = dataRecord?.images?.length || 0;
    const fullPrompt = `${prompt.content}${documentText}`;
    const useSchema = CONFIGURATION.structuredOutput;
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
      console.log('JSON schema validation disabled');
    }

    const modelAdapter = new OpenAIAdapter({
      model: model,
      baseUrl: CONFIGURATION.modelServer.url,
      temperature: CONFIGURATION.models.temperature,
      max_tokens: CONFIGURATION.models.max_tokens
    });

    console.log(`Using OpenAIAdapter to connect to ${CONFIGURATION.modelServer.url}`);

    const adapterOptions = {
      temperature: sampleTemperature,
      max_tokens: options.max_tokens || CONFIGURATION.models.max_tokens,
      top_p: options.top_p || CONFIGURATION.models.top_p,
      schema: useSchema ? schema : null
    };

    console.log('Request details:', JSON.stringify({
      model: model,
      prompt_length: fullPrompt.length,
      image_count: imageCount,
      max_tokens: adapterOptions.max_tokens,
      temperature: adapterOptions.temperature,
      top_p: adapterOptions.top_p
    }));

    if (useChatMode) {
      const contentMap = {
        system: null,
        user: null,
        assistant: null
      };

      if (Object.hasOwn(contentMap, prompt.type)) {
        contentMap[prompt.type] = buildRoleContent(prompt.type, prompt.content, dataRecord);
      }

      for (const [otherPromptFile, otherPrompt] of Object.entries(allPrompts)) {
        if (otherPromptFile === input_user_prompt) continue;

        if (otherPrompt.name === prompt.name && !contentMap[otherPrompt.type]) {
          contentMap[otherPrompt.type] = buildRoleContent(otherPrompt.type, otherPrompt.content, dataRecord);
          console.log(`Found matching ${otherPrompt.type} prompt: ${otherPromptFile}`);
        }
      }

      if (!contentMap.system) {
        contentMap.system = 'You are an AI assistant analyzing data. Provide structured analysis based on the document text.';
        console.log('Using default system content');
      }

      if (!contentMap.user) {
        contentMap.user = buildUserContent('Please analyze this document.', dataRecord);
        console.log('Using default user content');
      }

      const messages = [
        { role: 'system', content: contentMap.system },
        { role: 'user', content: contentMap.user }
      ];
      if (contentMap.assistant) {
        messages.push({ role: 'assistant', content: contentMap.assistant });
      }

      const roleSummary = messages
        .map(msg => `${msg.role} (${contentCharLength(msg.content)} chars)`)
        .join(', ');
      console.log(`Using messages with ${roleSummary} roles`);
      console.log('Using chat completion endpoint with messages format');

      const data = await modelAdapter.chat(messages, adapterOptions);
      await writeCachedResponse(model, prompt, dataRecord, data, cacheExtras);
      return data;
    }

    console.log('Using legacy completion endpoint (will be converted to chat format)');
    const data = await modelAdapter.execute(buildUserContent(fullPrompt, dataRecord), adapterOptions);
    await writeCachedResponse(model, prompt, dataRecord, data, cacheExtras);
    return data;
  } catch (error) {
    const errorMessage = error.cause ? error.cause.code : error.message;
    console.error(`Error executing prompt with model ${model}: ${errorMessage}`);
    throw error;
  }
}

function asText(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map(part => part?.text || part?.content || '').join('').trim();
  }
  return '';
}

function messageText(response) {
  const message = response.choices?.[0]?.message || {};
  const content = asText(message.content);
  if (content) {
    return content;
  }
  const reasoning = asText(message.reasoning_content || message.reasoning);
  if (reasoning) {
    console.warn('message.content was empty; using reasoning_content');
    return reasoning;
  }
  return asText(response.choices?.[0]?.text);
}

async function parseJsonFromResponse(response) {
  try {
    const text = messageText(response);

    try {
      return JSON.parse(text);
    } catch {
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/m);
    if (jsonMatch) {
      try {
        const jsonStr = jsonMatch[0].replace(/^```json\n|^```\n|\n```$/gm, '');
        return JSON.parse(jsonStr);
      } catch (e) {
        console.warn('Found JSON-like pattern but failed to parse:', e.message);
      }
    }

    const arrayMatch = text.match(/\[[\s\S]*\]/m);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch (e) {
        console.warn('Found array-like pattern but failed to parse:', e.message);
      }
    }

    try {
      let fixedText = text.replace(/'/g, '"');
      fixedText = fixedText.replace(/,\s*(\}|\])/g, '$1');
      fixedText = fixedText.replace(/\/\/.*$/gm, '');
      const fixedJsonMatch = fixedText.match(/\{[\s\S]*\}/m);
      if (fixedJsonMatch) {
        return JSON.parse(fixedJsonMatch[0]);
      }
    } catch (e) {
      console.warn('Failed to parse after fixing common issues:', e.message);
    }

    console.warn('All JSON parsing attempts failed, returning raw text');
    return text;
  } catch (error) {
    console.warn('Error in parseJsonFromResponse:', error.message);
    return response.choices?.[0]?.text || '';
  }
}

async function evaluateResponse(parsedResponse, evaluationOptions = {}) {
  try {
    const evaluation = await evaluate(parsedResponse, evaluationOptions);

    const quantitative = { ...(evaluation.quantitative || {}) };

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

function scoreCell(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value.toFixed(2) : 'N/A';
}

function averageBy(results, getter) {
  const values = results.map(getter).filter(value => typeof value === 'number' && !Number.isNaN(value));
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fieldTableHeaders(meta) {
  const headers = ['Case'];
  if (meta.kind) {
    headers.push('Kind');
  }
  if (meta.bucket) {
    headers.push('Bucket');
  }
  headers.push('Field', 'Predicted', 'Gold', 'Match');
  return headers;
}

function fieldTableRow(result, name, meta) {
  const fields = result.quantitative?.fields || {};
  const row = [result.input?.case || result.input_data_file];
  if (meta.kind) {
    row.push(result.input?.kind || result.input_kind || 'N/A');
  }
  if (meta.bucket) {
    row.push(result.quantitative?.bucket || 'N/A');
  }
  row.push(
    humanizeFieldName(name),
    formatPredicted(fields, name),
    formatGold(fields, name),
    formatMatch(fields, name)
  );
  return row;
}

function meanHamming(results) {
  return averageBy(results, result => result.quantitative?.hamming_accuracy);
}

function meanExactMatch(results) {
  return averageBy(results, result => result.quantitative?.exact_match);
}

function groupBy(results, getter) {
  const groups = Object.create(null);
  for (const result of results) {
    const key = getter(result) || 'N/A';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(result);
  }
  return groups;
}

function scoreHeaders(prefix, meta) {
  const headers = [...prefix];
  if (meta.format_valid) {
    headers.push('Format valid');
  }
    if (meta.fields.length > 0) {
    headers.push('Hamming', 'Exact match');
    if (meta.hasF1) {
      headers.push('Macro-F1');
    }
    headers.push(...meta.fields.map(humanizeFieldName));
  }
  if (meta.derived_confidence) {
    headers.push('Confidence (exact)', 'Confidence (Hamming)', 'Brier (exact)', 'Calibration MSE');
  }
  return headers;
}

function scoreCells(groupResults, meta) {
  const cells = [];
  if (meta.format_valid) {
    cells.push(scoreCell(averageBy(groupResults, result => result.quantitative.format_valid)));
  }
  if (meta.fields.length > 0) {
    cells.push(scoreCell(meanHamming(groupResults)));
    cells.push(scoreCell(meanExactMatch(groupResults)));
    if (meta.hasF1) {
      cells.push(scoreCell(macroF1FromResults(groupResults, meta.fields)));
    }
    for (const name of meta.fields) {
      cells.push(scoreCell(averageBy(groupResults, result => fieldMatchScore(result.quantitative.fields, name))));
    }
  }
  if (meta.derived_confidence) {
    cells.push(scoreCell(averageBy(groupResults, result => result.quantitative?.confidence_exact)));
    cells.push(scoreCell(averageBy(groupResults, result => result.quantitative?.confidence_hamming)));
    cells.push(scoreCell(averageBy(groupResults, result => result.quantitative?.brier_exact)));
    cells.push(scoreCell(averageBy(groupResults, result => result.quantitative?.calibration_mse)));
  }
  return cells;
}

function generateReport(results, options = {}) {
  const meta = detectReportMeta(results);
  const sample = results[0] || {};
  const task = sample.task || {};
  const models = uniqueValues(results, result => result.model);
  const promptNames = uniqueValues(results, result => result.task?.prompt_name || result.prompt_name);
  const kinds = uniqueValues(results, result => result.input?.kind || result.input_kind);

  const missRows = [];
  const allRows = [];
  let missCases = 0;
  for (const result of results) {
    let caseMiss = false;
    for (const name of meta.fields) {
      const row = fieldTableRow(result, name, meta);
      allRows.push(row);
      if (fieldMatchScore(result.quantitative?.fields, name) === 0) {
        missRows.push(row);
        caseMiss = true;
      }
    }
    if (caseMiss) {
      missCases += 1;
    }
  }

  let report = `# ${task.experiment || CONFIGURATION.experiment} — evaluation report\n\n`;
  report += `Generated: ${new Date().toLocaleString()}\n\n`;

  report += `## Task\n\n`;
  report += `- Experiment: ${task.experiment || CONFIGURATION.experiment}\n`;
  report += `- Models: ${models.join(', ') || 'N/A'}\n`;
  report += `- Prompt: ${promptNames.join(', ') || 'N/A'}\n\n`;
  const tasksByPrompt = groupBy(results, result => result.task?.prompt_name || result.prompt_name);
  for (const [name, promptResults] of Object.entries(tasksByPrompt)) {
    const promptTask = promptResults[0]?.task || {};
    if (Object.keys(tasksByPrompt).length > 1) {
      report += `### ${name}\n\n`;
    }
    if (promptTask.system) {
      report += `**System**\n\n${fence(promptTask.system)}\n`;
    }
    if (promptTask.user) {
      report += `**User**\n\n${fence(promptTask.user)}\n`;
    }
  }

  report += `## Data\n\n`;
  const attempted = options.attempted;
  const caseCount = typeof attempted === 'number' && !Number.isNaN(attempted)
    ? `${results.length} / ${attempted}`
    : String(results.length);
  report += `- Cases: ${caseCount}\n`;
  report += `- Kinds: ${kinds.join(', ') || 'N/A'}\n`;
  if (meta.bucket) {
    report += `- Buckets: ${uniqueValues(results, result => result.quantitative?.bucket).join(', ')}\n`;
  }
  report += `\n`;

  report += `## Headline\n\n`;
  report += `- Hamming accuracy: ${scoreCell(meanHamming(results))}\n`;
  report += `- Exact match: ${scoreCell(meanExactMatch(results))}\n`;
  if (meta.hasF1) {
    report += `- Macro-F1: ${scoreCell(macroF1FromResults(results, meta.fields))}\n`;
  }
  report += `- Brier (exact): ${scoreCell(averageBy(results, result => result.quantitative?.brier_exact))}\n`;
  report += `- Calibration MSE: ${scoreCell(averageBy(results, result => result.quantitative?.calibration_mse))}\n`;
  report += `- Confidence (exact): ${scoreCell(averageBy(results, result => result.quantitative?.confidence_exact))}\n`;
  report += `- Confidence (Hamming): ${scoreCell(averageBy(results, result => result.quantitative?.confidence_hamming))}\n`;
  if (meta.format_valid) {
    report += `- Format valid: ${scoreCell(averageBy(results, result => result.quantitative.format_valid))}\n`;
  }
  report += `- Cases with at least one miss: ${missCases} / ${results.length}\n`;
  report += `- Field-level misses: ${missRows.length}\n\n`;

  report += `## Misses\n\n`;
  if (meta.fields.length === 0) {
    report += `No scored fields on this run.\n\n`;
  } else if (missRows.length === 0) {
    report += `No field mismatches.\n\n`;
  } else {
    report += markdownTable(fieldTableHeaders(meta), missRows);
    report += `\n`;
  }

  if (meta.fields.length > 0) {
    report += `## Fields\n\n`;
    report += markdownTable(fieldTableHeaders(meta), allRows);
    report += `\n`;
  }

  const resultsByModel = groupBy(results, result => result.model);
  report += `## By model\n\n`;
  report += markdownTable(
    scoreHeaders(['Model'], meta),
    Object.entries(resultsByModel).map(([model, modelResults]) => [model, ...scoreCells(modelResults, meta)])
  );

  if (meta.fields.length > 0) {
    report += `\n## By field\n\n`;
    const fieldRows = perFieldClassification(results, meta.fields);
    report += markdownTable(
      ['Field', 'Precision', 'Recall', 'F1', 'Accuracy'],
      fieldRows.map(row => [
        humanizeFieldName(row.name),
        scoreCell(row.precision),
        scoreCell(row.recall),
        scoreCell(row.f1),
        scoreCell(row.accuracy)
      ])
    );
  }

  if (meta.bucket) {
    const resultsByBucket = groupBy(results, result => result.quantitative.bucket || 'unlabeled');
    report += `\n## By bucket\n\n`;
    report += markdownTable(
      scoreHeaders(['Bucket', 'Count'], meta),
      Object.entries(resultsByBucket).map(([bucket, bucketResults]) => [
        bucket,
        String(bucketResults.length),
        ...scoreCells(bucketResults, meta)
      ])
    );
  }

  const resultsByPrompt = groupBy(results, result => result.task?.prompt_name || result.prompt_name);
  report += `\n## By prompt\n\n`;
  report += markdownTable(
    scoreHeaders(['Prompt'], meta),
    Object.entries(resultsByPrompt).map(([prompt, promptResults]) => [prompt, ...scoreCells(promptResults, meta)])
  );

  report += `\n## Files\n\n`;
  report += `- \`report.md\` — this file\n`;
  report += `- \`results.csv\` — all cases, one row each (\`gold_*\` / \`pred_*\` / \`correct_*\`)\n`;
  report += `- \`metrics.csv\` — one row per model plus \`all\` (Hamming, exact match, macro-F1, per-field P/R/F1/accuracy, consistency confidence, Brier exact, calibration MSE)\n`;
  report += `- \`results.json\` — full records including model JSON\n`;
  return report;
}

function writeCsv(results, fieldNames) {
  let csvContent = getCSVColumnsJoined(fieldNames) + CSV_FORMAT.NEW_LINE;
  for (const result of results) {
    const dataMap = getCSVDataMap(result, fieldNames);
    const rowValues = getCSVColumns(fieldNames).map(field => escapeCSV(dataMap[field]));
    csvContent += rowValues.join(CSV_FORMAT.COMMA).concat(CSV_FORMAT.NEW_LINE);
  }
  return csvContent;
}

async function saveIndividualResult(result) {
  try {
    const resultId = `${result.model}-${result.prompt_name}-${result.input_data_file}`;
    const timestamp = result.timestamp.replace(/[:.]/g, '-');
    const resultDir = path.join(CONFIGURATION.directories.results, 'incremental', `${resultId}_${timestamp}`);
    await ensureDir(resultDir);

    const jsonPath = path.join(resultDir, 'result.json');
    await fs.writeFile(jsonPath, JSON.stringify(result, null, 2));

    const q = result.quantitative || {};
    const fieldNames = resolveFieldNames(result);
    const fieldTable = fieldNames.length > 0
      ? markdownTable(
        ['Field', 'Predicted', 'Gold', 'Match'],
        fieldNames.map(name => [
          humanizeFieldName(name),
          formatPredicted(q.fields, name),
          formatGold(q.fields, name),
          formatMatch(q.fields, name)
        ])
      )
      : 'No scored fields.\n';

    const notes = [
      ...(q.errors || []).map(item => `- ${item}`),
      ...(result.qualitative?.weaknesses || []).map(item => `- ${item}`),
      ...(result.qualitative?.suggestions || []).map(item => `- ${item}`)
    ].join('\n');

    const summary = `# ${result.input?.case || result.input_data_file}

## Task

- Experiment: ${result.task?.experiment || CONFIGURATION.experiment}
- Model: ${result.model}
- Prompt: ${result.task?.prompt_name || result.prompt_name}

${result.task?.system ? `**System**\n\n${fence(result.task.system)}\n` : ''}${result.task?.user ? `**User**\n\n${fence(result.task.user)}\n` : ''}## Input

- Case: ${result.input?.case || result.input_data_file}
- Kind: ${result.input?.kind || result.input_kind || 'N/A'}
- Files: ${(result.input?.files || []).join(', ') || 'N/A'}

## Fields

${fieldTable}
## Model response

${fence(JSON.stringify(result.response, null, 2))}
## Scores

- Miss count: ${fieldMissCount(q.fields)}
- Format valid: ${q.format_valid !== undefined ? (q.format_valid === 1 ? 'yes' : 'no') : 'N/A'}
- Hamming accuracy: ${typeof q.hamming_accuracy === 'number' ? q.hamming_accuracy.toFixed(2) : 'N/A'}
- Exact match: ${typeof q.exact_match === 'number' ? q.exact_match.toFixed(2) : 'N/A'}
- Confidence (exact): ${typeof q.confidence_exact === 'number' ? q.confidence_exact.toFixed(2) : 'N/A'}
- Confidence (Hamming): ${typeof q.confidence_hamming === 'number' ? q.confidence_hamming.toFixed(2) : 'N/A'}
- Brier (exact): ${typeof q.brier_exact === 'number' ? q.brier_exact.toFixed(2) : 'N/A'}
- Calibration MSE: ${typeof q.calibration_mse === 'number' ? q.calibration_mse.toFixed(2) : 'N/A'}
${q.bucket ? `- Bucket: ${q.bucket}\n` : ''}
${notes ? `## Notes\n\n${notes}\n` : ''}
## Timestamp

${result.timestamp}
`;
    const summaryPath = path.join(resultDir, 'summary.md');
    await fs.writeFile(summaryPath, summary);

    const csvPath = path.join(resultDir, 'result.csv');
    await fs.writeFile(csvPath, writeCsv([result], fieldNames));

    console.log(`Individual result saved to ${resultDir}`);
    return { resultDir, jsonPath, summaryPath, csvPath };
  } catch (error) {
    console.warn(`Error saving individual result: ${error.message}`);
    return Object.create(null);
  }
}

async function saveResults(results, options = {}) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(CONFIGURATION.directories.results, `run_${timestamp}`);
    await ensureDir(runDir);

    const fieldNames = resolveFieldNames(results);

    const jsonPath = path.join(runDir, 'results.json');
    await fs.writeFile(jsonPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to ${jsonPath}`);

    const reportPath = path.join(runDir, 'report.md');
    await fs.writeFile(reportPath, generateReport(results, options));
    console.log(`Report saved to ${reportPath}`);

    const collectiveCsvPath = path.join(runDir, 'results.csv');
    await fs.writeFile(collectiveCsvPath, writeCsv(results, fieldNames), 'utf8');
    console.log(`Collective CSV saved to ${collectiveCsvPath}`);

    const metricsCsvPath = path.join(runDir, 'metrics.csv');
    await fs.writeFile(metricsCsvPath, writeMetricsCsv(results, fieldNames), 'utf8');
    console.log(`Metrics CSV saved to ${metricsCsvPath}`);

    await exportCsvByModel(results, runDir);

    return {
      jsonPath,
      reportPath,
      csvPath: collectiveCsvPath,
      metricsCsvPath,
      runDir
    };
  } catch (error) {
    console.error('Error saving results:', error);
    return Object.create(null);
  }
}

async function exportCsvByModel(results, runDir) {
  try {
    const fieldNames = resolveFieldNames(results);
    const modelGroups = groupBy(results, result => result.model);

    for (const [model, modelResults] of Object.entries(modelGroups)) {
      const normalizedModelId = OpenAIAdapter.getModelIdForFilePath(model);
      const csvFilePath = path.join(runDir, `${normalizedModelId}_results.csv`);
      await fs.writeFile(csvFilePath, writeCsv(modelResults, fieldNames), 'utf8');
      console.log(`Exported CSV for model ${model} to ${csvFilePath}`);
    }
  } catch (error) {
    console.error('Error exporting to CSV:', error);
  }
}

async function runTests() {
  try {
    console.log(`Experiment: ${CONFIGURATION.experiment} (${CONFIGURATION.directories.root})`);
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
    const evaluationOptions = {};

    async function processTestCase(model, input_user_prompt, promptContent, input_data_file, documentContent, testId = 'N/A') {
      const displayName = promptContent.type !== 'legacy' ?
        `${promptContent.type}_${promptContent.name}` : input_user_prompt;

      console.log(`\n\n${'='.repeat(50)}`);
      console.log(`TEST ${testId} - STARTED`);
      console.log(`${'='.repeat(50)}`);
      console.log(`Test details:`);
      console.log(`  - Model: ${model}`);
      console.log(`  - Prompt: ${displayName} (${promptContent.type} type)`);
      console.log(`  - File: ${input_data_file}`);
      if (documentContent?.images?.length) {
        console.log(`  - Images: ${documentContent.images.map(img => img.filename).join(', ')}`);
      }
      console.log(`${'─'.repeat(50)}`);

      const testStartTime = Date.now();

      try {
        const repeats = CONFIGURATION.eval.repeats;
        const sampleTemperature = CONFIGURATION.models.temperature;
        const samples = [];
        for (let sampleIndex = 0; sampleIndex < repeats; sampleIndex += 1) {
          console.log(`\n  SAMPLE ${sampleIndex + 1}/${repeats}  T=${sampleTemperature}`);
          console.log(`  ${'-'.repeat(40)}`);
          const response = await executePrompt(model, promptContent, documentContent, input_user_prompt, prompts, {
            sampleIndex,
            repeats,
            temperature: sampleTemperature
          });
          const parsed = await parseJsonFromResponse(response);
          samples.push(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null);
        }

        const voted = selfConsistency(samples, loadFieldNames());
        const parsedResponse = voted.prediction;

        console.log(`Evaluating majority vote (${repeats} samples)...`);
        const evaluation = await evaluateResponse(parsedResponse, {
          ...evaluationOptions,
          input_data_file,
          confidence_exact: voted.confidence_exact,
          confidence_hamming: voted.confidence_hamming
        });

        if (!evaluation) {
          console.error(`Error: Failed to evaluate response for model ${model}, prompt ${input_user_prompt}, file ${input_data_file}.`);
          return null;
        }

        const {quantitative, qualitative} = evaluation;
        let input_system_prompt = null;
        let input_assistant_prompt = null;

        const testEndTime = Date.now();
        const processingTimeMs = testEndTime - testStartTime;
        const formattedProcessingTime = formatProcessingTime(processingTimeMs);

        console.log(`\n${'─'.repeat(50)}`);
        console.log(`TEST ${testId} - COMPLETED in ${formattedProcessingTime}`);
        console.log(`Scores:`);
        console.log(`  - Hamming accuracy: ${scoreCell(quantitative.hamming_accuracy)}`);
        console.log(`  - Exact match: ${scoreCell(quantitative.exact_match)}`);
        if (quantitative.confidence_exact !== undefined && quantitative.confidence_exact !== null) {
          console.log(`  - Confidence (exact): ${scoreCell(quantitative.confidence_exact)}`);
        }
        if (quantitative.confidence_hamming !== undefined && quantitative.confidence_hamming !== null) {
          console.log(`  - Confidence (Hamming): ${scoreCell(quantitative.confidence_hamming)}`);
        }
        if (quantitative.brier_exact !== undefined && quantitative.brier_exact !== null) {
          console.log(`  - Brier (exact): ${scoreCell(quantitative.brier_exact)}`);
        }
        if (quantitative.calibration_mse !== undefined && quantitative.calibration_mse !== null) {
          console.log(`  - Calibration MSE: ${scoreCell(quantitative.calibration_mse)}`);
        }
        if (quantitative.format_valid !== undefined) {
          console.log(`  - Format valid: ${scoreCell(quantitative.format_valid)}`);
          if (quantitative.bucket) {
            console.log(`  - Bucket: ${quantitative.bucket}`);
          }
        }
        if (quantitative.fields) {
          console.log(`Fields:`);
          for (const name of Object.keys(quantitative.fields)) {
            console.log(`  - ${humanizeFieldName(name)}: predicted=${formatPredicted(quantitative.fields, name)} gold=${formatGold(quantitative.fields, name)} match=${formatMatch(quantitative.fields, name)}`);
          }
        }
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

          if (otherPrompt.type === 'system' && !fallbackSystemPrompt) {
            fallbackSystemPrompt = otherPromptFile;
          }
        }

        if (!foundMatchingSystem && fallbackSystemPrompt) {
          input_system_prompt = fallbackSystemPrompt;
          console.log(`No matching system prompt found for ${input_user_prompt}, using fallback: ${fallbackSystemPrompt}`);
        }

        const result = {
          id: `${model}-${input_user_prompt}-${input_data_file}`,
          timestamp: new Date().toISOString(),
          model,
          task: buildTask(prompts, promptContent),
          input: buildInput(input_data_file, documentContent),
          input_user_prompt: promptContent.type === 'user' ? input_user_prompt : null,
          input_system_prompt,
          input_assistant_prompt,
          prompt_type: promptContent.type,
          prompt_name: promptContent.name,
          input_data_file,
          input_kind: inputKind(documentContent),
          quantitative,
          qualitative,
          response: parsedResponse,
          processing_time: processingTimeMs
        };

        await saveIndividualResult(result);

        return result;
      } catch (error) {
        let errorMessage = 'Unknown error';
        if (error.cause && error.cause.code) {
          errorMessage = `${error.cause.code}`;
        } else if (error.message) {
          errorMessage = error.message.length > 100 ?
            `${error.message.substring(0, 100)}...` : error.message;
        }

        console.log(`\n${'─'.repeat(50)}`);
        console.log(`TEST ${testId} - FAILED`);
        console.log(`Error details:`);
        console.log(`  - Model: ${model}`);
        console.log(`  - Prompt: ${input_user_prompt}`);
        console.log(`  - File: ${input_data_file}`);
        console.log(`  - Error: ${errorMessage}`);
        console.log(`${'='.repeat(50)}`);
        return null;
      }
    }

    const testCases = modelsToTest.reduce((acc, model) => {
      const modelCases = Object.entries(prompts).reduce((promptAcc, [input_user_prompt, promptContent]) => {
        if (promptContent.type === 'system' || promptContent.type === 'assistant') {
          console.log(`Skipping ${promptContent.type} prompt: ${input_user_prompt} (paired with user prompts)`);
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

    console.log(`Running all ${testCases.length} test cases`);

    const concurrencyLimit = parseInt(process.env.CONCURRENCY_LIMIT || '3', 10);
    console.log(`Running tests with concurrency limit: ${concurrencyLimit}`);

    const testCasesByModel = Object.create(null);
    for (const testCase of testCases) {
      if (!testCasesByModel[testCase.model]) {
        testCasesByModel[testCase.model] = [];
      }
      testCasesByModel[testCase.model].push(testCase);
    }

    const processModelTestCases = async (modelTestCases, limit, globalTestCounter) => {
      const results = [];
      const inProgress = new Set();

      for (let i = 0; i < modelTestCases.length; i++) {
        const testCase = modelTestCases[i];
        const testId = `${globalTestCounter.current}/${testCases.length}`;
        globalTestCounter.current++;
        while (inProgress.size >= limit) {
          await Promise.race(inProgress);
        }

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

      await Promise.all(inProgress);
      return results;
    };

    const allResults = [];
    const modelEntries = Object.entries(testCasesByModel);
    const totalModels = modelEntries.length;
    const globalTestCounter = { current: 1 };

    console.log(`\n${'='.repeat(60)}`);
    console.log(`STARTING TEST EXECUTION - ${testCases.length} total test cases across ${totalModels} models`);
    console.log(`${'='.repeat(60)}`);
    
    for (let i = 0; i < modelEntries.length; i++) {
      const [model, modelTestCases] = modelEntries[i];
      const modelProgress = `(${i + 1}/${totalModels})`;
      
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Processing model ${modelProgress}: ${model}`);
      console.log(`Test cases: ${modelTestCases.length}`);
      console.log(`Estimated time: ~${Math.round(modelTestCases.length * 5 / concurrencyLimit)} minutes`);
      console.log(`${'─'.repeat(60)}`);
      
      const startTime = Date.now();
      const modelResults = await processModelTestCases(modelTestCases, concurrencyLimit, globalTestCounter);
      const elapsedTime = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
      
      console.log(`\nModel ${model} completed in ${elapsedTime} minutes`);
      console.log(`Results: ${modelResults.length}/${modelTestCases.length} tests passed`);
      
      allResults.push(...modelResults);
    }

    results.push(...allResults.filter(result => result !== null));

    const totalTests = testCases.length;
    const successfulTests = results.length;
    const failedTests = totalTests - successfulTests;

    if (results.length > 0) {
      const saveInfo = await saveResults(results, { attempted: totalTests });
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`TEST EXECUTION SUMMARY`);
      console.log(`${'='.repeat(60)}`);
      
      const fieldNames = resolveFieldNames(results);
      const hamming = meanHamming(results);
      const exact = meanExactMatch(results);
      const macroF1 = macroF1FromResults(results, fieldNames);
      const formatValid = averageBy(results, result => result.quantitative.format_valid);

      console.log(`Test statistics:`);
      console.log(`  - Total Tests: ${totalTests}`);
      console.log(`  - Successful: ${successfulTests} (${Math.round(successfulTests/totalTests*100)}%)`);
      console.log(`  - Failed: ${failedTests} (${Math.round(failedTests/totalTests*100)}%)`);

      console.log(`\nAverage scores (${successfulTests} scored / ${totalTests} attempted):`);
      console.log(`  - Hamming accuracy: ${scoreCell(hamming)}`);
      console.log(`  - Exact match: ${scoreCell(exact)}`);
      if (macroF1 !== null) {
        console.log(`  - Macro-F1: ${scoreCell(macroF1)}`);
      }
      console.log(`  - Brier (exact): ${scoreCell(averageBy(results, result => result.quantitative?.brier_exact))}`);
      console.log(`  - Calibration MSE: ${scoreCell(averageBy(results, result => result.quantitative?.calibration_mse))}`);
      console.log(`  - Confidence (exact): ${scoreCell(averageBy(results, result => result.quantitative?.confidence_exact))}`);
      console.log(`  - Confidence (Hamming): ${scoreCell(averageBy(results, result => result.quantitative?.confidence_hamming))}`);
      if (detectReportMeta(results).format_valid) {
        console.log(`  - Format valid: ${scoreCell(formatValid)}`);
      }
      
      console.log(`\nTests completed successfully!`);
      console.log(`${'='.repeat(60)}`);
      
      try {
        const runDir = saveInfo.runDir;
        let csvContent = '';
        const metricsPath = saveInfo.metricsCsvPath || path.join(runDir, 'metrics.csv');
        try {
          csvContent = await fs.readFile(metricsPath, 'utf8');
          console.log(`Found metrics CSV for Slack webhook: ${metricsPath}`);
        } catch (err) {
          console.warn(`Could not read metrics CSV ${metricsPath} for Slack webhook:`, err.message);
        }
        
        const testSummary = {
          totalTests,
          successful: successfulTests,
          failed: failedTests,
          averageScores: {
            hamming_accuracy: hamming,
            exact_match: exact,
            macro_f1: macroF1,
            format_valid: formatValid,
            brier_exact: averageBy(results, result => result.quantitative?.brier_exact),
            calibration_mse: averageBy(results, result => result.quantitative?.calibration_mse),
            confidence_exact: averageBy(results, result => result.quantitative?.confidence_exact),
            confidence_hamming: averageBy(results, result => result.quantitative?.confidence_hamming)
          }
        };
        
        console.log('Sending test results to Slack...');
        await sendTestResultsToSlack(testSummary, csvContent);
      } catch (slackError) {
        console.error('Error sending test results to Slack:', slackError);
      }
    } else {
      console.error('\nNo test results were generated.');
    }
  } catch (error) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST EXECUTION FAILED`);
    console.log(`${'='.repeat(60)}`);
    
    let errorMessage = 'Unknown error';
    if (error.cause && error.cause.code) {
      errorMessage = `${error.cause.code}`;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    console.log(`Error details:`);
    console.log(`  - Error: ${errorMessage}`);
    
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT')) {
      console.log(`\nTroubleshooting:`);
      console.log(`  - Check if the model server is running at ${CONFIGURATION.modelServer.url}`);
      console.log(`  - Verify network connectivity to the model server`);
      console.log(`  - Consider increasing the request timeout in the environment variables`);
    } else if (errorMessage.includes('HeadersTimeoutError')) {
      console.log(`\nTroubleshooting:`);
      console.log(`  - The server took too long to respond. Try increasing the REQUEST_TIMEOUT_MS value in .env`);
      console.log(`  - Current timeout: ${process.env.REQUEST_TIMEOUT_MS || 'default'} ms`);
      console.log(`  - Consider reducing concurrency with CONCURRENCY_LIMIT in .env`);
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

export { generateReport, writeCsv };

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  runTests().catch(console.error);
}
