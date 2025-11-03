/**
 * Project Path Utilities
 * Helpers for detecting and normalizing project paths for session management
 */

import * as path from 'path';

/**
 * Get the current project path (working directory)
 * Returns absolute path
 */
export function getCurrentProjectPath(): string {
  return process.cwd();
}

/**
 * Normalize a project path for consistent database storage and matching
 * - Converts to absolute path
 * - Resolves symlinks
 * - Removes trailing slashes
 * - Normalizes separators
 *
 * @param projectPath - Path to normalize (can be relative or absolute)
 * @returns Normalized absolute path
 */
export function normalizeProjectPath(projectPath: string): string {
  // Resolve to absolute path (handles relative paths)
  const absolutePath = path.resolve(projectPath);

  // Normalize path separators and remove trailing slash
  return path.normalize(absolutePath).replace(/[/\\]+$/, '');
}

/**
 * Check if two project paths are the same
 * Handles different representations of the same path
 *
 * @param path1 - First path
 * @param path2 - Second path
 * @returns true if paths represent the same location
 */
export function isSameProject(path1: string | null | undefined, path2: string | null | undefined): boolean {
  if (!path1 || !path2) return false;

  const normalized1 = normalizeProjectPath(path1);
  const normalized2 = normalizeProjectPath(path2);

  return normalized1 === normalized2;
}

/**
 * Get a short project name from the full path
 * Useful for display purposes
 *
 * @param projectPath - Full project path
 * @returns Just the directory name
 */
export function getProjectName(projectPath: string): string {
  return path.basename(normalizeProjectPath(projectPath));
}
