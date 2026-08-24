import axios from 'axios';
import { CONFIGURATION } from '../config.js';

export default class OpenAIAdapter {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:1234';
    this.model = normalizeModelId(config.model);
    this.temperature = config.temperature ?? CONFIGURATION.models.temperature;
    this.max_tokens = config.max_tokens ?? CONFIGURATION.models.max_tokens;
    this.timeout = parseInt(process.env.REQUEST_TIMEOUT_MS || '900000', 10);
    
    this.authUsername = process.env.AUTH_USERNAME;
    this.authPassword = process.env.AUTH_PASSWORD;
    this.authHeader = null;

    const apiKey = (process.env.API_KEY || '').trim();
    if (apiKey) {
      this.authHeader = `Bearer ${apiKey}`;
      console.log('OpenAIAdapter using Bearer API key');
    } else if (this.authUsername && this.authPassword) {
      const credentials = Buffer.from(`${this.authUsername}:${this.authPassword}`).toString('base64');
      this.authHeader = `Basic ${credentials}`;
      console.log('OpenAIAdapter using basic authentication');
    }

    console.log(`OpenAIAdapter initialized with model: ${this.model}, max_tokens: ${this.max_tokens}`);
  }
  
  static getModelIdForFilePath(modelId) {
    return normalizeModelIdForFilePath(modelId);
  }

  async execute(prompt, options = {}) {
    try {
      const messages = [
        { role: 'user', content: prompt }
      ];
      
      return this.chat(messages, options);
    } catch (error) {
      console.error('Error executing prompt with model:', error);
      throw error;
    }
  }

  async chat(messages, options = {}) {
    const endpoint = `${this.baseUrl}/v1/chat/completions`;
    
    const modelToUse = options.model ?
        normalizeModelId(options.model) :
      this.model;

    let inputTokenCount = 0;
    messages.forEach(msg => {
      inputTokenCount += estimateContentTokens(msg.content);
    });
    
    const defaultMaxTokens = options.max_tokens ?? this.max_tokens;
    const contextWindowTokens = 32000;
    const remainingContext = contextWindowTokens - inputTokenCount;
    const safeMaxTokens = Math.max(defaultMaxTokens, remainingContext);
    
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
          name: options.schema.title || 'structured_output',
          strict: true,
          schema: options.schema
        }
      };
    }
    
    console.log(`Request timeout set to ${this.timeout}ms`);
    
    try {
      const startTime = Date.now();
      
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
      
      const endTime = Date.now();
      const completionTime = endTime - startTime;
      
      const responseData = response.data;
      
      if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
        const contentLength = responseData.choices[0].message.content?.length || 0;
        console.log(`Response content length: ${contentLength} characters`);
        
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
      
      if (error.response) {
        console.error('Error response data:', error.response.data);
        console.error('Error response status:', error.response.status);
        throw new Error(`API request failed with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        console.error('No response received:', error.request);
        throw new Error(`No response received from server: ${error.message}`);
      } else {
        console.error('Error setting up request:', error.message);
        throw error;
      }
    }
  }
  
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
 * Approximate input tokens for chat content.
 * Text: ~4 characters per token. Images: IMAGE_TOKEN_ALLOWANCE (request budget, not an API field).
 *
 * @param {string|Array|undefined} content
 * @returns {number}
 */
function estimateContentTokens(content) {
  if (typeof content === 'string') {
    return Math.ceil(content.length / 4);
  }
  if (!Array.isArray(content)) {
    return 0;
  }
  return content.reduce((tokens, part) => {
    if (part?.type === 'text') {
      return tokens + Math.ceil((part.text?.length || 0) / 4);
    }
    if (part?.type === 'image_url') {
      return tokens + CONFIGURATION.performance.imageTokenAllowance;
    }
    return tokens;
  }, 0);
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
