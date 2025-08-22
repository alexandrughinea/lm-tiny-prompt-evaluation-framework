
import axios from 'axios';

export default class OpenAIAdapter {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:1234';
    this.model = normalizeModelId(config.model);
    this.temperature = config.temperature || 0.7;
    this.timeout = parseInt(process.env.REQUEST_TIMEOUT_MS || '900000', 10);
    
    this.authUsername = process.env.AUTH_USERNAME;
    this.authPassword = process.env.AUTH_PASSWORD;
    this.authHeader = null;
    
    if (this.authUsername && this.authPassword) {
      const credentials = Buffer.from(`${this.authUsername}:${this.authPassword}`).toString('base64');
      this.authHeader = `Basic ${credentials}`;
      console.log('OpenAIAdapter initialized with basic authentication');
    }

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

    // Calculate total input tokens (approximate)
    let inputTokenCount = 0;
    messages.forEach(msg => {
      // Rough estimate: 1 token ≈ 4 characters for English text
      inputTokenCount += Math.ceil((msg.content?.length || 0) / 4);
    });
    
    const defaultMaxTokens = options.max_tokens || this.max_tokens;
    const safeMaxTokens = Math.max(defaultMaxTokens, 32000 - inputTokenCount);
    
    console.log(`Estimated input tokens: ~${inputTokenCount}`);
    console.log(`Adjusted max_tokens to: ${safeMaxTokens} (from ${defaultMaxTokens})`);

    const requestBody = {
      model: modelToUse,
      messages,
      temperature: options.temperature || this.temperature,
      max_tokens: safeMaxTokens,
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
    
    console.log(`Request timeout set to ${this.timeout}ms`);
    
    try {
      // Start timing the request
      const startTime = Date.now();
      
      // Configure axios for large responses
      const headers = {
        'Content-Type': 'application/json',
      };
      
      if (this.authHeader) {
        headers['Authorization'] = this.authHeader;
      }
      
      const response = await axios({
        method: 'post',
        url: endpoint,
        data: requestBody,
        headers,
        timeout: this.timeout,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      
      // End timing the request
      const endTime = Date.now();
      const completionTime = endTime - startTime;
      
      // Axios automatically parses JSON responses
      const responseData = response.data;
      
      // Log response details for debugging
      if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
        const contentLength = responseData.choices[0].message.content?.length || 0;
        console.log(`Response content length: ${contentLength} characters`);
        
        // Check for potentially truncated responses
        if (contentLength > 0 && responseData.choices[0].finish_reason === 'length') {
          console.warn('Warning: Response may be truncated (finish_reason=length)');
        }
      }
      
      if (!responseData.usage) {
        responseData.usage = {
          completion_ms: completionTime || 0
        };
      }
      
      return responseData;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error(`Request timed out after ${this.timeout}ms`);
      }
      
      // Enhanced error reporting
      if (error.response) {
        // The request was made and the server responded with a status code
        console.error('Error response data:', error.response.data);
        console.error('Error response status:', error.response.status);
        throw new Error(`API request failed with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        // The request was made but no response was received
        console.error('No response received:', error.request);
        throw new Error(`No response received from server: ${error.message}`);
      } else {
        // Something happened in setting up the request
        console.error('Error setting up request:', error.message);
        throw error;
      }
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
    
    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      
      // Add authentication header if available
      if (this.authHeader) {
        headers['Authorization'] = this.authHeader;
      }
      
      const response = await axios({
        method: 'get',
        url: endpoint,
        headers,
        timeout: this.timeout
      });
      
      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error(`Request timed out after ${this.timeout}ms`);
      }
      
      if (error.response) {
        throw new Error(`API request failed with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else {
        console.error('Error listing models:', error);
        throw error;
      }
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
