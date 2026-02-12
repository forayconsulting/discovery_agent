import Anthropic from '@anthropic-ai/sdk';
import { quizBatchToolSchema, summaryToolSchema, steeringSuggestionsToolSchema, engagementOverviewToolSchema, documentExtractionToolSchema } from '../schemas/quiz';
import type { QuizBatch, QuizAnswer, ConversationState } from '../schemas/quiz';

function buildSystemPrompt(engagementContext: string, stakeholderName: string, stakeholderRole?: string, steeringPrompt?: string): string {
  const focusSection = steeringPrompt
    ? `\n## Focus Areas\nThe interviewer has requested emphasis on: ${steeringPrompt}\nWeave these topics in naturally — do not force them if the stakeholder's answers lead elsewhere.\n`
    : '';

  return `You are a professional discovery consultant conducting a stakeholder interview. Your goal is to understand this stakeholder's genuine perspective — what they see, what matters to them, and how they experience their work.

## Engagement Context
${engagementContext || 'No specific context provided. Conduct a general stakeholder discovery.'}

## Stakeholder
- Name: ${stakeholderName}
${stakeholderRole ? `- Role: ${stakeholderRole}` : ''}
${focusSection}
## Instructions
- Generate 2-4 multiple-choice questions per batch
- Start with open-ended questions about the stakeholder's perspective, observations, and day-to-day experience before narrowing
- Follow the stakeholder's lead — drill deeper into whatever they indicate matters, whether positive or negative
- If the stakeholder indicates things are going well, explore what is working and why rather than steering toward problems
- Write neutral, non-leading option text that includes positive, neutral, and less-positive perspectives
- Use "single" type for mutually exclusive choices, "multi" type when multiple answers make sense
- Include "allowNoneOfTheAbove" when the options might not cover the stakeholder's situation
- After 4-6 batches (or when you have thorough coverage), set isComplete to true
- Keep questions clear, professional, and relevant to the engagement context
- Each question should have 3-5 options that cover the likely range of answers
- Include a progressHint to let the stakeholder know how far along they are`;
}

function formatAnswersAsMessage(answers: QuizAnswer[]): string {
  return answers
    .map((a) => {
      if (a.customText) {
        const selected = a.selectedLabels.length > 0
          ? `Selected ${a.selectedLabels.map((l) => `"${l}"`).join(' and ')}; also wrote: "${a.customText}"`
          : `Wrote custom answer: "${a.customText}"`;
        return `"${a.questionText}": ${selected}`;
      }
      if (a.noneOfTheAbove) {
        return `"${a.questionText}": Selected "None of the above"`;
      }
      return `"${a.questionText}": Selected ${a.selectedLabels.map((l) => `"${l}"`).join(' and ')}`;
    })
    .join('\n');
}

export async function generateNextBatch(
  apiKey: string,
  state: ConversationState
): Promise<QuizBatch> {
  const client = new Anthropic({ apiKey });

  const systemPrompt = buildSystemPrompt(
    state.engagementContext,
    state.stakeholderName,
    state.stakeholderRole,
    state.steeringPrompt
  );

  // Build a single user message with full Q&A context instead of replaying
  // multi-turn conversation history. This avoids tool_use/tool_result format
  // issues that cause rendering failures in later batches.
  let userMessage: string;
  if (state.allAnswers.length === 0) {
    userMessage = 'Please begin the discovery session. Generate the first batch of questions.';
  } else {
    const priorQA = state.allAnswers
      .map((a, i) => {
        if (a.customText) {
          const selected = a.selectedLabels.length > 0
            ? `Selected ${a.selectedLabels.map((l) => `"${l}"`).join(' and ')}; also wrote: "${a.customText}"`
            : `Wrote custom answer: "${a.customText}"`;
          return `${i + 1}. "${a.questionText}": ${selected}`;
        }
        if (a.noneOfTheAbove) {
          return `${i + 1}. "${a.questionText}": Selected "None of the above"`;
        }
        return `${i + 1}. "${a.questionText}": Selected ${a.selectedLabels.map((l) => `"${l}"`).join(' and ')}`;
      })
      .join('\n');

    userMessage = `Here are all the stakeholder's answers so far from ${state.currentBatchNumber - 1} batch(es):\n\n${priorQA}\n\nPlease generate batch ${state.currentBatchNumber} of discovery questions. Build on the answers above — drill deeper into themes the stakeholder has raised.`;
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    tools: [quizBatchToolSchema],
    tool_choice: { type: 'tool', name: 'generate_quiz_batch' },
  });

  // Extract tool use from response
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return a tool use response');
  }

  const batch = toolUse.input as QuizBatch;

  // Ensure questions is always an array (Claude sometimes omits it)
  if (!Array.isArray(batch.questions)) {
    batch.questions = [];
  }

  // Override batchNumber to match our tracked state (model may miscount)
  batch.batchNumber = state.currentBatchNumber;

  // Update conversation state for audit trail
  state.messages.push({
    role: 'user',
    content: userMessage,
  });
  state.messages.push({
    role: 'assistant',
    content: JSON.stringify(batch),
  });

  return batch;
}

export function appendAnswersToState(state: ConversationState, answers: QuizAnswer[]): void {
  const answerText = formatAnswersAsMessage(answers);
  state.messages.push({
    role: 'user',
    content: answerText,
  });
  state.allAnswers.push(...answers);
  state.currentBatchNumber++;
}

export async function generateSummary(
  apiKey: string,
  state: ConversationState
): Promise<{ summary: string; keyThemes: string[]; priorityLevel: string }> {
  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are a professional discovery consultant. Based on the complete Q&A session below, generate a thorough discovery summary.

## Engagement Context
${state.engagementContext || 'General stakeholder discovery.'}

## Stakeholder
- Name: ${state.stakeholderName}
${state.stakeholderRole ? `- Role: ${state.stakeholderRole}` : ''}

## Guiding Principle
Present the stakeholder's perspective faithfully — report what they expressed, including areas of satisfaction as well as concern. Do not editorialize or infer problems not indicated.`;

  // Build a comprehensive user message with all answers
  const allAnswersText = state.allAnswers
    .map((a, i) => {
      if (a.noneOfTheAbove) {
        return `${i + 1}. "${a.questionText}": None of the above`;
      }
      return `${i + 1}. "${a.questionText}": ${a.selectedLabels.join(', ')}`;
    })
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Here are all the stakeholder's answers from the discovery session:\n\n${allAnswersText}\n\nPlease generate a comprehensive discovery summary.`,
      },
    ],
    tools: [summaryToolSchema],
    tool_choice: { type: 'tool', name: 'generate_discovery_summary' },
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return a summary tool use response');
  }

  return toolUse.input as { summary: string; keyThemes: string[]; priorityLevel: string };
}

export async function generateSteeringSuggestions(
  apiKey: string,
  engagementContext: string,
  stakeholderName: string,
  stakeholderRole?: string
): Promise<Array<{ label: string; prompt: string }>> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: 'You are a professional discovery consultant. Suggest focus-area prompts that would help steer a stakeholder discovery session toward the most useful topics given the engagement context and stakeholder role.',
    messages: [
      {
        role: 'user',
        content: `Engagement context: ${engagementContext || 'General discovery'}\nStakeholder: ${stakeholderName}${stakeholderRole ? ` (${stakeholderRole})` : ''}\n\nSuggest 3-5 steering prompts.`,
      },
    ],
    tools: [steeringSuggestionsToolSchema],
    tool_choice: { type: 'tool', name: 'suggest_steering_prompts' },
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return steering suggestions');
  }

  return (toolUse.input as { suggestions: Array<{ label: string; prompt: string }> }).suggestions;
}

export async function generateEngagementOverview(
  apiKey: string,
  engagementContext: string,
  summaries: Array<{ stakeholderName: string; stakeholderRole?: string; summary: string }>
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const summaryText = summaries
    .map((s, i) => `### ${s.stakeholderName}${s.stakeholderRole ? ` (${s.stakeholderRole})` : ''}\n${s.summary}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: 'You are a professional discovery consultant. Synthesize multiple stakeholder discovery summaries into one engagement-level overview. Identify common themes, consensus points, and areas of divergence. Present findings faithfully without editorializing.',
    messages: [
      {
        role: 'user',
        content: `Engagement context: ${engagementContext || 'General discovery'}\n\nIndividual stakeholder summaries:\n\n${summaryText}\n\nPlease synthesize these into an engagement-level overview.`,
      },
    ],
    tools: [engagementOverviewToolSchema],
    tool_choice: { type: 'tool', name: 'generate_engagement_overview' },
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return an engagement overview');
  }

  return (toolUse.input as { overview: string }).overview;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}

export async function extractContextFromDocuments(
  apiKey: string,
  documents: Array<{ filename: string; contentType: string; data: ArrayBuffer }>
): Promise<{ description: string; context: string; documentSummaries: Array<{ filename: string; summary: string }> }> {
  const client = new Anthropic({ apiKey });

  const contentBlocks: Anthropic.MessageParam['content'] = [];

  for (const doc of documents) {
    if (doc.contentType === 'application/pdf') {
      contentBlocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: arrayBufferToBase64(doc.data),
        },
      } as any);
    } else {
      contentBlocks.push({
        type: 'text',
        text: `Document: ${doc.filename}\n\n${new TextDecoder().decode(doc.data)}`,
      });
    }
  }

  contentBlocks.push({
    type: 'text',
    text: 'Please extract the engagement description and detailed project context from these documents. Include goals, scope, stakeholders, timelines, known challenges, and any other relevant background.',
  });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: contentBlocks,
      },
    ],
    tools: [documentExtractionToolSchema],
    tool_choice: { type: 'tool', name: 'extract_engagement_context' },
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return a document extraction tool use response');
  }

  return toolUse.input as { description: string; context: string; documentSummaries: Array<{ filename: string; summary: string }> };
}
