import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';

interface Session {
  id: string;
  project_path: string;
  tool: string;
  messages: any[];
  metadata: Record<string, any>;
  git_snapshot: any;
  created_at: string;
  updated_at: string;
}

interface Memory {
  id: string;
  project_path: string;
  key: string;
  value: any;
  type: string;
  created_at: string;
}

export class SessionManager {
  private db!: Database.Database;
  private projectPath: string;
  private contextKeeperDir: string;
  
  constructor(projectPath: string) {
    this.projectPath = projectPath;
    // Store database in user's home directory
    this.contextKeeperDir = path.join(os.homedir(), '.contextkeeper');
  }
  
  async initialize(): Promise<void> {
    // Create .contextkeeper directory if it doesn't exist
    await fs.mkdir(this.contextKeeperDir, { recursive: true });
    
    // Initialize SQLite database
    const dbPath = path.join(this.contextKeeperDir, 'contextkeeper.db');
    this.db = new Database(dbPath);
    
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        tool TEXT DEFAULT 'unknown',
        messages TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        git_snapshot TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        type TEXT DEFAULT 'other',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS git_snapshots (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        branch TEXT,
        commit_hash TEXT,
        diff TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_path);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_key ON memories(project_path, key);
    `);
    
    // Check for existing .claude/sessions to migrate
    await this.checkForClaudeSessions();
  }
  
  private async checkForClaudeSessions(): Promise<void> {
    const claudeDir = path.join(this.projectPath, '.claude', 'sessions');
    try {
      const files = await fs.readdir(claudeDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          // Parse and import Claude session
          const content = await fs.readFile(path.join(claudeDir, file), 'utf-8');
          await this.importClaudeSession(file, content);
        }
      }
    } catch {
      // No Claude sessions directory
    }
  }
  
  private async importClaudeSession(filename: string, content: string): Promise<void> {
    // Parse the markdown format from your existing sessions
    const lines = content.split('\n');
    const metadata: Record<string, string> = {};
    
    // Extract metadata from markdown headers
    for (const line of lines) {
      if (line.startsWith('**Date**:')) {
        metadata.date = line.split(':')[1].trim();
      } else if (line.startsWith('**Agent**:')) {
        metadata.agent = line.split(':')[1].trim();
      } else if (line.startsWith('**Project**:')) {
        metadata.project = line.split(':')[1].trim();
      }
    }
    
    // Check if session already imported
    const existing = this.db.prepare(
      'SELECT id FROM sessions WHERE metadata LIKE ? AND project_path = ?'
    ).get(`%${filename}%`, this.projectPath);
    
    if (!existing) {
      // Import as a new session
      const sessionId = `claude-import-${crypto.randomBytes(8).toString('hex')}`;
      this.db.prepare(`
        INSERT INTO sessions (id, project_path, tool, messages, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        this.projectPath,
        'claude',
        JSON.stringify([{ role: 'system', content: content }]),
        JSON.stringify({ ...metadata, imported_from: filename }),
        metadata.date || new Date().toISOString()
      );
    }
  }
  
  async saveSession(data: {
    messages?: any[];
    metadata?: Record<string, any>;
    git_snapshot?: any;
    tool?: string;
  }): Promise<string> {
    const sessionId = crypto.randomBytes(16).toString('hex');
    
    this.db.prepare(`
      INSERT INTO sessions (id, project_path, tool, messages, metadata, git_snapshot)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      this.projectPath,
      data.tool || process.env.MCP_TOOL || 'unknown',
      JSON.stringify(data.messages || []),
      JSON.stringify(data.metadata || {}),
      JSON.stringify(data.git_snapshot || {})
    );
    
    return sessionId;
  }
  
  async loadSession(sessionId?: string): Promise<Session | null> {
    let session;
    
    if (sessionId) {
      // Load specific session
      session = this.db.prepare(
        'SELECT * FROM sessions WHERE id = ? AND project_path = ?'
      ).get(sessionId, this.projectPath) as any;
    } else {
      // Load most recent session for this project
      session = this.db.prepare(
        'SELECT * FROM sessions WHERE project_path = ? ORDER BY created_at DESC LIMIT 1'
      ).get(this.projectPath) as any;
    }
    
    if (session) {
      return {
        ...session,
        messages: JSON.parse(session.messages),
        metadata: JSON.parse(session.metadata),
        git_snapshot: JSON.parse(session.git_snapshot),
      };
    }
    
    return null;
  }
  
  async listSessions(limit: number = 10): Promise<Session[]> {
    const sessions = this.db.prepare(
      'SELECT * FROM sessions WHERE project_path = ? ORDER BY created_at DESC LIMIT ?'
    ).all(this.projectPath, limit) as any[];
    
    return sessions.map(session => ({
      ...session,
      messages: JSON.parse(session.messages),
      metadata: JSON.parse(session.metadata),
      git_snapshot: JSON.parse(session.git_snapshot),
    }));
  }
  
  async addMemory(key: string, value: any, type: string = 'other'): Promise<void> {
    const id = crypto.randomBytes(16).toString('hex');
    
    // Upsert: update if key exists, insert if not
    this.db.prepare(`
      INSERT INTO memories (id, project_path, key, value, type)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_path, key) 
      DO UPDATE SET value = ?, type = ?, created_at = CURRENT_TIMESTAMP
    `).run(
      id,
      this.projectPath,
      key,
      JSON.stringify(value),
      type,
      JSON.stringify(value),
      type
    );
  }
  
  async getMemory(key: string): Promise<any | null> {
    const memory = this.db.prepare(
      'SELECT * FROM memories WHERE project_path = ? AND key = ?'
    ).get(this.projectPath, key) as any;
    
    if (memory) {
      return JSON.parse(memory.value);
    }
    
    return null;
  }
  
  async listMemories(type?: string): Promise<Memory[]> {
    let query = 'SELECT * FROM memories WHERE project_path = ?';
    const params: any[] = [this.projectPath];
    
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const memories = this.db.prepare(query).all(...params) as any[];
    
    return memories.map(memory => ({
      ...memory,
      value: JSON.parse(memory.value),
    }));
  }
  
  async deleteMemory(key: string): Promise<void> {
    this.db.prepare(
      'DELETE FROM memories WHERE project_path = ? AND key = ?'
    ).run(this.projectPath, key);
  }
  
  async getSessionsSince(timestamp: string): Promise<Session[]> {
    const sessions = this.db.prepare(
      'SELECT * FROM sessions WHERE project_path = ? AND created_at > ? ORDER BY created_at DESC'
    ).all(this.projectPath, timestamp) as any[];
    
    return sessions.map(session => ({
      ...session,
      messages: JSON.parse(session.messages),
      metadata: JSON.parse(session.metadata),
      git_snapshot: JSON.parse(session.git_snapshot),
    }));
  }
  
  async cleanup(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const result = this.db.prepare(
      'DELETE FROM sessions WHERE project_path = ? AND created_at < ?'
    ).run(this.projectPath, cutoffDate.toISOString());
    
    return result.changes;
  }
}
