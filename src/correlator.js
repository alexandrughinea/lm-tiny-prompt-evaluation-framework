import fs from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';
import {CONFIGURATION} from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_DIR = path.join(__dirname, '..', CONFIGURATION.directories.results);

/**
 * Create a correlation ID for a test run
 * 
 * @param {string} modelId - The model ID
 * @param {string} input_data_file - The file sample ID
 * @param {string} input_user_prompt - The prompt ID
 * @returns {string} - A unique correlation ID
 */
export function createCorrelationId(modelId, input_data_file, input_user_prompt) {
  const timestamp = new Date().toISOString();
  return `${modelId}__${input_data_file}__${input_user_prompt}__${timestamp}`;
}

/**
 * Record a correlation between model, file, prompt, and result
 * 
 * @param {object} correlation - The correlation object
 * @param {string} correlation.modelId - The model ID
 * @param {string} correlation.input_data_file - The file sample ID
 * @param {string} correlation.input_user_prompt - The prompt ID
 * @param {string} correlation.resultPath - Path to the result file
 * @param {object} correlation.metrics - Evaluation metrics
 * @returns {Promise<string>} - The correlation ID
 */
export async function recordCorrelation(correlation) {
  const {
    modelId,
    input_data_file,
    input_user_prompt,
    resultPath,
    quantitative,
    qualitative,
    timestamp
  } = correlation;
  
  // Create correlation ID
  const correlationId = createCorrelationId(modelId, input_data_file, input_user_prompt);
  
  // Create correlation entry
  const entry = {
    id: correlationId,
    modelId,
    input_data_file,
    input_user_prompt,
    resultPath,
    quantitative,
    qualitative,
    timestamp
  };
  
  try {
    // Ensure the result path exists
    if (resultPath) {
      await fs.mkdir(resultPath, { recursive: true });

      // Create correlation directory path
      const correlationDir = path.join(resultPath, `correlation_${modelId.split('/')[0]}`);

      // Ensure the correlation directory exists
      await fs.mkdir(correlationDir, {recursive: true});

      // Save the correlation data to a JSON file
      const correlationFilePath = path.join(correlationDir, `${correlationId.replace(/[:.]/g, '-')}.json`);
      await fs.writeFile(correlationFilePath, JSON.stringify(entry, null, 2), 'utf8');
      console.log(`Correlation data saved to ${correlationFilePath}`);
      
      // Also append to a master correlations file for easier lookup
      const masterCorrelationsPath = path.join(RESULTS_DIR, 'correlations.json');
      
      // Check if master file exists, create it if not
      let masterCorrelations = [];
      try {
        const existingData = await fs.readFile(masterCorrelationsPath, 'utf8');
        masterCorrelations = JSON.parse(existingData);
      } catch (err) {
        // File doesn't exist yet, will create it
      }
      
      // Add the new correlation and save
      masterCorrelations.push(entry);
      await fs.writeFile(masterCorrelationsPath, JSON.stringify(masterCorrelations, null, 2), 'utf8');
    } else {
      console.warn('Warning: resultPath is undefined in recordCorrelation');
    }
    
    return correlationId;
  } catch (error) {
    console.error('Error recording correlation:', error);
    return correlationId;
  }
}

/**
 * Get all correlations from all run directories
 * 
 * @returns {Promise<Array>} - Array of correlation entries
 */
export async function getAllCorrelations() {
  try {
    const runDirs = await fs.readdir(RESULTS_DIR);
    const filteredDirs = runDirs.filter(dir => dir.startsWith('run_'));
    let allCorrelations = [];
    
    for (const runDir of filteredDirs) {
      const runPath = path.join(RESULTS_DIR, runDir);
      const dirStat = await fs.stat(runPath);
      
      if (!dirStat.isDirectory()) continue;
      
      const files = await fs.readdir(runPath);
      const correlationFiles = files.filter(file => file.includes('correlation_index_'));
      
      for (const correlationFile of correlationFiles) {
        try {
          const filePath = path.join(runPath, correlationFile);
          const content = await fs.readFile(filePath, 'utf8');
          const correlations = JSON.parse(content);
          
          allCorrelations = allCorrelations.concat(correlations);
        } catch (error) {
          console.error(`Error reading correlation file ${correlationFile}:`, error);
        }
      }
    }
    
    return allCorrelations;
  } catch (error) {
    console.error('Error getting all correlations:', error);
    return [];
  }
}

/**
 * Find correlations by criteria
 * 
 * @param {object} criteria - Search criteria
 * @param {string} [criteria.modelId] - Filter by model ID
 * @param {string} [criteria.input_data_file] - Filter by file sample ID
 * @param {string} [criteria.input_user_prompt] - Filter by prompt ID
 * @returns {Promise<Array>} - Array of matching correlation entries
 */
export async function findCorrelations(criteria = {}) {
  const correlations = await getAllCorrelations();
  
  return correlations.filter(corr => {
    for (const [key, value] of Object.entries(criteria)) {
      if (corr[key] !== value) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Get correlation by ID
 * 
 * @param {string} correlationId - The correlation ID
 * @returns {Promise<object|null>} - The correlation entry or null if not found
 */
export async function getCorrelationById(correlationId) {
  const correlations = await getAllCorrelations();
  return correlations.find(entry => entry.id === correlationId) || null;
}

/**
 * Generate a comparison report for multiple correlations
 * 
 * @param {Array} correlationIds - Array of correlation IDs to compare
 * @returns {Promise<object>} - Comparison report
 */
export async function generateComparisonReport(correlationIds) {
  const correlations = await Promise.all(
    correlationIds.map(id => getCorrelationById(id))
  );
  
  const validCorrelations = correlations.filter(c => c !== null);
  
  const byModel = Object.create(null);
  const byDocument = Object.create(null);
  const byPrompt = Object.create(null);
  
  for (const corr of validCorrelations) {
    // Group by model
    if (!byModel[corr.modelId]) {
      byModel[corr.modelId] = [];
    }
    byModel[corr.modelId].push(corr);
    
    // Group by file
    if (!byDocument[corr.input_data_file]) {
      byDocument[corr.input_data_file] = [];
    }
    byDocument[corr.input_data_file].push(corr);
    
    // Group by prompt
    if (!byPrompt[corr.input_user_prompt]) {
      byPrompt[corr.input_user_prompt] = [];
    }
    byPrompt[corr.input_user_prompt].push(corr);
  }
  
  return {
    correlations: validCorrelations,
    byModel,
    byDocument,
    byPrompt
  };
}
