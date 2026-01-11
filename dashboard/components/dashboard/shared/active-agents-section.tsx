'use client';

import type { AgentInfo } from '@/lib/types';
import { GitBranch, Clock } from 'lucide-react';

interface ActiveAgentsSectionProps {
  agents: AgentInfo[];
}

export function ActiveAgentsSection({ agents }: ActiveAgentsSectionProps) {
  if (agents.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Active Agents
      </h2>

      <div className="space-y-3">
        {agents.map((agent) => (
          <div
            key={agent.agent_id}
            className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                    {agent.provider}
                  </h3>
                  <span className="text-xs text-zinc-500 dark:text-zinc-500">
                    {new Date(agent.last_active_at).toLocaleString()}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
                  {agent.git_branch && (
                    <div className="flex items-center gap-1.5">
                      <GitBranch className="h-3.5 w-3.5" />
                      <span>{agent.git_branch}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Last active {getRelativeTime(agent.last_active_at)}</span>
                  </div>
                </div>

              <div className="text-xs text-zinc-500 dark:text-zinc-500 font-mono">
                {agent.agent_id}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
