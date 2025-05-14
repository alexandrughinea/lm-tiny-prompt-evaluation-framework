import fs from 'fs/promises';

/**
 * Ensures a directory exists, creating it if necessary
 *
 * @param {string} dirPath - Path to the directory to ensure exists
 * @returns {Promise<void>}
 */
export async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, {recursive: true});
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}
