/**
 * Validation Utilities
 * Input validation and sanitization for MCP tool arguments
 */

import {
  SaveContextArgs,
  GetContextArgs,
  CreateSessionArgs,
  CreateCheckpointArgs,
  RestoreCheckpointArgs,
  ValidationError,
  ItemCategory,
  ItemPriority,
} from '../types/index.js';

const VALID_CATEGORIES: ItemCategory[] = ['task', 'decision', 'progress', 'note'];
const VALID_PRIORITIES: ItemPriority[] = ['high', 'normal', 'low'];

/**
 * Validate session creation arguments
 */
export function validateCreateSession(args: any): CreateSessionArgs {
  if (!args || typeof args !== 'object') {
    throw new ValidationError('Invalid arguments: must be an object');
  }

  const { name, description, branch, channel } = args;

  // Name is required
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('name is required and must be a non-empty string');
  }

  if (name.length > 200) {
    throw new ValidationError('name must be 200 characters or less');
  }

  // Description is optional
  if (description !== undefined && typeof description !== 'string') {
    throw new ValidationError('description must be a string');
  }

  if (description && description.length > 1000) {
    throw new ValidationError('description must be 1000 characters or less');
  }

  // Branch is optional
  if (branch !== undefined && typeof branch !== 'string') {
    throw new ValidationError('branch must be a string');
  }

  // Channel is optional
  if (channel !== undefined && typeof channel !== 'string') {
    throw new ValidationError('channel must be a string');
  }

  if (channel && channel.length > 20) {
    throw new ValidationError('channel must be 20 characters or less');
  }

  return {
    name: name.trim(),
    description: description?.trim(),
    branch: branch?.trim(),
    channel: channel?.trim(),
  };
}

/**
 * Validate save context arguments
 */
export function validateSaveContext(args: any): SaveContextArgs {
  if (!args || typeof args !== 'object') {
    throw new ValidationError('Invalid arguments: must be an object');
  }

  const { key, value, category, priority, channel } = args;

  // Key is required
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    throw new ValidationError('key is required and must be a non-empty string');
  }

  if (key.length > 200) {
    throw new ValidationError('key must be 200 characters or less');
  }

  // Value is required
  if (value === undefined || value === null) {
    throw new ValidationError('value is required');
  }

  if (typeof value !== 'string') {
    throw new ValidationError('value must be a string');
  }

  if (value.length > 100000) {
    // 100KB limit for single item
    throw new ValidationError('value must be 100,000 characters or less');
  }

  // Category is optional but must be valid
  if (category !== undefined) {
    if (typeof category !== 'string') {
      throw new ValidationError('category must be a string');
    }
    if (!VALID_CATEGORIES.includes(category as ItemCategory)) {
      throw new ValidationError(
        `category must be one of: ${VALID_CATEGORIES.join(', ')}`
      );
    }
  }

  // Priority is optional but must be valid
  if (priority !== undefined) {
    if (typeof priority !== 'string') {
      throw new ValidationError('priority must be a string');
    }
    if (!VALID_PRIORITIES.includes(priority as ItemPriority)) {
      throw new ValidationError(
        `priority must be one of: ${VALID_PRIORITIES.join(', ')}`
      );
    }
  }

  // Channel is optional
  if (channel !== undefined && typeof channel !== 'string') {
    throw new ValidationError('channel must be a string');
  }

  if (channel && channel.length > 20) {
    throw new ValidationError('channel must be 20 characters or less');
  }

  return {
    key: key.trim(),
    value,
    category: category as ItemCategory | undefined,
    priority: priority as ItemPriority | undefined,
    channel: channel?.trim(),
  };
}

/**
 * Validate get context arguments
 */
export function validateGetContext(args: any): GetContextArgs {
  if (!args || typeof args !== 'object') {
    return {}; // Empty args is valid - returns all items
  }

  const { key, category, priority, channel, limit, offset } = args;

  // All fields are optional
  if (key !== undefined && typeof key !== 'string') {
    throw new ValidationError('key must be a string');
  }

  if (category !== undefined) {
    if (typeof category !== 'string') {
      throw new ValidationError('category must be a string');
    }
    if (!VALID_CATEGORIES.includes(category as ItemCategory)) {
      throw new ValidationError(
        `category must be one of: ${VALID_CATEGORIES.join(', ')}`
      );
    }
  }

  if (priority !== undefined) {
    if (typeof priority !== 'string') {
      throw new ValidationError('priority must be a string');
    }
    if (!VALID_PRIORITIES.includes(priority as ItemPriority)) {
      throw new ValidationError(
        `priority must be one of: ${VALID_PRIORITIES.join(', ')}`
      );
    }
  }

  if (channel !== undefined && typeof channel !== 'string') {
    throw new ValidationError('channel must be a string');
  }

  if (limit !== undefined) {
    if (typeof limit !== 'number' || limit < 1 || limit > 1000) {
      throw new ValidationError('limit must be a number between 1 and 1000');
    }
  }

  if (offset !== undefined) {
    if (typeof offset !== 'number' || offset < 0) {
      throw new ValidationError('offset must be a non-negative number');
    }
  }

  return {
    key: key?.trim(),
    category: category as ItemCategory | undefined,
    priority: priority as ItemPriority | undefined,
    channel: channel?.trim(),
    limit,
    offset,
  };
}

/**
 * Validate checkpoint creation arguments
 */
export function validateCreateCheckpoint(args: any): CreateCheckpointArgs {
  if (!args || typeof args !== 'object') {
    throw new ValidationError('Invalid arguments: must be an object');
  }

  const { name, description, include_git } = args;

  // Name is required
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('name is required and must be a non-empty string');
  }

  if (name.length > 200) {
    throw new ValidationError('name must be 200 characters or less');
  }

  // Description is optional
  if (description !== undefined && typeof description !== 'string') {
    throw new ValidationError('description must be a string');
  }

  if (description && description.length > 1000) {
    throw new ValidationError('description must be 1000 characters or less');
  }

  // include_git is optional boolean
  if (include_git !== undefined && typeof include_git !== 'boolean') {
    throw new ValidationError('include_git must be a boolean');
  }

  return {
    name: name.trim(),
    description: description?.trim(),
    include_git,
  };
}

/**
 * Validate checkpoint restoration arguments
 */
export function validateRestoreCheckpoint(args: any): RestoreCheckpointArgs {
  if (!args || typeof args !== 'object') {
    throw new ValidationError('Invalid arguments: must be an object');
  }

  const { checkpoint_id } = args;

  if (!checkpoint_id || typeof checkpoint_id !== 'string') {
    throw new ValidationError('checkpoint_id is required and must be a string');
  }

  return {
    checkpoint_id: checkpoint_id.trim(),
  };
}

/**
 * Sanitize string input (prevent injection attacks)
 */
export function sanitizeString(input: string): string {
  return input.replace(/[<>]/g, ''); // Remove < and > to prevent HTML injection
}

/**
 * Validate session ID format
 */
export function isValidSessionId(sessionId: string): boolean {
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }
  // Basic format check - can be tightened if needed
  return sessionId.length > 0 && sessionId.length < 100;
}
