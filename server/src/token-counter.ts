/**
 * Token Counter Module - Accurate Token Counting
 *
 * Uses tiktoken (OpenAI's token counter) for precise token calculation.
 * Supports Claude's encoding (cl100k_base) and caching.
 */

import { encoding_for_model, get_encoding, Tiktoken } from 'tiktoken';

// Cache encoders to avoid re-initialization
let cl100kEncoder: Tiktoken | null = null;

/**
 * Initialize and cache the encoder
 */
function getEncoder(): Tiktoken {
  if (!cl100kEncoder) {
    // cl100k_base is used by Claude, GPT-4, and GPT-3.5-turbo
    cl100kEncoder = get_encoding('cl100k_base');
  }
  return cl100kEncoder;
}

/**
 * Count tokens in a string
 */
export function countTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  try {
    const encoder = getEncoder();
    const tokens = encoder.encode(text);
    return tokens.length;
  } catch (error) {
    // Fallback to approximation if tiktoken fails
    console.error('Token counting failed, using approximation:', error);
    return Math.ceil(text.length / 4);
  }
}

/**
 * Count tokens in an array of messages (chat format)
 */
export function countMessageTokens(messages: Array<{ role: string; content: string }>): number {
  let totalTokens = 0;

  for (const message of messages) {
    // Count role tokens
    totalTokens += countTokens(message.role);

    // Count content tokens
    totalTokens += countTokens(message.content);

    // Add overhead per message (Claude/OpenAI format overhead)
    totalTokens += 4; // <|im_start|>role\ncontent<|im_end|>\n
  }

  // Add conversation overhead
  totalTokens += 2; // <|im_start|>assistant

  return totalTokens;
}

/**
 * Count tokens in a structured context object
 */
export function countContextTokens(context: any): number {
  if (typeof context === 'string') {
    return countTokens(context);
  }

  // Convert object to JSON string for counting
  const jsonString = JSON.stringify(context);
  return countTokens(jsonString);
}

/**
 * Estimate cost based on token count
 * Using Claude Sonnet pricing as reference
 */
export function estimateCost(tokens: number, model: 'claude-sonnet' | 'claude-opus' | 'gpt-4' = 'claude-sonnet'): number {
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-sonnet': { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
    'claude-opus': { input: 15.00 / 1_000_000, output: 75.00 / 1_000_000 },
    'gpt-4': { input: 30.00 / 1_000_000, output: 60.00 / 1_000_000 },
  };

  const modelPricing = pricing[model];
  // Assume 50/50 split between input and output tokens
  const avgPrice = (modelPricing.input + modelPricing.output) / 2;
  return tokens * avgPrice;
}

/**
 * Check if context fits within token limit
 */
export function fitsWithinLimit(context: any, limit: number): boolean {
  const tokens = countContextTokens(context);
  return tokens <= limit;
}

/**
 * Get token budget remaining
 */
export function getRemainingBudget(usedTokens: number, dailyLimit: number = 1_000_000): {
  remaining: number;
  percentage: number;
  exceeded: boolean;
} {
  const remaining = Math.max(0, dailyLimit - usedTokens);
  const percentage = (remaining / dailyLimit) * 100;
  const exceeded = usedTokens > dailyLimit;

  return {
    remaining,
    percentage: Math.round(percentage * 100) / 100,
    exceeded,
  };
}

/**
 * Format token count for display
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) {
    return `${tokens} tokens`;
  } else if (tokens < 1_000_000) {
    return `${(tokens / 1_000).toFixed(1)}K tokens`;
  } else {
    return `${(tokens / 1_000_000).toFixed(2)}M tokens`;
  }
}

/**
 * Clean up encoder when done (call on shutdown)
 */
export function cleanup(): void {
  if (cl100kEncoder) {
    cl100kEncoder.free();
    cl100kEncoder = null;
  }
}
