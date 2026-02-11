// TypeScript interfaces for quiz data structures

export interface QuizOption {
  id: string;
  label: string;
}

export interface QuizQuestion {
  id: string;
  text: string;
  description?: string;
  type: 'single' | 'multi';
  options: QuizOption[];
  allowNoneOfTheAbove: boolean;
}

export interface QuizBatch {
  questions: QuizQuestion[];
  isComplete: boolean;
  progressHint?: string;
  batchNumber: number;
}

export interface QuizAnswer {
  questionId: string;
  questionText: string;
  selectedOptionIds: string[];
  selectedLabels: string[];
  noneOfTheAbove?: boolean;
  customText?: string;
}

export interface ConversationState {
  sessionId: string;
  engagementContext: string;
  stakeholderName: string;
  stakeholderRole?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  allAnswers: QuizAnswer[];
  currentBatchNumber: number;
}

// JSON Schema for Claude's tool definition
export const quizBatchToolSchema = {
  name: 'generate_quiz_batch',
  description:
    'Generate the next batch of discovery questions for the stakeholder. Return 2-4 multiple-choice questions that help understand the stakeholder\'s needs, challenges, and priorities. Set isComplete to true when you have gathered enough information for a thorough discovery summary.',
  input_schema: {
    type: 'object' as const,
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier for this question (e.g., "q1_1", "q2_3")',
            },
            text: {
              type: 'string',
              description: 'The question text',
            },
            description: {
              type: 'string',
              description: 'Optional clarifying context for the question',
            },
            type: {
              type: 'string',
              enum: ['single', 'multi'],
              description: 'single = radio buttons (pick one), multi = checkboxes (pick multiple)',
            },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                },
                required: ['id', 'label'],
              },
              minItems: 2,
              maxItems: 6,
            },
            allowNoneOfTheAbove: {
              type: 'boolean',
              description: 'Whether to show a "None of the above" option',
            },
          },
          required: ['id', 'text', 'type', 'options', 'allowNoneOfTheAbove'],
        },
        minItems: 2,
        maxItems: 4,
      },
      isComplete: {
        type: 'boolean',
        description:
          'Set to true when you have gathered enough information (typically after 4-6 batches). When true, questions array can be empty.',
      },
      progressHint: {
        type: 'string',
        description: 'A brief hint about progress, e.g., "About halfway through" or "Just a few more questions"',
      },
      batchNumber: {
        type: 'number',
        description: 'The current batch number (1-indexed)',
      },
    },
    required: ['questions', 'isComplete', 'batchNumber'],
  },
};

export const summaryToolSchema = {
  name: 'generate_discovery_summary',
  description:
    'Generate a structured discovery summary based on all the answers collected during the session.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string',
        description:
          'A comprehensive discovery summary organized by themes. Include key findings, priorities, challenges, and recommendations.',
      },
      keyThemes: {
        type: 'array',
        items: { type: 'string' },
        description: 'The top 3-5 key themes identified from the discovery',
      },
      priorityLevel: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: 'Overall urgency/priority level based on stakeholder responses',
      },
    },
    required: ['summary', 'keyThemes', 'priorityLevel'],
  },
};
