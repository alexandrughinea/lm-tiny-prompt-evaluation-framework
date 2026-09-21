import {
    fieldGold,
    fieldMatchScore,
    fieldMissCount,
    fieldPredicted,
    macroF1FromResults,
    perFieldClassification
} from './report-utils.js';

export const CSV_FORMAT = {
    FRACTION_DIGITS: 4,
    COMMA: ',',
    NEW_LINE: '\n'
};

const BASE_COLUMNS = [
    'id',
    'timestamp',
    'experiment',
    'model',
    'prompt_name',
    'input_system_prompt',
    'input_user_prompt',
    'input_data_file',
    'input_kind',
    'bucket',
    'format_valid'
];

const TAIL_COLUMNS = [
    'hamming_accuracy',
    'exact_match',
    'confidence_exact',
    'confidence_hamming',
    'brier_exact',
    'calibration_mse',
    'miss_count',
    'processing_time'
];

function goldColumnName(fieldName) {
    return `gold_${fieldName}`;
}

function predColumnName(fieldName) {
    return `pred_${fieldName}`;
}

function correctColumnName(fieldName) {
    return `correct_${fieldName}`;
}

export function getCSVColumns(fieldNames = []) {
    return [
        ...BASE_COLUMNS,
        ...fieldNames.flatMap(name => [
            goldColumnName(name),
            predColumnName(name),
            correctColumnName(name)
        ]),
        ...TAIL_COLUMNS
    ];
}

function formatScore(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '';
    }
    return value.toFixed(CSV_FORMAT.FRACTION_DIGITS);
}

function formatBit(value) {
    if (value === true || value === 1) {
        return '1';
    }
    if (value === false || value === 0) {
        return '0';
    }
    return '';
}

function formatScalar(value) {
    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
        return String(value);
    }
    if (typeof value === 'string' && value.length > 0) {
        return value;
    }
    return '';
}

function formatCorrect(fields, name) {
    const score = fieldMatchScore(fields, name);
    if (score === 1) {
        return '1';
    }
    if (score === 0) {
        return '0';
    }
    return '';
}

function meanBy(results, getter) {
    const values = results
        .map(getter)
        .filter(value => typeof value === 'number' && !Number.isNaN(value));
    if (values.length === 0) {
        return null;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getCSVDataMap({
    id,
    timestamp,
    model,
    prompt_name,
    task,
    input_system_prompt,
    input_user_prompt,
    input_data_file,
    input_kind,
    quantitative,
    processing_time
}, fieldNames = []) {
    const fields = quantitative?.fields || {};
    const fieldCells = Object.create(null);
    for (const name of fieldNames) {
        fieldCells[goldColumnName(name)] = formatScalar(fieldGold(fields, name));
        fieldCells[predColumnName(name)] = formatScalar(fieldPredicted(fields, name));
        fieldCells[correctColumnName(name)] = formatCorrect(fields, name);
    }

    return {
        id: id || '',
        timestamp: timestamp || '',
        experiment: task?.experiment || '',
        model: model || '',
        prompt_name: task?.prompt_name || prompt_name || '',
        input_system_prompt: input_system_prompt || '',
        input_user_prompt: input_user_prompt || '',
        input_data_file: input_data_file || '',
        input_kind: input_kind || '',
        bucket: quantitative?.bucket || '',
        format_valid: formatBit(quantitative?.format_valid),
        ...fieldCells,
        hamming_accuracy: formatScore(quantitative?.hamming_accuracy),
        exact_match: formatBit(quantitative?.exact_match),
        confidence_exact: formatScore(quantitative?.confidence_exact),
        confidence_hamming: formatScore(quantitative?.confidence_hamming),
        brier_exact: formatScore(quantitative?.brier_exact),
        calibration_mse: formatScore(quantitative?.calibration_mse),
        miss_count: fieldMissCount(fields),
        processing_time: typeof processing_time === 'number' ? String(processing_time) : ''
    };
}

export function getCSVColumnsJoined(fieldNames = []) {
    return getCSVColumns(fieldNames).join(CSV_FORMAT.COMMA);
}

export function getMetricsColumns(fieldNames = []) {
    const columns = [
        'experiment',
        'model',
        'n',
        'format_valid_rate',
        'hamming_accuracy',
        'exact_match'
    ];
    if (fieldNames.length > 0) {
        columns.push('macro_f1');
    }
    columns.push(
        'mean_confidence_exact',
        'mean_confidence_hamming',
        'brier_exact',
        'calibration_mse',
        ...fieldNames.flatMap(name => [
            `precision_${name}`,
            `recall_${name}`,
            `f1_${name}`,
            `accuracy_${name}`
        ])
    );
    return columns;
}

function metricsRow(experiment, model, group, fieldNames) {
    const extra = Object.create(null);
    for (const row of perFieldClassification(group, fieldNames)) {
        extra[`precision_${row.name}`] = formatScore(row.precision);
        extra[`recall_${row.name}`] = formatScore(row.recall);
        extra[`f1_${row.name}`] = formatScore(row.f1);
        extra[`accuracy_${row.name}`] = formatScore(row.accuracy);
    }

    return {
        experiment: experiment || '',
        model,
        n: String(group.length),
        format_valid_rate: formatScore(meanBy(group, result => result.quantitative?.format_valid)),
        hamming_accuracy: formatScore(meanBy(group, result => result.quantitative?.hamming_accuracy)),
        exact_match: formatScore(meanBy(group, result => result.quantitative?.exact_match)),
        macro_f1: formatScore(macroF1FromResults(group, fieldNames)),
        mean_confidence_exact: formatScore(meanBy(group, result => result.quantitative?.confidence_exact)),
        mean_confidence_hamming: formatScore(meanBy(group, result => result.quantitative?.confidence_hamming)),
        brier_exact: formatScore(meanBy(group, result => result.quantitative?.brier_exact)),
        calibration_mse: formatScore(meanBy(group, result => result.quantitative?.calibration_mse)),
        ...extra
    };
}

export function writeMetricsCsv(results, fieldNames = []) {
    const experiment = results[0]?.task?.experiment || '';
    const columns = getMetricsColumns(fieldNames);
    const byModel = Object.create(null);
    for (const result of results) {
        const model = result.model || 'unknown';
        if (!byModel[model]) {
            byModel[model] = [];
        }
        byModel[model].push(result);
    }

    const rows = [
        metricsRow(experiment, 'all', results, fieldNames),
        ...Object.entries(byModel).map(([model, group]) =>
            metricsRow(experiment, model, group, fieldNames)
        )
    ];

    let csv = columns.join(CSV_FORMAT.COMMA) + CSV_FORMAT.NEW_LINE;
    for (const row of rows) {
        csv += columns.map(column => escapeCSV(row[column] ?? '')).join(CSV_FORMAT.COMMA) + CSV_FORMAT.NEW_LINE;
    }
    return csv;
}

export function escapeCSV(text) {
    if (typeof text === 'string') {
        if (text.includes(',') || text.includes('\n') || text.includes('"')) {
            return `"${text.replace(/"/g, '""')}"`;
        }
    }
    return text;
}

export function formatProcessingTime(milliseconds) {
    if (!milliseconds || milliseconds < 0) {
        return '';
    }

    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}
