'use client';

import { useRef } from 'react';
import { FileText, X, Upload } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ProjectSummary, PlanStatus } from '@/lib/types';
import { markdownComponents } from './markdown-utils';
import { PlanStatusDropdown } from './status-dropdown';
import { ProjectDropdown } from './project-dropdown';

interface CreatePlanFormData {
  title: string;
  content: string;
  successCriteria: string;
  projectPath: string;
  status: PlanStatus;
}

interface CreatePlanModalProps {
  isOpen: boolean;
  formData: CreatePlanFormData;
  projects: ProjectSummary[];
  onFormChange: (updates: Partial<CreatePlanFormData>) => void;
  onCreate: () => void;
  onClose: () => void;
  onFileImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export function CreatePlanModal({
  isOpen,
  formData,
  projects,
  onFormChange,
  onCreate,
  onClose,
  onFileImport,
}: CreatePlanModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  return (
    <>
      {/* Hidden file input for import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={onFileImport}
        accept=".md"
        className="hidden"
      />

      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 max-h-[90vh] flex flex-col">
          {/* Modal Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-zinc-400" />
              <span className="text-zinc-700 dark:text-zinc-300">New plan</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <Upload className="h-3.5 w-3.5" />
                Import
              </button>
              <button
                onClick={onClose}
                className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Modal Body */}
          <div className="px-6 py-5 overflow-y-auto flex-1">
            <input
              type="text"
              value={formData.title}
              onChange={(e) => onFormChange({ title: e.target.value })}
              placeholder="Untitled"
              autoFocus
              className="w-full text-2xl font-semibold text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 bg-transparent border-none outline-none mb-4"
            />

            {/* Content - rendered markdown or textarea */}
            {formData.content ? (
              <div className="min-h-[300px] prose prose-sm prose-zinc dark:prose-invert max-w-none
                prose-headings:font-semibold prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100
                prose-h1:text-xl prose-h1:mt-0 prose-h1:mb-4
                prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3
                prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2
                prose-p:text-zinc-600 dark:prose-p:text-zinc-400 prose-p:my-2 prose-p:leading-relaxed
                prose-li:text-zinc-600 dark:prose-li:text-zinc-400 prose-li:my-0.5
                prose-ul:my-2 prose-ol:my-2
                prose-code:text-xs prose-code:bg-zinc-100 dark:prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-zinc-700 dark:prose-code:text-zinc-300
                prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-800 prose-pre:rounded-lg prose-pre:p-3 prose-pre:my-3
                prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                prose-strong:text-zinc-900 dark:prose-strong:text-zinc-100 prose-strong:font-semibold
                prose-blockquote:border-l-zinc-300 dark:prose-blockquote:border-l-zinc-600 prose-blockquote:text-zinc-500 dark:prose-blockquote:text-zinc-400 prose-blockquote:not-italic
                prose-hr:border-zinc-200 dark:prose-hr:border-zinc-700
              ">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{formData.content}</ReactMarkdown>
              </div>
            ) : (
              <textarea
                value={formData.content}
                onChange={(e) => onFormChange({ content: e.target.value })}
                placeholder="Start writing your plan or import a markdown file..."
                rows={14}
                className="w-full text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 bg-transparent border-none outline-none resize-none"
              />
            )}

            <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <input
                type="text"
                value={formData.successCriteria}
                onChange={(e) => onFormChange({ successCriteria: e.target.value })}
                placeholder="Success criteria (optional)"
                className="w-full text-sm text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 bg-transparent border-none outline-none"
              />
            </div>
          </div>

          {/* Properties */}
          <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
            <div className="flex flex-wrap items-center gap-2">
              <PlanStatusDropdown
                value={formData.status}
                onChange={(status) => onFormChange({ status })}
                size="md"
              />
              <ProjectDropdown
                value={formData.projectPath}
                onChange={(projectPath) => onFormChange({ projectPath })}
                projects={projects}
              />
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              onClick={onCreate}
              disabled={!formData.title || !formData.projectPath}
              className="px-4 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create plan
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export type { CreatePlanFormData };
