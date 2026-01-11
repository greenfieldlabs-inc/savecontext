/**
 * Time utilities for SaveContext MCP Server
 */

// Time constants (milliseconds)
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Relative time filter input (from MCP tool args)
 */
export interface RelativeTimeFilter {
  createdInLastDays?: number;
  createdInLastHours?: number;
  updatedInLastDays?: number;
  updatedInLastHours?: number;
}

/**
 * Absolute timestamp filter output (for database queries)
 */
export interface AbsoluteTimeFilter {
  createdAfter?: number;
  updatedAfter?: number;
}

/**
 * Convert relative time filters to absolute timestamps.
 * Hours take precedence over days for the same field.
 *
 * @param filter - Relative time filter with days/hours
 * @param now - Current timestamp (defaults to Date.now(), injectable for testing)
 * @returns Absolute timestamps for database queries
 */
export function relativeToAbsoluteTime(
  filter: RelativeTimeFilter,
  now: number = Date.now()
): AbsoluteTimeFilter {
  const result: AbsoluteTimeFilter = {};

  // Hours take precedence over days
  if (filter.createdInLastHours !== undefined) {
    result.createdAfter = now - (filter.createdInLastHours * MS_PER_HOUR);
  } else if (filter.createdInLastDays !== undefined) {
    result.createdAfter = now - (filter.createdInLastDays * MS_PER_DAY);
  }

  if (filter.updatedInLastHours !== undefined) {
    result.updatedAfter = now - (filter.updatedInLastHours * MS_PER_HOUR);
  } else if (filter.updatedInLastDays !== undefined) {
    result.updatedAfter = now - (filter.updatedInLastDays * MS_PER_DAY);
  }

  return result;
}
