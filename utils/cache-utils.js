import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ensureDir } from './file-utils.js';

/**
 * Generates a cache key for a prompt-data combination.
 * Image sidecars are hashed by bytes so keys stay small and stable.
 *
 * @param {string} model - The model ID
 * @param {Object} prompt - The prompt object
 * @param {string|{text?: string, images?: Array<{filename: string, mime: string, buffer: Buffer}>}} data
 * @returns {string} - A unique hash for this combination
 */
export function generateCacheKey(model, prompt, data) {
  const text = typeof data === 'string' ? data : (data?.text || '');
  const images = Array.isArray(data?.images)
    ? data.images.map(img => ({
        filename: img.filename,
        mime: img.mime,
        hash: crypto.createHash('md5').update(img.buffer).digest('hex')
      }))
    : [];

  return crypto.createHash('md5').update(JSON.stringify({
    model,
    promptType: prompt.type,
    promptName: prompt.name,
    promptContent: prompt.content,
    text,
    images
  })).digest('hex');
}

/**
 * Saves a response to the cache
 * 
 * @param {string} cacheDir - Directory to store cache files
 * @param {string} cacheKey - The unique cache key
 * @param {Object} response - The model response to cache
 */
export async function saveToCache(cacheDir, cacheKey, response) {
  try {
    await ensureDir(cacheDir);
    const cacheFile = path.join(cacheDir, `${cacheKey}.json`);
    await fs.writeFile(cacheFile, JSON.stringify(response, null, 2));
    console.log(`Cached response with key: ${cacheKey}`);
  } catch (error) {
    console.warn(`Error saving to cache: ${error.message}`);
  }
}

/**
 * Retrieves a response from the cache if available
 * 
 * @param {string} cacheDir - Directory where cache files are stored
 * @param {string} cacheKey - The unique cache key
 * @returns {Object|null} - The cached response or null if not found
 */
export async function getFromCache(cacheDir, cacheKey) {
  try {
    const cacheFile = path.join(cacheDir, `${cacheKey}.json`);
    
    try {
      await fs.access(cacheFile);
    } catch {
      return null;
    }
    
    const cacheData = await fs.readFile(cacheFile, 'utf8');
    const cachedResponse = JSON.parse(cacheData);
    console.log(`Retrieved cached response with key: ${cacheKey}`);
    
    return cachedResponse;
  } catch (error) {
    console.warn(`Error retrieving from cache: ${error.message}`);
    return null;
  }
}

/**
 * Clears all cache files
 * 
 * @param {string} cacheDir - Directory where cache files are stored
 */
export async function clearCache(cacheDir) {
  try {
    const files = await fs.readdir(cacheDir);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        await fs.unlink(path.join(cacheDir, file));
      }
    }
    
    console.log(`Cleared ${files?.length} cache files`);
  } catch (error) {
    console.warn(`Error clearing cache: ${error.message}`);
  }
}
