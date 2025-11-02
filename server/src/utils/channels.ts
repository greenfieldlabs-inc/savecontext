/**
 * Channel Utilities
 *
 * Channels provide persistent topic organization that survives session crashes.
 * Auto-derived from git branches or session names.
 */

/**
 * Derives a channel name from a git branch name
 * Examples:
 *   "bugfix/login-error" → "bugfix-login-error"
 *   "main" → null (main/master don't get channels)
 *
 * @param branch - Git branch name
 * @returns Derived channel name (max 20 chars) or null if branch should be skipped
 */
export function deriveChannelFromBranch(branch: string): string | null {
  if (!branch || branch.trim() === '') return null;

  // Skip main and master branches - they use 'general' channel
  if (branch === 'main' || branch === 'master') return null;

  // Replace special characters with hyphens
  let channel = branch
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')    // Replace non-alphanumeric with hyphen
    .replace(/--+/g, '-')             // Collapse multiple hyphens
    .replace(/^-|-$/g, '');           // Remove leading/trailing hyphens

  // If channel is empty after cleaning, return general
  if (!channel) return 'general';

  // Truncate to 20 characters
  if (channel.length > 20) {
    channel = channel.substring(0, 20).replace(/-+$/, ''); // Remove trailing hyphen if truncated
  }

  return channel;
}

/**
 * Derives a default channel name from branch or session name
 * Priority: branch → session name → 'general'
 *
 * @param branch - Git branch name (optional)
 * @param sessionName - Session name (optional)
 * @returns Derived channel name (max 20 chars) or 'general' if no inputs
 */
export function deriveDefaultChannel(branch?: string, sessionName?: string): string {
  // First try to derive from branch
  if (branch) {
    const branchChannel = deriveChannelFromBranch(branch);
    if (branchChannel) {
      return branchChannel;
    }
  }

  // If branch derivation failed or returned null (main/master), try session name
  if (sessionName) {
    const sessionChannel = deriveChannelFromBranch(sessionName); // Reuse same logic
    if (sessionChannel) {
      return sessionChannel;
    }
  }

  // Default fallback
  return 'general';
}

/**
 * Validates a channel name
 * Rules:
 *   - Must be non-empty string
 *   - Max 20 characters
 *   - Lowercase letters, numbers, hyphens only
 *   - Must start/end with alphanumeric (no hyphens)
 *
 * @param channel - Channel name to validate
 * @returns true if valid, false otherwise
 */
export function isValidChannel(channel: string): boolean {
  if (!channel || typeof channel !== 'string') {
    return false;
  }

  // Check length
  if (channel.length === 0 || channel.length > 20) {
    return false;
  }

  // Check format (lowercase letters, numbers, hyphens only, no leading/trailing hyphens)
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(channel);
}

/**
 * Normalizes a channel name to ensure it's valid
 * If invalid, returns 'general'
 *
 * @param channel - Channel name to normalize
 * @returns Normalized channel name or 'general' if invalid
 */
export function normalizeChannel(channel: string): string {
  if (!channel || typeof channel !== 'string') {
    return 'general';
  }

  // Apply same logic as deriveChannelFromBranch
  const normalized = channel
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')      // Replace non-alphanumeric with hyphen
    .replace(/^-+|-+$/g, '');         // Remove leading/trailing hyphens

  if (!normalized) {
    return 'general';
  }

  // Truncate if needed
  if (normalized.length > 20) {
    return normalized.substring(0, 20).replace(/-+$/, '');
  }

  return normalized;
}

/**
 * Gets channel display name (for UI)
 * Converts channel slug back to readable format
 * Examples:
 *   "feature-auth-system" → "Feature Auth System"
 *   "bugfix-login" → "Bugfix Login"
 *   "general" → "General" (fallback)
 *
 * @param channel - Channel name
 * @returns Display-friendly channel name
 */
export function getChannelDisplayName(channel: string): string {
  if (!channel) return 'General';

  return channel
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
