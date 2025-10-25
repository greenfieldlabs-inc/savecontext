import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import path from 'path';

export interface GitStatus {
  branch: string;
  status: string;
  hasChanges: boolean;
  files: {
    modified: string[];
    added: string[];
    deleted: string[];
    renamed: string[];
  };
}

export interface Commit {
  hash: string;
  author: string;
  date: string;
  message: string;
  files: string[];
}

export class GitManager {
  private git: SimpleGit;
  private projectPath: string;
  
  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.git = simpleGit(projectPath);
  }
  
  async isGitRepository(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }
  
  async getStatus(): Promise<GitStatus> {
    try {
      const status = await this.git.status();
      const branch = await this.git.branchLocal();
      
      return {
        branch: branch.current,
        status: this.formatStatus(status),
        hasChanges: !status.isClean(),
        files: {
          modified: status.modified,
          added: status.created,
          deleted: status.deleted,
          renamed: status.renamed.map(r => r.from),
        },
      };
    } catch (error) {
      return {
        branch: 'unknown',
        status: 'Git not available',
        hasChanges: false,
        files: {
          modified: [],
          added: [],
          deleted: [],
          renamed: [],
        },
      };
    }
  }
  
  async getRecentCommits(limit: number = 10): Promise<Commit[]> {
    try {
      const log = await this.git.log({ maxCount: limit });
      
      return log.all.map(commit => ({
        hash: commit.hash.substring(0, 7),
        author: commit.author_name,
        date: commit.date,
        message: commit.message,
        files: commit.diff?.files.map(f => f.file) || [],
      }));
    } catch {
      return [];
    }
  }
  
  async getUncommittedChanges(): Promise<string> {
    try {
      const diff = await this.git.diff();
      const diffCached = await this.git.diff(['--cached']);
      
      let result = '';
      if (diff) {
        result += '=== Unstaged Changes ===\n' + diff;
      }
      if (diffCached) {
        result += '\n=== Staged Changes ===\n' + diffCached;
      }
      
      return result || 'No uncommitted changes';
    } catch {
      return 'Unable to get uncommitted changes';
    }
  }
  
  async getChangesSince(since: string): Promise<any> {
    try {
      // Handle special case for "last-session"
      if (since === 'last-session') {
        // This would integrate with SessionManager to get timestamp
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        since = oneHourAgo;
      }
      
      const log = await this.git.log({ since });
      const status = await this.getStatus();
      
      return {
        commits_since: log.all.length,
        commits: log.all.slice(0, 10).map(c => ({
          hash: c.hash.substring(0, 7),
          message: c.message,
          date: c.date,
        })),
        current_status: status,
        since: since,
      };
    } catch {
      return {
        commits_since: 0,
        commits: [],
        current_status: await this.getStatus(),
        since: since,
      };
    }
  }
  
  async getCurrentBranch(): Promise<string> {
    try {
      const branch = await this.git.branchLocal();
      return branch.current;
    } catch {
      return 'unknown';
    }
  }
  
  private formatStatus(status: StatusResult): string {
    const parts: string[] = [];
    
    if (status.modified.length > 0) {
      parts.push(`${status.modified.length} modified`);
    }
    if (status.created.length > 0) {
      parts.push(`${status.created.length} added`);
    }
    if (status.deleted.length > 0) {
      parts.push(`${status.deleted.length} deleted`);
    }
    if (status.renamed.length > 0) {
      parts.push(`${status.renamed.length} renamed`);
    }
    
    if (parts.length === 0) {
      return 'Clean working tree';
    }
    
    return parts.join(', ');
  }
}
