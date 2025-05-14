
export default class OpenAIAdapter {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:1234';
    this.model = normalizeModelId(config.model);
    this.temperature = config.temperature || 0.7;
    this.max_tokens = config.max_tokens || 2048;
    this.timeout = parseInt(process.env.REQUEST_TIMEOUT_MS || '120000', 10);

    console.log(`OpenAIAdapter initialized with model: ${this.model}, max_tokens: ${this.max_tokens}`);
  }
  
  /**
   * Get a filesystem-safe version of the model ID for file paths
   * 
   * @param {string} modelId - The model ID to normalize for file paths
   * @returns {string} - The normalized model ID safe for file paths
   */
  static getModelIdForFilePath(modelId) {
    return normalizeModelIdForFilePath(modelId);
  }

  /**
   * Execute a prompt with the model
   * 
   * This method is maintained for backward compatibility.
   * It internally converts the prompt to a chat format and calls the chat method.
   * 
   * @param {string|object} prompt - The prompt to send to the model
   * @param {object} options - Additional options for the model
   * @returns {Promise<object>} The model's response
   */
  async execute(prompt, options = {}) {
    try {
      // Convert to chat format
      const messages = [
        { role: 'user', content: prompt }
      ];
      
      return this.chat(messages, options);
    } catch (error) {
      console.error('Error executing prompt with model:', error);
      throw error;
    }
  }

  /**
   * Execute a chat completion with the model
   * This is the recommended method for all model interactions
   * 
   * Key implementation details:
   * - Supports JSON schema for structured output
   * - Implements request timeout using AbortController
   * - Handles errors with detailed error messages
   * - Supports all OpenAI chat completion parameters
   * 
   * @param {Array} messages - Array of message objects with role and content
   * @param {object} options - Additional options for the model
   * @returns {Promise<object>} The model's response
   */
  async chat(messages, options = {}) {
    const endpoint = `${this.baseUrl}/v1/chat/completions`;
    
    // If a specific model is provided in options, normalize it
    const modelToUse = options.model ?
        normalizeModelId(options.model) :
      this.model;

    const requestBody = {
      model: modelToUse,
      messages,
      temperature: options.temperature || this.temperature,
      max_tokens: options.max_tokens || this.max_tokens,
      top_p: options.top_p || 0.95,
    };
    
    if (options.schema) {
      requestBody.response_format = {
        type: "json_schema",
        json_schema: {
          name: "contract_analysis",
          strict: true,
          schema: options.schema
        }
      };
    }
    
    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    console.log(`Request timeout set to ${this.timeout}ms`);
    
    try {
      // Start timing the request
      const startTime = Date.now();
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      // End timing the request
      const endTime = Date.now();
      const completionTime = endTime - startTime;
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API request failed with status ${response.status}: ${JSON.stringify(errorData)}`);
      }

      const responseData = await response.json();
      
      if (!responseData.usage) {
        responseData.usage = {
          completion_ms: completionTime || 0
        };
      }
      
      return responseData;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${this.timeout}ms`);
      }
      console.error('Error executing chat with model:', error);
      throw error;
    }
  }
  
  /**
   * List available models
   * 
   * Key implementation details:
   * - Queries the v1/models endpoint to get available models
   * - Handles errors with detailed error messages
   * - Implements request timeout using AbortController
   * 
   * @returns {Promise<object>} List of available models
   */
  async listModels() {
    const endpoint = `${this.baseUrl}/v1/models`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API request failed with status ${response.status}: ${JSON.stringify(errorData)}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${this.timeout}ms`);
      }
      console.error('Error listing models:', error);
      throw error;
    }
  }
}

/**
 * Normalize a model ID to ensure compatibility with the server
 * For API calls, we preserve the full model name including organization prefix
 *
 * @param {string} modelId - The model ID to normalize
 * @returns {string} - The normalized model ID
 */
function normalizeModelId(modelId) {
  if (!modelId) {
    return 'default';
  }

  // For API calls, we preserve the full model name as-is
  return modelId;
}

/**
 * Get a filesystem-safe version of a model ID
 * This removes organization prefixes and other characters that might be problematic in filenames
 *
 * @param {string} modelId - The model ID to normalize for file paths
 * @returns {string} - The normalized model ID safe for file paths
 */
function normalizeModelIdForFilePath(modelId) {
  if (!modelId) {
    return 'default';
  }

  // Remove organization prefix for file paths
  if (modelId.includes('/')) {
    const parts = modelId.split('/');
    return parts[parts.length - 1].split(':').pop();
  }

  return modelId;
}
