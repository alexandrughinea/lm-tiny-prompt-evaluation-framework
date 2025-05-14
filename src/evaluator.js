import fs from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to custom evaluators
const EVALUATORS_DIR = path.join(__dirname, '..', 'input', 'evaluators');

/**
 * Loads a custom evaluator if available
 * 
 * @param {string} type - Type of evaluator ('quantitative' or 'qualitative')
 * @returns {Function|null} - The evaluator function or null if not found
 */
async function loadCustomEvaluator(type) {
  try {
    const evaluatorPath = path.join(EVALUATORS_DIR, `${type}.js`);
    
    // Check if the file exists
    try {
      await fs.access(evaluatorPath);
    } catch (error) {
      // File doesn't exist, return null
      return null;
    }
    
    // Import the evaluator module
    const evaluatorModule = await import(`file://${evaluatorPath}`);
    
    // Get the appropriate function based on type
    const functionName = type === 'quantitative' ? 'evaluateQuantitative' : 'evaluateQualitative';
    
    if (evaluatorModule && typeof evaluatorModule[functionName] === 'function') {
      return evaluatorModule[functionName];
    }
    
    return null;
  } catch (error) {
    console.error(`Error loading ${type} evaluator:`, error);
    return null;
  }
}

/**
 * Main evaluation function that returns both quantitative scores and qualitative assessments
 * 
 * Key implementation details:
 * - Automatically parses string results into JSON objects
 * - Falls back to a simple object with raw_text if parsing fails
 * - Dynamically loads custom evaluators from the input/evaluators directory if available
 * - Uses default evaluators as fallback if custom evaluators aren't found
 * - Combines quantitative metrics and qualitative assessments into a single result
 * - Supports expected fields and relevant terms for content evaluation
 * 
 * @param {Object|string} result - The model result (JSON object or string)
 * @param {Object} options - Optional configuration parameters
 * @returns {Object} - Complete evaluation with scores and qualitative insights
 */
export async function evaluate(result, options = {}) {
  // Parse result if it's a string
  let parsedResult = result;
  if (typeof result === "string") {
    try {
      parsedResult = JSON.parse(result);
    } catch (error) {
      // If not valid JSON, create a simple object
      parsedResult = { raw_text: result };
    }
  }

  // Load custom evaluators if available
  const customQuantitative = await loadCustomEvaluator('quantitative');
  const customQualitative = await loadCustomEvaluator('qualitative');
  
  // Use custom evaluators if available, otherwise use default
  const quantitative = customQuantitative ? 
    customQuantitative(parsedResult, options) : 
    quantitativeEvaluation(parsedResult, options);
    
  const qualitative = customQualitative ? 
    customQualitative(parsedResult, options) : 
    qualitativeEvaluation(parsedResult, options);
  
  return {
    quantitative,
    qualitative
  };
}

/**
 * Calculates quantitative metrics for a model result
 * This is the default implementation used when no custom evaluator is available
 * 
 * @param {Object} result - The model result (parsed)
 * @param {Object} options - Optional configuration parameters
 * @returns {Object} - Quantitative metrics
 */
export function quantitativeEvaluation(result, options = {}) {
  // Default metrics
  const metrics = {
    accuracy: 0,
    completeness: 0,
    relevance: 0,
    overall: 0,
    errors: []
  };
  
  try {
    // Get expected fields from options or use defaults
    const expectedFields = options.expectedFields || [];
    const relevantTerms = options.relevantTerms || [];
    
    if (expectedFields.length > 0) {
      // Calculate completeness based on presence of expected fields
      const presentFields = expectedFields.filter(field => {
        return field.alternateNames.some(name => result[name] !== undefined);
      }).length;
      metrics.completeness = expectedFields.length > 0 ? presentFields / expectedFields.length : 0;
    }
    
    if (relevantTerms.length > 0) {
      // Calculate relevance based on presence of relevant terms
      const responseText = JSON.stringify(result).toLowerCase();
      const relevantTermsFound = relevantTerms.filter(term => responseText.includes(term)).length;
      metrics.relevance = relevantTerms.length > 0 ? relevantTermsFound / relevantTerms.length : 0;
    } else {

    }
    
    // Calculate accuracy and overall score
    metrics.accuracy = options.accuracyFn ? options.accuracyFn(result, options) : (metrics.completeness + metrics.relevance) / 2;
    metrics.overall = options.overallFn ? options.overallFn(metrics.accuracy, metrics.completeness, metrics.relevance, options) :
        (metrics.accuracy * 0.4) + (metrics.completeness * 0.4) + (metrics.relevance * 0.2);

    return metrics

  } catch (error) {
    metrics.errors.push(error);
    return metrics
  }
}

/**
 * Provides qualitative assessment of model results
 * This is the default implementation used when no custom evaluator is available
 * 
 * @param {Object} result - The model result (parsed)
 * @param {Object} options - Optional configuration parameters
 * @returns {Object} - Qualitative assessment
 */
export function qualitativeEvaluation(result, options = {}) {
  // Default assessment structure
  const assessment = {
    strengths: [],
    weaknesses: [],
    suggestions: []
  };
  
  try {
    // Use custom assessment function if provided
    if (options.assessmentFn && typeof options.assessmentFn === 'function') {
      const customAssessment = options.assessmentFn(result, options);
      if (customAssessment) {
        Object.assign(assessment, customAssessment);
        return assessment;
      }
    }
    
    // Get expected fields from options
    const expectedFields = options.expectedFields || [];
    
    // Check for strengths and weaknesses based on expected fields
    for (const field of expectedFields) {
      const hasField = field.alternateNames.some(name => result[name] !== undefined);
      
      if (hasField) {
        assessment.strengths.push(`Contains ${field.description}`);
      } else {
        assessment.weaknesses.push(`Missing ${field.description}`);
      }
    }
    
    // Add generic suggestions based on weaknesses
    if (assessment.weaknesses.length > 0) {
      assessment.suggestions.push("Ensure all expected elements are included in the response");
    }
    
    if (assessment.strengths.length < Math.ceil(expectedFields.length / 2)) {
      assessment.suggestions.push("Provide more comprehensive information in the response");
    }
  } catch (error) {
    console.warn("Error in qualitative evaluation:", error.message);
    assessment.weaknesses.push("Error processing the response format");
    assessment.suggestions.push("Ensure response is properly formatted as requested");
  }
  
  return assessment;
}

