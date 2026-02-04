// ====================
// Skills
// ====================

/**
 * Skill installation mode
 * - mcp: Install SaveContext-MCP skill (for agents with MCP server access)
 * - cli: Install SaveContext-CLI skill (for agents with Bash access only)
 * - both: Install both skills
 */
export type SkillMode = 'mcp' | 'cli' | 'both';

/**
 * Setup skill result
 */
export interface SetupSkillResult {
  success: boolean;
  skillPath: string;
  error?: string;
}

/**
 * Skill installation record for sync config
 */
export interface SkillInstallation {
  tool: string;
  path: string;
  installedAt: number;
  mode: SkillMode;
}

/**
 * Skill sync configuration stored in ~/.savecontext/skill-sync.json
 */
export interface SkillSyncConfig {
  installations: SkillInstallation[];
}

/**
 * Options for setupSkill function
 */
export interface SetupSkillOptions {
  tool?: string;
  path?: string;
  sync?: boolean;
  mode?: SkillMode;
}
