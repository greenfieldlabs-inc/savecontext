'use client';

import { useState, useEffect } from 'react';
import { FileText, X, Clock, Circle, PlayCircle, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Plan, ProjectSummary } from '@/lib/types';
import { TYPE_CONFIG } from '@/lib/constants/issue-config';
import { markdownComponents } from './markdown-utils';
import { PlanStatusDropdown } from './status-dropdown';
import { ProjectDropdown } from './project-dropdown';

interface PlanDetailPanelProps {
  plan: Plan;
  projects: ProjectSummary[];
  onClose: () => void;
  onUpdate: (updates: Partial<Plan>) => void;
}

export function PlanDetailPanel({
  plan,
  projects,
  onClose,
  onUpdate,
}: PlanDetailPanelProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [editingCriteria, setEditingCriteria] = useState(false);
  const [titleValue, setTitleValue] = useState(plan.title);
  const [contentValue, setContentValue] = useState(plan.content);
  const [criteriaValue, setCriteriaValue] = useState(plan.success_criteria || '');

  // Use epics directly from plan - already fetched by getPlans
  const linkedEpics = plan.epics || [];
  const linkedIssues = plan.linked_issues || [];

  useEffect(() => {
    setTitleValue(plan.title);
    setContentValue(plan.content);
    setCriteriaValue(plan.success_criteria || '');
  }, [plan.title, plan.content, plan.success_criteria]);

  const handleTitleSave = () => {
    if (titleValue.trim() && titleValue !== plan.title) {
      onUpdate({ title: titleValue.trim() });
    }
    setEditingTitle(false);
  };

  const handleContentSave = () => {
    if (contentValue !== plan.content) {
      onUpdate({ content: contentValue });
    }
    setEditingContent(false);
  };

  const handleCriteriaSave = () => {
    if (criteriaValue !== (plan.success_criteria || '')) {
      onUpdate({ success_criteria: criteriaValue || null });
    }
    setEditingCriteria(false);
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <FileText className="h-3.5 w-3.5" />
            <span className="font-mono">{plan.short_id || plan.id.slice(0, 8)}</span>
            <span>·</span>
            <span>Plan</span>
          </div>
          {editingTitle ? (
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleSave();
                if (e.key === 'Escape') {
                  setTitleValue(plan.title);
                  setEditingTitle(false);
                }
              }}
              autoFocus
              className="w-full text-lg font-semibold text-zinc-900 dark:text-zinc-100 bg-transparent border-b border-zinc-300 dark:border-zinc-600 outline-none focus:border-zinc-500"
            />
          ) : (
            <h2
              onClick={() => setEditingTitle(true)}
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded px-1 -mx-1"
            >
              {plan.title}
            </h2>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Properties */}
      <div className="flex flex-wrap gap-2">
        <PlanStatusDropdown
          value={plan.status}
          onChange={(status) => onUpdate({ status })}
          size="md"
        />
        <ProjectDropdown
          value={plan.project_path}
          onChange={(project_path) => onUpdate({ project_path })}
          projects={projects}
        />
      </div>

      {/* Content */}
      <div>
        <span className="text-xs text-zinc-400">Content</span>
        {editingContent ? (
          <textarea
            value={contentValue}
            onChange={(e) => setContentValue(e.target.value)}
            onBlur={handleContentSave}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setContentValue(plan.content);
                setEditingContent(false);
              }
            }}
            autoFocus
            rows={12}
            className="w-full mt-1 text-sm text-zinc-600 dark:text-zinc-400 bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md p-3 outline-none focus:border-zinc-400 resize-none font-mono"
            placeholder="Write your plan..."
          />
        ) : (
          <div
            onClick={() => setEditingContent(true)}
            className="mt-1 text-sm cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded px-3 py-2 -mx-3 min-h-[8rem] border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700"
          >
            {plan.content ? (
              <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none
                prose-headings:font-semibold prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100
                prose-h1:text-lg prose-h1:border-b prose-h1:border-zinc-200 dark:prose-h1:border-zinc-700 prose-h1:pb-2 prose-h1:mb-4
                prose-h2:text-base prose-h2:mt-6 prose-h2:mb-3
                prose-h3:text-sm prose-h3:mt-4 prose-h3:mb-2
                prose-p:text-zinc-600 dark:prose-p:text-zinc-400 prose-p:my-2
                prose-li:text-zinc-600 dark:prose-li:text-zinc-400 prose-li:my-0.5
                prose-ul:my-2 prose-ol:my-2
                prose-code:text-xs prose-code:bg-zinc-100 dark:prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-zinc-800 dark:prose-code:text-zinc-200
                prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-800 prose-pre:rounded-lg prose-pre:p-3 prose-pre:my-3
                prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                prose-strong:text-zinc-900 dark:prose-strong:text-zinc-100
                prose-blockquote:border-l-zinc-300 dark:prose-blockquote:border-l-zinc-600 prose-blockquote:text-zinc-500 dark:prose-blockquote:text-zinc-400 prose-blockquote:not-italic
              ">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{plan.content}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-zinc-400 italic">Write your plan...</p>
            )}
          </div>
        )}
      </div>

      {/* Success Criteria */}
      <div>
        <span className="text-xs text-zinc-400">Success Criteria</span>
        {editingCriteria ? (
          <input
            type="text"
            value={criteriaValue}
            onChange={(e) => setCriteriaValue(e.target.value)}
            onBlur={handleCriteriaSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCriteriaSave();
              if (e.key === 'Escape') {
                setCriteriaValue(plan.success_criteria || '');
                setEditingCriteria(false);
              }
            }}
            autoFocus
            className="w-full mt-1 text-sm text-zinc-600 dark:text-zinc-400 bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md p-2 outline-none focus:border-zinc-400"
            placeholder="Define success criteria..."
          />
        ) : (
          <div
            onClick={() => setEditingCriteria(true)}
            className="mt-1 text-sm cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded px-2 py-1 -mx-2 min-h-[2rem]"
          >
            {plan.success_criteria ? (
              <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none
                prose-p:text-zinc-600 dark:prose-p:text-zinc-400 prose-p:my-1
                prose-li:text-zinc-600 dark:prose-li:text-zinc-400 prose-li:my-0.5
                prose-ul:my-1 prose-ol:my-1 prose-ul:list-disc prose-ul:pl-5
                prose-strong:text-zinc-900 dark:prose-strong:text-zinc-100
              ">
                <ReactMarkdown>
                  {plan.success_criteria.replace(/([^\n])\n-/g, '$1\n\n-')}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-zinc-400 italic">Define success criteria...</p>
            )}
          </div>
        )}
      </div>

      {/* Linked Epics */}
      {linkedEpics.length > 0 && (
        <div>
          <span className="text-xs text-zinc-400">Linked Epics</span>
          <div className="mt-2 space-y-1.5">
            {linkedEpics.map((epic) => (
              <a
                key={epic.id}
                href={`/dashboard/issues?issue=${epic.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors cursor-pointer"
              >
                {epic.status === 'closed' ? (
                  <CheckCircle2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
                ) : epic.status === 'in_progress' ? (
                  <PlayCircle className="h-4 w-4 text-blue-500 flex-shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-zinc-400 flex-shrink-0" strokeWidth={2} />
                )}
                <span className="text-xs font-mono text-zinc-400">{epic.short_id}</span>
                <span className={`flex-1 text-sm truncate ${epic.status === 'closed' ? 'text-zinc-400 line-through' : 'text-zinc-700 dark:text-zinc-300'}`}>
                  {epic.title}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Linked Issues (non-epic: tasks, bugs, features, chores) */}
      {linkedIssues.length > 0 && (
        <div>
          <span className="text-xs text-zinc-400">Linked Issues</span>
          <div className="mt-2 space-y-1.5">
            {linkedIssues.map((issue) => {
              const typeConfig = TYPE_CONFIG[issue.issue_type as keyof typeof TYPE_CONFIG] || TYPE_CONFIG.task;
              return (
                <a
                  key={issue.id}
                  href={`/dashboard/issues?issue=${issue.id}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors cursor-pointer"
                >
                  {issue.status === 'closed' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <span className={`flex-shrink-0 ${typeConfig.color}`}>{typeConfig.icon}</span>
                  )}
                  <span className="text-xs font-mono text-zinc-400">{issue.short_id}</span>
                  <span className={`flex-1 text-sm truncate ${issue.status === 'closed' ? 'text-zinc-400 line-through' : 'text-zinc-700 dark:text-zinc-300'}`}>
                    {issue.title}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="flex items-center gap-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Updated {new Date(plan.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        {linkedEpics.length > 0 && (
          <span>
            {linkedEpics.filter(e => e.status === 'closed').length}/{linkedEpics.length} epics
          </span>
        )}
        {linkedIssues.length > 0 && (
          <span>
            {linkedIssues.filter(i => i.status === 'closed').length}/{linkedIssues.length} issues
          </span>
        )}
      </div>
    </div>
  );
}
