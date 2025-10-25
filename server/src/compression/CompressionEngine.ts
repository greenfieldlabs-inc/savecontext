import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export interface CompressionResult {
  original_tokens: number;
  compressed_tokens: number;
  compression_ratio: number;
  content: any;
  strategy: string;
}

export class CompressionEngine {
  private pythonScript: string;
  
  constructor() {
    // Path to Python compression script
    this.pythonScript = path.join(process.cwd(), 'src', 'compression.py');
  }
  
  async compress(
    context: any,
    targetTokens: number,
    provider?: string
  ): Promise<CompressionResult> {
    // Provider-specific token limits
    const limits: Record<string, number> = {
      claude: 200000,
      cursor: 50000,
      factory: 100000,
      copilot: 30000,
    };
    
    if (provider && limits[provider]) {
      targetTokens = Math.min(targetTokens, limits[provider]);
    }
    
    // Estimate current tokens (rough approximation)
    const contextStr = JSON.stringify(context);
    const estimatedTokens = Math.ceil(contextStr.length / 4);
    
    // If already under target, return as-is
    if (estimatedTokens <= targetTokens) {
      return {
        original_tokens: estimatedTokens,
        compressed_tokens: estimatedTokens,
        compression_ratio: 1,
        content: context,
        strategy: 'none',
      };
    }
    
    // Apply compression strategies
    const compressed = await this.applyCompressionStrategies(context, targetTokens);
    
    return compressed;
  }
  
  private async applyCompressionStrategies(
    context: any,
    targetTokens: number
  ): Promise<CompressionResult> {
    const original = JSON.stringify(context);
    const originalTokens = Math.ceil(original.length / 4);
    
    // Strategy 1: Keep essential parts, compress others
    const compressed = {
      // Always keep project profile and current git status
      project_profile: context.profile || {},
      git_status: context.git?.status || {},
      current_branch: context.git?.branch || 'unknown',
      
      // Compress messages
      messages: await this.compressMessages(context.messages || [], targetTokens * 0.4),
      
      // Compress code snippets (future: use vision compression)
      code_context: await this.compressCode(context.code || [], targetTokens * 0.3),
      
      // Summarize old commits
      recent_activity: this.summarizeCommits(context.git?.recent_commits || []),
      
      // Keep memories as-is (they're important)
      memories: context.memories || {},
    };
    
    const compressedStr = JSON.stringify(compressed);
    const compressedTokens = Math.ceil(compressedStr.length / 4);
    
    return {
      original_tokens: originalTokens,
      compressed_tokens: compressedTokens,
      compression_ratio: originalTokens / compressedTokens,
      content: compressed,
      strategy: 'mixed',
    };
  }
  
  private async compressMessages(messages: any[], tokenBudget: number): Promise<any[]> {
    if (messages.length === 0) return [];
    
    // Keep last 5 messages verbatim
    const recent = messages.slice(-5);
    const older = messages.slice(0, -5);
    
    if (older.length === 0) return recent;
    
    // Summarize older messages
    const summary = {
      role: 'system',
      content: `[Summary of ${older.length} older messages: ${this.summarizeMessages(older)}]`,
    };
    
    return [summary, ...recent];
  }
  
  private summarizeMessages(messages: any[]): string {
    // Simple summarization (could be enhanced with LLM)
    const topics = new Set<string>();
    const actions = new Set<string>();
    
    for (const msg of messages) {
      const content = msg.content || '';
      // Extract key topics (simple heuristic)
      if (content.includes('function')) topics.add('functions');
      if (content.includes('class')) topics.add('classes');
      if (content.includes('test')) topics.add('testing');
      if (content.includes('fix')) actions.add('bug fixes');
      if (content.includes('refactor')) actions.add('refactoring');
      if (content.includes('add') || content.includes('implement')) actions.add('implementation');
    }
    
    const topicStr = topics.size > 0 ? Array.from(topics).join(', ') : 'various topics';
    const actionStr = actions.size > 0 ? Array.from(actions).join(', ') : 'development';
    
    return `Discussion about ${topicStr} involving ${actionStr}`;
  }
  
  private async compressCode(codeSnippets: any[], tokenBudget: number): Promise<any[]> {
    // For now, just truncate long code snippets
    // In future, this will use vision compression for large files
    return codeSnippets.map(snippet => {
      if (typeof snippet === 'string' && snippet.length > 1000) {
        return {
          type: 'code_summary',
          lines: snippet.split('\n').length,
          preview: snippet.substring(0, 500) + '\n... [truncated]',
        };
      }
      return snippet;
    });
  }
  
  private summarizeCommits(commits: any[]): any {
    if (commits.length === 0) return { commits: [] };
    
    // Group commits by type
    const grouped: Record<string, number> = {};
    const recent = commits.slice(0, 3);
    
    for (const commit of commits) {
      const msg = commit.message || '';
      let type = 'other';
      
      if (msg.match(/^feat/i)) type = 'features';
      else if (msg.match(/^fix/i)) type = 'fixes';
      else if (msg.match(/^docs/i)) type = 'docs';
      else if (msg.match(/^test/i)) type = 'tests';
      else if (msg.match(/^refactor/i)) type = 'refactoring';
      
      grouped[type] = (grouped[type] || 0) + 1;
    }
    
    return {
      total_commits: commits.length,
      by_type: grouped,
      most_recent: recent.map(c => ({
        hash: c.hash,
        message: c.message,
        date: c.date,
      })),
    };
  }
  
  // Future: Call Python script for vision compression
  async compressWithVision(filePath: string): Promise<any> {
    // This would call your existing Python vision compression code
    // For now, return placeholder
    return {
      type: 'vision_compressed',
      file: filePath,
      tokens: 2500, // Based on your Qwen findings
    };
  }
  
  // Estimate token count (rough approximation)
  estimateTokens(text: string): number {
    // Simple estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}
