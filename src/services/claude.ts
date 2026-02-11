import Anthropic from '@anthropic-ai/sdk';
import { quizBatchToolSchema, summaryToolSchema } from '../schemas/quiz';
import type { QuizBatch, QuizAnswer, ConversationState } from '../schemas/quiz';

function buildSystemPrompt(engagementContext: string, stakeholderName: string, stakeholderRole?: string): string {
  return `You are a professional discovery consultant conducting a stakeholder interview for a consulting engagement. Your goal is to understand this stakeholder's perspective on the project, their challenges, priorities, and expectations.

## Engagement Context
${engagementContext || 'No specific context provided. Conduct a general stakeholder discovery.'}

## Stakeholder
- Name: ${stakeholderName}
${stakeholderRole ? `- Role: ${stakeholderRole}` : ''}

## Instructions
- Generate 2-4 multiple-choice questions per batch
- Start with broad questions about their role and primary challenges, then narrow down based on answers
- Adapt your questions based on previous answers - drill deeper into areas of concern
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
    state.stakeholderRole
  );

  const messages: Anthropic.MessageParam[] = state.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // If this is the first batch, add a starter user message
  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content: 'Please begin the discovery session. Generate the first batch of questions.',
    });
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
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

  // Update conversation state with assistant's response (as text representation)
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
${state.stakeholderRole ? `- Role: ${state.stakeholderRole}` : ''}`;

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
    model: 'claude-sonnet-4-5-20250929',
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
