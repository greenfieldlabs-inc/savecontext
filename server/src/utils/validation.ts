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
  TagContextItemsArgs,
  CheckpointItemManagementArgs,
  CheckpointSplitArgs,
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

  const { name, description, branch, channel, force_new } = args;

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
    force_new: force_new === true,
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

  const { name, description, include_git, include_tags, include_keys, include_categories, exclude_tags } = args;

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

  // Validate filter arrays
  if (include_tags !== undefined && !Array.isArray(include_tags)) {
    throw new ValidationError('include_tags must be an array');
  }

  if (include_keys !== undefined && !Array.isArray(include_keys)) {
    throw new ValidationError('include_keys must be an array');
  }

  if (include_categories !== undefined) {
    if (!Array.isArray(include_categories)) {
      throw new ValidationError('include_categories must be an array');
    }
    for (const cat of include_categories) {
      if (!VALID_CATEGORIES.includes(cat as ItemCategory)) {
        throw new ValidationError(`include_categories contains invalid category: ${cat}`);
      }
    }
  }

  if (exclude_tags !== undefined && !Array.isArray(exclude_tags)) {
    throw new ValidationError('exclude_tags must be an array');
  }

  return {
    name: name.trim(),
    description: description?.trim(),
    include_git,
    include_tags,
    include_keys,
    include_categories: include_categories as ItemCategory[] | undefined,
    exclude_tags,
  };
}

/**
 * Validate checkpoint restoration arguments
 */
export function validateRestoreCheckpoint(args: any): RestoreCheckpointArgs {
  if (!args || typeof args !== 'object') {
    throw new ValidationError('Invalid arguments: must be an object');
  }

  const { checkpoint_id, checkpoint_name, restore_tags, restore_categories } = args;

  if (!checkpoint_id || typeof checkpoint_id !== 'string') {
    throw new ValidationError('checkpoint_id is required and must be a string');
  }

  if (!checkpoint_name || typeof checkpoint_name !== 'string') {
    throw new ValidationError('checkpoint_name is required and must be a string');
  }

  // Validate filter arrays
  if (restore_tags !== undefined && !Array.isArray(restore_tags)) {
    throw new ValidationError('restore_tags must be an array');
  }

  if (restore_categories !== undefined) {
    if (!Array.isArray(restore_categories)) {
      throw new ValidationError('restore_categories must be an array');
    }
    for (const cat of restore_categories) {
      if (!VALID_CATEGORIES.includes(cat as ItemCategory)) {
        throw new ValidationError(`restore_categories contains invalid category: ${cat}`);
      }
    }
  }

  return {
    checkpoint_id: checkpoint_id.trim(),
    checkpoint_name: checkpoint_name.trim(),
    restore_tags,
    restore_categories: restore_categories as ItemCategory[] | undefined,
  };
}

/**
 * Validate tag context items arguments
 */
export function validateTagContextItems(args: any): TagContextItemsArgs {
  if (!args || typeof args !== 'object') {
    throw new ValidationError('Invalid arguments: must be an object');
  }

  const { keys, key_pattern, tags, action } = args;

  // Must have either keys or key_pattern
  if (!keys && !key_pattern) {
    throw new ValidationError('Either keys or key_pattern is required');
  }

  if (keys !== undefined && !Array.isArray(keys)) {
    throw new ValidationError('keys must be an array');
  }

  if (key_pattern !== undefined && typeof key_pattern !== 'string') {
    throw new ValidationError('key_pattern must be a string');
  }

  // tags is required
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    throw new ValidationError('tags is required and must be a non-empty array');
  }

  // action is required
  if (!action || (action !== 'add' && action !== 'remove')) {
    throw new ValidationError('action is required and must be "add" or "remove"');
  }

  return {
    keys,
    key_pattern: key_pattern?.trim(),
    tags,
    action,
  };
}

/**
 * Validate checkpoint item management arguments
 */
export function validateCheckpointItemManagement(args: any): CheckpointItemManagementArgs {
  if (!args || typeof args !== 'object') {
    throw new ValidationError('Invalid arguments: must be an object');
  }

  const { checkpoint_id, checkpoint_name, item_keys } = args;

  if (!checkpoint_id || typeof checkpoint_id !== 'string') {
    throw new ValidationError('checkpoint_id is required and must be a string');
  }

  if (!checkpoint_name || typeof checkpoint_name !== 'string') {
    throw new ValidationError('checkpoint_name is required and must be a string');
  }

  if (!item_keys || !Array.isArray(item_keys) || item_keys.length === 0) {
    throw new ValidationError('item_keys is required and must be a non-empty array');
  }

  return {
    checkpoint_id: checkpoint_id.trim(),
    checkpoint_name: checkpoint_name.trim(),
    item_keys,
  };
}

/**
 * Validate checkpoint split arguments
 */
export function validateCheckpointSplit(args: any): CheckpointSplitArgs {
  if (!args || typeof args !== 'object') {
    throw new ValidationError('Invalid arguments: must be an object');
  }

  const { source_checkpoint_id, source_checkpoint_name, splits } = args;

  if (!source_checkpoint_id || typeof source_checkpoint_id !== 'string') {
    throw new ValidationError('source_checkpoint_id is required and must be a string');
  }

  if (!source_checkpoint_name || typeof source_checkpoint_name !== 'string') {
    throw new ValidationError('source_checkpoint_name is required and must be a string');
  }

  if (!splits || !Array.isArray(splits) || splits.length === 0) {
    throw new ValidationError('splits is required and must be a non-empty array');
  }

  // Validate each split
  for (const split of splits) {
    if (!split.name || typeof split.name !== 'string') {
      throw new ValidationError('Each split must have a name (string)');
    }

    if (split.description !== undefined && typeof split.description !== 'string') {
      throw new ValidationError('Split description must be a string');
    }

    if (split.include_tags !== undefined && !Array.isArray(split.include_tags)) {
      throw new ValidationError('Split include_tags must be an array');
    }

    if (split.include_categories !== undefined) {
      if (!Array.isArray(split.include_categories)) {
        throw new ValidationError('Split include_categories must be an array');
      }
      for (const cat of split.include_categories) {
        if (!VALID_CATEGORIES.includes(cat as ItemCategory)) {
          throw new ValidationError(`Split include_categories contains invalid category: ${cat}`);
        }
      }
    }
  }

  return {
    source_checkpoint_id: source_checkpoint_id.trim(),
    source_checkpoint_name: source_checkpoint_name.trim(),
    splits,
  };
}

export function validateDeleteCheckpoint(args: any): { checkpoint_id: string } {
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
 * Validate that a checkpoint exists and its name matches the expected name.
 * Returns the checkpoint with narrowed type (non-null).
 * Use this after fetching a checkpoint from the database.
 */
export function validateCheckpointName<T extends { name: string }>(
  checkpoint: T | null | undefined,
  checkpointId: string,
  expectedName: string
): T {
  if (!checkpoint) {
    throw new ValidationError(`Checkpoint '${checkpointId}' not found`);
  }
  if (checkpoint.name !== expectedName) {
    throw new ValidationError(
      `Checkpoint name mismatch: expected '${checkpoint.name}' but got '${expectedName}'`
    );
  }
  return checkpoint;
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
