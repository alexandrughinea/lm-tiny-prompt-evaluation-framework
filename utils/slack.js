/**
 * Slack webhook integration for sending test results with modern formatting
 */

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

// Maximum Slack message payload size (30KB)
const MAX_PAYLOAD_SIZE = 30 * 1024;

// Using direct console.warn instead of custom function


/**
 * Creates a CSV preview that fits within Slack's payload limits
 * @param {string} csvContent - The full CSV content
 * @returns {string} - Formatted code block with truncated CSV if necessary
 */
function createCsvPreview(csvContent) {
  const header = '```\n'; // code block start
  const footer = '\n```'; // code block end
  const maxCsvLength = MAX_PAYLOAD_SIZE - Buffer.byteLength(header + footer, 'utf8');
  let preview = csvContent;
  const buffer = Buffer.from(preview, 'utf8');

  if (buffer.length > maxCsvLength) {
    // Truncate without cutting a line in half
    const lines = csvContent.split('\n');
    let truncated = '';
    let totalBytes = 0;

    for (const line of lines) {
      const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
      if (totalBytes + lineBytes > maxCsvLength) break;
      truncated += line + '\n';
      totalBytes += lineBytes;
    }

    preview = truncated.trimEnd() + '\n... [truncated]';
  }

  return header + preview + footer;
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
    const response = await fetch(slackWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("Failed to send error to Slack", {
        status: response.status,
        statusText: response.statusText,
      });
    } else {
      console.log("Error notification sent to Slack successfully");
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
 * @param {number} summary.averageScores.overall - Overall average score
 * @param {number} summary.averageScores.accuracy - Average accuracy score
 * @param {number} summary.averageScores.completeness - Average completeness score
 * @param {number} summary.averageScores.relevance - Average relevance score
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
            text: `${getScoreEmoji(summary.averageScores.overall)} *Overall:*\n${summary.averageScores.overall.toFixed(4)}`
          },
          {
            type: "mrkdwn",
            text: `${getScoreEmoji(summary.averageScores.accuracy)} *Accuracy:*\n${summary.averageScores.accuracy.toFixed(4)}`
          },
          {
            type: "mrkdwn",
            text: `${getScoreEmoji(summary.averageScores.completeness)} *Completeness:*\n${summary.averageScores.completeness.toFixed(4)}`
          },
          {
            type: "mrkdwn",
            text: `${getScoreEmoji(summary.averageScores.relevance)} *Relevance:*\n${summary.averageScores.relevance.toFixed(4)}`
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
          text: "*CSV Results Preview:*"
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
    const response = await fetch(slackWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("Failed to send test results to Slack", {
        status: response.status,
        statusText: response.statusText,
      });
    } else {
      console.log("Test results sent to Slack successfully");
    }
  } catch (err) {
    console.error("Error sending test results to Slack", { error: err });
  }
}


