function assistantJson(assistant) {
  if (typeof assistant === 'string') {
    return assistant;
  }
  return JSON.stringify(assistant);
}

function textParts(system, user, assistant) {
  return {
    system,
    user,
    assistant: assistantJson(assistant)
  };
}

export function formatTextRow({ id, system, user, assistant }) {
  const parts = textParts(system, user, assistant);
  return {
    id,
    messages: [
      { role: 'system', content: parts.system },
      { role: 'user', content: parts.user },
      { role: 'assistant', content: parts.assistant }
    ]
  };
}

export function formatUnslothRow({ id, system, user, assistant, imagePaths = [] }) {
  const parts = textParts(system, user, assistant);
  const userContent = [{ type: 'text', text: parts.user }];
  for (const image of imagePaths) {
    userContent.push({ type: 'image', image });
  }
  return {
    id,
    messages: [
      { role: 'system', content: [{ type: 'text', text: parts.system }] },
      { role: 'user', content: userContent },
      { role: 'assistant', content: [{ type: 'text', text: parts.assistant }] }
    ]
  };
}

export function formatQwenVlRow({ id, system, user, assistant, imagePaths = [] }) {
  const parts = textParts(system, user, assistant);
  const tags = imagePaths.map(() => '<image>').join('\n');
  const humanPrefix = tags ? `${tags}\n` : '';
  const humanValue = `${humanPrefix}${parts.system}\n${parts.user}`.trim();
  const row = {
    id,
    conversations: [
      { from: 'human', value: humanValue },
      { from: 'gpt', value: parts.assistant }
    ]
  };
  if (imagePaths.length === 1) {
    row.image = imagePaths[0];
  } else if (imagePaths.length > 1) {
    row.images = [...imagePaths];
  }
  return row;
}

export function formatLlamaRow({ id, system, user, assistant, imagePaths = [] }) {
  const parts = textParts(system, user, assistant);
  const userContent = [
    ...imagePaths.map(() => ({ type: 'image' })),
    { type: 'text', text: parts.user }
  ];
  const row = {
    id,
    messages: [
      { role: 'system', content: parts.system },
      { role: 'user', content: userContent },
      { role: 'assistant', content: parts.assistant }
    ]
  };
  if (imagePaths.length > 0) {
    row.images = [...imagePaths];
  }
  return row;
}

export const FORMATTERS = {
  text: formatTextRow,
  unsloth: formatUnslothRow,
  'qwen-vl': formatQwenVlRow,
  llama: formatLlamaRow
};
