/**
 * CSV formatting constants
 */
export const CSV_FORMAT = {
    FRACTION_DIGITS: 4,
    NA: 'N/A',
    COMMA: ',',
    NEW_LINE: '\n'
};

/**
 * Get framework-specific CSV headers array
 *
 * @returns {Array} Array of framework-specific CSV headers
 */
/**
 * Get the ordered list of CSV header fields
 * @returns {string[]} Array of header field names
 */
export function getCSVColumns() {
    return [
        'id',
        'timestamp',
        'model',
        'input_user_prompt',
        'input_system_prompt',
        'input_assistant_prompt',
        'input_data_file',
        // Quantitative metrics
        'overall_score',
        'accuracy',
        'completeness',
        'relevance',
        'errors_count',
        // Qualitative metrics
        'strengths_count',
        'weaknesses_count',
        'suggestions_count'
    ];
}

export function getCSVDataMap({
                                  id,
                                  timestamp,
                                  model,
                                  input_user_prompt,
                                  input_data_file,
                                  input_system_prompt,
                                  input_assistant_prompt,
                                  quantitative,
                                  qualitative
                              }) {

    const overallScore = quantitative.overall.toFixed(CSV_FORMAT.FRACTION_DIGITS) || CSV_FORMAT.NA;
    const accuracy = quantitative.accuracy.toFixed(CSV_FORMAT.FRACTION_DIGITS) || CSV_FORMAT.NA;
    const completeness = quantitative.completeness.toFixed(CSV_FORMAT.FRACTION_DIGITS) || CSV_FORMAT.NA;
    const relevance = quantitative.relevance.toFixed(CSV_FORMAT.FRACTION_DIGITS) || CSV_FORMAT.NA;

    return {
        id,
        timestamp,
        model: model || CSV_FORMAT.NA,
        input_user_prompt: input_user_prompt || CSV_FORMAT.NA,
        input_system_prompt: input_system_prompt || CSV_FORMAT.NA,
        input_assistant_prompt: input_assistant_prompt || CSV_FORMAT.NA,
        input_data_file: input_data_file || CSV_FORMAT.NA,
        // Quantitative metrics
        overall_score: overallScore,
        accuracy,
        completeness,
        relevance,
        errors_count: quantitative.errors?.length || 0,
        // Qualitative metrics
        strengths_count: qualitative.strengths?.length || 0,
        weaknesses_count: qualitative.weaknesses?.length || 0,
        suggestions_count: qualitative.suggestions?.length || 0,
    };
}

/**
 * Get framework-specific CSV headers string
 * @returns {string} CSV header string
 */
export function getCSVColumnsJoined() {
    return getCSVColumns().join(CSV_FORMAT.COMMA);
}


/**
 * Escape text for CSV format
 *
 * @param {string} text - Text to escape for CSV
 * @returns {string} - CSV-escaped text
 */
export function escapeCSV(text) {
    if (typeof text === 'string') {
        // Replace double quotes with two double quotes (CSV standard)
        // And wrap in quotes if contains commas, newlines or quotes
        if (text.includes(',') || text.includes('\n') || text.includes('"')) {
            return `"${text.replace(/"/g, '""')}"`;
        }
    }
    return text;
}
