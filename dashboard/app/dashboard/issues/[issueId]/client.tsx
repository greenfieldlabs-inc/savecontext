'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { IssueDetailPanel } from '@/components/dashboard/issues/list/issues-list';
import { IssueActionMenu } from '@/components/dashboard/issues/shared/issue-action-menu';
import { TYPE_CONFIG, TYPE_OPTIONS } from '@/lib/constants/issue-config';
import { useIssueEvents } from '@/lib/hooks/use-issue-events';
import type { Issue, ProjectSummary } from '@/lib/types';
import { toast } from 'sonner';

function useIssuesListUrl(): string {
  const [url, setUrl] = useState('/dashboard/issues');

  useEffect(() => {
    const savedUrl = sessionStorage.getItem('issuesListUrl');
    if (savedUrl) {
      // Sanitize URL to remove any issue param that could cause redirect loop
      try {
        const urlObj = new URL(savedUrl, window.location.origin);
        urlObj.searchParams.delete('issue');
        urlObj.searchParams.delete('clone');
        urlObj.searchParams.delete('duplicate');
        urlObj.searchParams.delete('reactivate');
        const sanitized = urlObj.pathname + (urlObj.search || '');
        setUrl(sanitized);
      } catch {
        setUrl('/dashboard/issues');
      }
    }
  }, []);

  return url;
}

interface IssueDetailPageProps {
  issue: Issue;
  projects: ProjectSummary[];
}

export function IssueDetailPage({ issue: initialIssue, projects }: IssueDetailPageProps) {
  const router = useRouter();
  const [issue, setIssue] = useState(initialIssue);
  const issuesListUrl = useIssuesListUrl();

  // Sync state when server data changes (from router.refresh())
  // Use updated_at as a stable key since object reference comparison isn't reliable
  useEffect(() => {
    setIssue(initialIssue);
  }, [initialIssue.id, initialIssue.updated_at, initialIssue.status]);

  // Subscribe to SSE for real-time updates
  useIssueEvents();

  const typeConfig = TYPE_CONFIG[issue.issue_type] || TYPE_OPTIONS[0];

  const handleUpdate = async (updates: Partial<Issue> & { add_project_path?: string; remove_project_path?: string }) => {
    // Optimistic update
    setIssue(prev => ({ ...prev, ...updates, updated_at: Date.now() }));

    try {
      const response = await fetch('/api/issues/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: issue.id, ...updates })
      });

      if (!response.ok) {
        // Revert on failure
        setIssue(initialIssue);
      } else {
        router.refresh();
      }
    } catch (error) {
      console.error('Failed to update issue:', error);
      toast.error('Failed to update issue');
      setIssue(initialIssue);
    }
  };

  const handleClose = () => {
    router.push(issuesListUrl);
  };

  const handleClone = (issueToClone: Issue) => {
    router.push(`/dashboard/issues?clone=${issueToClone.id}`);
  };

  const handleMarkDuplicate = (issueToMark: Issue) => {
    router.push(`/dashboard/issues?duplicate=${issueToMark.id}`);
  };

  const handleReactivateTo = (issueToReactivate: Issue) => {
    router.push(`/dashboard/issues?reactivate=${issueToReactivate.id}`);
  };

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href={issuesListUrl}
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Issues
        </Link>
        <ChevronRight className="h-4 w-4 text-zinc-400" />
        <span className="font-mono text-zinc-700 dark:text-zinc-300">{issue.short_id || issue.id.slice(0, 8)}</span>
        <IssueActionMenu issue={issue} onClone={handleClone} onMarkDuplicate={handleMarkDuplicate} onReactivateTo={handleReactivateTo} showCopyActions />
      </div>

      {/* Detail Panel */}
      <IssueDetailPanel
        issue={issue}
        typeConfig={typeConfig}
        onClose={handleClose}
        onUpdate={handleUpdate}
        onSubtaskCreated={() => router.refresh()}
        onClone={handleClone}
        onMarkDuplicate={handleMarkDuplicate}
        projects={projects}
      />
    </div>
  );
}
