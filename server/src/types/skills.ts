// ====================
// Skills
// ====================

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
}
