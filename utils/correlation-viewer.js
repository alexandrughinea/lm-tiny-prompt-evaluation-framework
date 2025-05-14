import fs from 'fs/promises';
import {findCorrelations, generateComparisonReport} from '../src/correlator.js';

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        mode: 'list',       // Default mode: list, compare, detail
        modelId: null,
        input_data_file: null,
        input_user_prompt: null,
        correlationIds: [],
        format: 'table',    // table, json
        sortBy: 'timestamp',
        sortOrder: 'desc'
    };

    for (const arg of args) {
        if (arg === '--list' || arg === '-l') {
            options.mode = 'list';
        } else if (arg === '--compare' || arg === '-c') {
            options.mode = 'compare';
        } else if (arg === '--detail' || arg === '-d') {
            options.mode = 'detail';
        } else if (arg.startsWith('--model=')) {
            options.modelId = arg.split('=')[1];
        } else if (arg.startsWith('--file=')) {
            options.input_data_file = arg.split('=')[1];
        } else if (arg.startsWith('--prompt=')) {
            options.input_user_prompt = arg.split('=')[1];
        } else if (arg.startsWith('--id=')) {
            options.correlationIds.push(arg.split('=')[1]);
        } else if (arg.startsWith('--format=')) {
            options.format = arg.split('=')[1];
        } else if (arg.startsWith('--sort-by=')) {
            options.sortBy = arg.split('=')[1];
        } else if (arg.startsWith('--sort-order=')) {
            options.sortOrder = arg.split('=')[1];
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }
    }

    return options;
}

/**
 * Print usage instructions
 */
function printUsage() {
    console.log(`
Correlation Viewer - Analyze relationships between models, data, prompts, and results

Usage:
  node correlation-viewer.js [options]

Modes:
  --list, -l             List correlations (default)
  --compare, -c          Compare multiple correlations
  --detail, -d           Show detailed information for a correlation

Filters:
  --model=<modelId>      Filter by model ID
  --file=<input_data_file> Filter by file ID
  --prompt=<input_user_prompt>    Filter by prompt ID
  --id=<correlationId>   Specify a correlation ID (can be used multiple times)

Output Options:
  --format=<format>      Output format: table, json (default: table)
  --sort-by=<field>      Sort by field: timestamp, modelId, input_data_file, input_user_prompt (default: timestamp)
  --sort-order=<order>   Sort order: asc, desc (default: desc)

Examples:
  # List all correlations
  node correlation-viewer.js

  # List correlations for a specific model
  node correlation-viewer.js --model=mistral-7b-instruct-v0.2

  # Compare specific correlations
  node correlation-viewer.js --compare --id=<id1> --id=<id2>

  # Show detailed information for a correlation
  node correlation-viewer.js --detail --id=<id>
`);
}

/**
 * Format correlations as a table
 */
function formatAsTable(correlations) {
    if (correlations?.length === 0) {
        return 'No correlations found.';
    }

    // Define table headers and column widths
    const headers = ['ID', 'Model', 'Document', 'Prompt', 'Timestamp', 'Metrics'];
    const widths = [8, 20, 20, 15, 24, 30];

    // Create header row
    let table = headers.map((header, i) => header.padEnd(widths[i])).join(' | ') + '\n';
    table += headers.map((_, i) => '-'.repeat(widths[i])).join('-+-') + '\n';

    // Add data rows
    for (const corr of correlations) {
        const id = corr.id.substring(0, 8); // Truncate ID for display
        const model = corr.modelId.substring(0, widths[1] - 3) + (corr.modelId?.length > widths[1] - 3 ? '...' : '');
        const doc = corr.input_data_file.substring(0, widths[2] - 3) + (corr.input_data_file?.length > widths[2] - 3 ? '...' : '');
        const prompt = corr.input_user_prompt.substring(0, widths[3]);
        const timestamp = new Date(corr.timestamp).toLocaleString();

        // Format metrics
        let metrics = '';
        if (corr.metrics) {
            const metricEntries = Object.entries(corr.metrics);
            if (metricEntries.length > 0) {
                metrics = metricEntries
                    .map(([key, value]) => `${key}: ${typeof value === 'number' ? value.toFixed(2) : value}`)
                    .join(', ');

                if (metrics.length > widths[5] - 3) {
                    metrics = metrics.substring(0, widths[5] - 3) + '...';
                }
            }
        }

        table += [id, model, doc, prompt, timestamp, metrics]
            .map((val, i) => (val || '').toString().padEnd(widths[i]))
            .join(' | ') + '\n';
    }

    return table;
}

/**
 * Format comparison as a table
 */
function formatComparisonAsTable(comparison) {
    let output = '\nComparison Report\n================\n\n';

    // Summary of correlations
    output += `Total correlations: ${comparison.correlations.length}\n\n`;

    // Models comparison
    output += 'Models:\n';
    for (const [modelId, correlations] of Object.entries(comparison.byModel)) {
        output += `  ${modelId}: ${correlations.length} correlations\n`;

        // Calculate average metrics per model
        const metrics = {};
        let count = 0;

        for (const corr of correlations) {
            if (corr.metrics) {
                count++;
                for (const [key, value] of Object.entries(corr.metrics)) {
                    if (typeof value === 'number') {
                        metrics[key] = (metrics[key] || 0) + value;
                    }
                }
            }
        }

        // Output average metrics
        if (count > 0) {
            output += '    Average metrics: ';
            output += Object.entries(metrics)
                .map(([key, value]) => `${key}: ${(value / count).toFixed(2)}`)
                .join(', ') + '\n';
        }

        output += '\n';
    }

    // Documents comparison
    output += 'Documents:\n';
    for (const [docId, correlations] of Object.entries(comparison.byDocument)) {
        output += `  ${docId}: ${correlations.length} correlations\n`;
    }
    output += '\n';

    // Prompts comparison
    output += 'Prompts:\n';
    for (const [input_user_prompt, correlations] of Object.entries(comparison.byPrompt)) {
        output += `  ${input_user_prompt}: ${correlations.length} correlations\n`;

        // Calculate average metrics per prompt
        const metrics = {};
        let count = 0;

        for (const corr of correlations) {
            if (corr.metrics) {
                count++;
                for (const [key, value] of Object.entries(corr.metrics)) {
                    if (typeof value === 'number') {
                        metrics[key] = (metrics[key] || 0) + value;
                    }
                }
            }
        }

        // Output average metrics
        if (count > 0) {
            output += '    Average metrics: ';
            output += Object.entries(metrics)
                .map(([key, value]) => `${key}: ${(value / count).toFixed(2)}`)
                .join(', ') + '\n';
        }

        output += '\n';
    }

    return output;
}

/**
 * Format detailed correlation information
 */
async function formatDetailedInfo(correlationId) {
    const correlations = await findCorrelations({id: correlationId});

    if (correlations.length === 0) {
        return `Correlation not found: ${correlationId}`;
    }

    const corr = correlations[0];
    let output = `\nDetailed Correlation Information\n===============================\n\n`;

    // Basic information
    output += `ID: ${corr.id}\n`;
    output += `Model: ${corr.modelId}\n`;
    output += `Document: ${corr.input_data_file}\n`;
    output += `Prompt: ${corr.input_user_prompt}\n`;
    output += `Timestamp: ${new Date(corr.timestamp).toLocaleString()}\n`;
    output += `Result Path: ${corr.resultPath}\n\n`;

    // Metrics
    output += 'Metrics:\n';
    if (corr.metrics && Object.keys(corr.metrics).length > 0) {
        for (const [key, value] of Object.entries(corr.metrics)) {
            output += `  ${key}: ${typeof value === 'number' ? value.toFixed(2) : value}\n`;
        }
    } else {
        output += '  No metrics available\n';
    }

    // Try to load the result file
    try {
        const resultData = JSON.parse(await fs.readFile(corr.resultPath, 'utf8'));
        const result = resultData.find(r => r.model === corr.modelId && r.promptType === corr.input_user_prompt);

        if (result) {
            output += '\nResponse:\n';
            if (result.response) {
                // Format the response for display
                const responseText = typeof result.response === 'string'
                    ? result.response
                    : JSON.stringify(result.response, null, 2);

                output += '\n```\n' + responseText.substring(0, 1000) + '\n```\n';
                if (responseText?.length > 1000) {
                    output += '(Response truncated, see result file for full response)\n';
                }
            } else if (result.error) {
                output += `\nError: ${result.error}\n`;
            }

            // Evaluation details if available
            if (result.evaluation) {
                output += '\nFull Evaluation:\n';
                output += '\n```\n' + JSON.stringify(result.evaluation, null, 2) + '\n```\n';
            }
        }
    } catch (error) {
        output += `\nCould not load result file: ${error.message}\n`;
    }

    return output;
}

/**
 * Main function
 */
async function main() {
    try {
        const options = parseArgs();

        if (options.mode === 'list') {
            // List correlations with optional filters
            const filters = {};
            if (options.modelId) filters.modelId = options.modelId;
            if (options.input_data_file) filters.input_data_file = options.input_data_file;
            if (options.input_user_prompt) filters.input_user_prompt = options.input_user_prompt;

            let correlations = await findCorrelations(filters);

            // Sort correlations
            correlations.sort((a, b) => {
                const aValue = a[options.sortBy];
                const bValue = b[options.sortBy];

                if (options.sortOrder === 'asc') {
                    return aValue > bValue ? 1 : -1;
                } else {
                    return aValue < bValue ? 1 : -1;
                }
            });

            // Output correlations
            if (options.format === 'json') {
                console.log(JSON.stringify(correlations, null, 2));
            } else {
                console.log(formatAsTable(correlations));
            }

        } else if (options.mode === 'compare') {
            // Compare correlations
            if (options.correlationIds?.length < 2) {
                console.error('Error: At least two correlation IDs are required for comparison');
                printUsage();
                process.exit(1);
            }

            const report = await generateComparisonReport(options.correlationIds);

            if (options.format === 'json') {
                console.log(JSON.stringify(report, null, 2));
            } else {
                console.log(formatComparisonAsTable(report));
            }

        } else if (options.mode === 'detail') {
            // Show detailed information for a correlation
            if (options.correlationIds?.length === 0) {
                console.error('Error: Correlation ID is required for detailed view');
                printUsage();
                process.exit(1);
            }

            const detailedInfo = await formatDetailedInfo(options.correlationIds[0]);
            console.log(detailedInfo);
        }

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Run the main function
main();
