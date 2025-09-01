/**
 * Slack webhook integration for sending test results with modern formatting
 */

import axios from 'axios';

/**
 * @typedef {Object} SlackWebhookPayload
 * @property {Array<{
 *   type: string;
 *   text?: {
 *     type: string;
 *     text: string;
 *   };
 *   fields?: Array<{
 *     type: string;
 *     text: string;
 *   }>;
 *   elements?: Array<{
 *     type: string;
 *     text: string;
 *   }>;
 *   accessory?: {
 *     type: string;
 *     image_url: string;
 *     alt_text: string;
 *   };
 * }>} blocks - Message blocks for Slack API
 */

// Slack has a 40,000 character limit - use much safer limits
const MAX_PAYLOAD_SIZE = 35 * 1024; // 35KB total (safe margin from 40K limit)
const MAX_CSV_PREVIEW_SIZE = 3 * 1024; // Reserve only 3KB for CSV preview

// Using direct console.warn instead of custom function


/**
 * Creates a CSV preview that fits within Slack's payload limits
 * @param {string} csvContent - The full CSV content
 * @returns {string} - Formatted code block with truncated CSV if necessary
 */
function createCsvPreview(csvContent) {
  const header = '```\n'; // code block start
  const footer = '\n```'; // code block end
  const truncationNote = '\n... [truncated]';
  const maxCsvLength = MAX_CSV_PREVIEW_SIZE - Buffer.byteLength(header + footer + truncationNote, 'utf8');
  
  const lines = csvContent.split('\n');
  let truncated = '';
  let totalBytes = 0;

  // Always include header line if it exists
  if (lines.length > 0) {
    const headerLine = lines[0] + '\n';
    const headerBytes = Buffer.byteLength(headerLine, 'utf8');
    if (headerBytes <= maxCsvLength) {
      truncated += headerLine;
      totalBytes += headerBytes;
    }
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue; // Skip empty lines
    
    const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
    if (totalBytes + lineBytes > maxCsvLength) break;
    truncated += line + '\n';
    totalBytes += lineBytes;
  }

  if (lines.length > 1 && truncated.split('\n').length - 1 < lines.length) {
    truncated = truncated.trimEnd() + truncationNote;
  }

  return header + truncated + footer;
}

/**
 * Send error information to a Slack webhook
 * @param {Record<string, unknown>} context - Context information
 * @param {unknown} error - Error object or message
 * @returns {Promise<void>}
 */
export async function sendErrorToSlack(context = {}, error) {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!slackWebhookUrl) {
    console.warn("Slack webhook URL not configured");
    return;
  }

  const errorMessage = error
    ? error instanceof Error ? error.message : String(error)
    : "No error provided";

  const errorDetails = error instanceof Error
    ? error
    : { message: errorMessage };
  const timestamp = new Date().toISOString();

  /** @type {SlackWebhookPayload} */
  const payload = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `❌ Test run failed at ${new Date().toLocaleString()} - ${errorMessage}`,
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Error:* ${errorMessage}`
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Status:*\n\`${context.status || "failed"}\``
          },
          {
            type: "mrkdwn",
            text: `*Task:*\n\`${context.task_type || "test_execution"}\``
          },
          {
            type: "mrkdwn",
            text: `*Models:*\n\`${context.models || "N/A"}\``
          },
          {
            type: "mrkdwn",
            text: `*Error Type:*\n\`${context.error_type || "unknown"}\``
          },
          {
            type: "mrkdwn",
            text: `*Time:*\n\`${new Date().toLocaleString()}\``
          }
        ]
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Error Details:*"
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "```\n" + JSON.stringify(
            {
              error: errorDetails,
              timestamp,
            },
            null,
            2,
          ) + "\n```"
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "🔍 Check logs for more details"
          }
        ]
      }
    ]
  };

  try {
    const response = await axios.post(slackWebhookUrl, payload, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.status >= 200 && response.status < 300) {
      console.log("Error notification sent to Slack successfully");
    } else {
      console.error("Failed to send error to Slack", {
        status: response.status,
        statusText: response.statusText,
      });
    }
  } catch (err) {
    console.error("Error sending to Slack", { error: err });
  }
}

/**
 * Send test results summary to Slack
 * @param {Object} summary - Test execution summary
 * @param {number} summary.totalTests - Total number of tests
 * @param {number} summary.successful - Number of successful tests
 * @param {number} summary.failed - Number of failed tests
 * @param {Object} summary.averageScores - Average scores
 * @param {number} [summary.averageScores.hamming_accuracy] - Mean Hamming accuracy
 * @param {number} [summary.averageScores.exact_match] - Exact match rate
 * @param {number} [summary.averageScores.macro_f1] - Label-macro F1
 * @param {number} [summary.averageScores.format_valid] - Format validity rate
 * @param {string} csvContent - CSV content to include in the message
 * @returns {Promise<void>}
 */
export async function sendTestResultsToSlack(summary, csvContent) {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!slackWebhookUrl) {
    console.warn("Slack webhook URL not configured");
    return;
  }

  const successPercentage = Math.round((summary.successful / summary.totalTests) * 100);
  const failedPercentage = Math.round((summary.failed / summary.totalTests) * 100);
  const testStatus = summary.failed === 0 ? "success" : "warning";
  const statusEmoji = summary.failed === 0 ? "✅" : "⚠️";
  const statusColor = summary.failed === 0 ? "#2EB67D" : "#ECB22E";
  
  // Format scores with color indicators based on score value
  const getScoreEmoji = (score) => {
    if (score >= 0.8) return "🟢";
    if (score >= 0.6) return "🟡";
    return "🔴";
  };

  const scoreField = (label, score) => {
    if (typeof score !== 'number' || Number.isNaN(score)) {
      return `*${label}:*\nN/A`;
    }
    return `${getScoreEmoji(score)} *${label}:*\n${score.toFixed(4)}`;
  };

  /** @type {SlackWebhookPayload} */
  const payload = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `📊 Test run completed at ${new Date().toLocaleString()}`,
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${statusEmoji} *Test run completed with ${statusEmoji === "✅" ? "all tests passing" : "some failures"}*`
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Total Tests:*\n${summary.totalTests}`
          },
          {
            type: "mrkdwn",
            text: `*Time:*\n${new Date().toLocaleString()}`
          },
          {
            type: "mrkdwn",
            text: `*Successful:*\n${summary.successful} (${successPercentage}%)`
          },
          {
            type: "mrkdwn",
            text: `*Failed:*\n${summary.failed} (${failedPercentage}%)`
          }
        ]
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Average Scores:*"
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: scoreField('Hamming', summary.averageScores.hamming_accuracy)
          },
          {
            type: "mrkdwn",
            text: scoreField('Exact match', summary.averageScores.exact_match)
          },
          {
            type: "mrkdwn",
            text: scoreField('Macro-F1', summary.averageScores.macro_f1)
          },
          {
            type: "mrkdwn",
            text: scoreField('Format valid', summary.averageScores.format_valid)
          }
        ]
      }
    ]
  };
  
  if (csvContent) {
    payload.blocks.push(
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Metrics CSV:*"
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: createCsvPreview(csvContent)
        }
      }
    );
  }
  
  // Add context footer
  payload.blocks.push(
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `📋 Full results available in the results directory`
        }
      ]
    }
  );

  try {
    const response = await axios.post(slackWebhookUrl, payload, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.status >= 200 && response.status < 300) {
      console.log("Test results sent to Slack successfully");
    } else {
      console.error("Failed to send test results to Slack", {
        status: response.status,
        statusText: response.statusText,
      });
    }
  } catch (err) {
    console.error("Error sending test results to Slack", { error: err });
  }
}

