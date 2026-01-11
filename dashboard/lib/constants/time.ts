/**
 * Time constants and utilities for the dashboard
 */

// Time constants (milliseconds)
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const MS_PER_WEEK = 7 * MS_PER_DAY;

// SSE event queue constants
export const SSE_CLEANUP_INTERVAL = MS_PER_MINUTE; // Clean old events every 60 seconds
export const SSE_EVENT_RETENTION = 5 * MS_PER_MINUTE; // Keep events for 5 minutes

/**
 * Relative time filter input
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

/**
 * Date filter presets for UI
 */
export const DATE_FILTER_PRESETS = [
  { value: 'all', label: 'All', params: {} },
  { value: '24h', label: '24h', params: { createdInLastHours: 24 } },
  { value: '7d', label: '7d', params: { createdInLastDays: 7 } },
  { value: '30d', label: '30d', params: { createdInLastDays: 30 } },
  { value: '90d', label: '90d', params: { createdInLastDays: 90 } },
] as const;

export type DateFilterPreset = typeof DATE_FILTER_PRESETS[number]['value'];
