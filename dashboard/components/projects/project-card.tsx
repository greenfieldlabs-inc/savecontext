'use client';

import { useState, useEffect } from 'react';
import { FolderKanban, Activity, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { ProjectActions } from './project-actions';
import { StatusPill } from '@/components/ui/status-pill';
import type { ProjectSummary } from '@/lib/types';

interface ProjectCardProps {
  project: ProjectSummary;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const [isHidden, setIsHidden] = useState(false);

  // Use the project name directly, or fall back to extracting from path for legacy
  const projectName = project.name;

  // Load hidden state from localStorage on mount (keyed by project ID)
  useEffect(() => {
    const hiddenProjects = localStorage.getItem('hiddenProjects');
    if (hiddenProjects) {
      const hidden = JSON.parse(hiddenProjects);
      setIsHidden(hidden.includes(project.id));
    }
  }, [project.id]);

  const handleToggleHidden = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const hiddenProjects = localStorage.getItem('hiddenProjects');
    const hidden = hiddenProjects ? JSON.parse(hiddenProjects) : [];

    if (isHidden) {
      // Remove from hidden list (keyed by project ID)
      const updated = hidden.filter((p: string) => p !== project.id);
      localStorage.setItem('hiddenProjects', JSON.stringify(updated));
      setIsHidden(false);
    } else {
      // Add to hidden list (keyed by project ID)
      hidden.push(project.id);
      localStorage.setItem('hiddenProjects', JSON.stringify(hidden));
      setIsHidden(true);
    }
  };

  return (
    <>
      <div className="group relative overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-all hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
        <Link
          href={`/dashboard/sessions?projectId=${encodeURIComponent(project.id)}`}
          className="block p-6"
        >
          <div className={`space-y-3 transition-all ${isHidden ? 'blur-md select-none' : ''}`}>
            <div className="flex items-start justify-between">
              <FolderKanban className="h-6 w-6 text-zinc-900 dark:text-zinc-50" />
            </div>

            <div>
              <h3 className="font-semibold text-zinc-900 transition-colors dark:text-zinc-50">
                {projectName}
              </h3>
              {project.project_path && (
                <p className="mt-1 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-500">
                  {project.project_path}
                </p>
              )}
            </div>

            <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              <div className="flex items-center gap-1.5">
                <FolderKanban className="h-4 w-4" />
                <span>{project.session_count} sessions</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Activity className="h-4 w-4" />
                <span>{project.total_items} items</span>
              </div>
            </div>
          </div>
        </Link>

        {/* Action Buttons */}
        <div className="absolute top-3 right-3 flex gap-2 opacity-0 transition-all group-hover:opacity-100">
          {/* Hide/Show Button */}
          <button
            onClick={handleToggleHidden}
            className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm transition-all hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            title={isHidden ? "Show project" : "Hide project"}
          >
            {isHidden ? (
              <Eye className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
            ) : (
              <EyeOff className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
            )}
          </button>

          {/* Actions Dropdown */}
          <ProjectActions
            projectId={project.id}
            projectName={projectName}
            projectPath={project.project_path}
            sessionCount={project.session_count}
          />
        </div>

        {/* Active Sessions Pill - Bottom Right */}
        {project.active_sessions > 0 && (
          <div className="absolute bottom-3 right-3">
            <StatusPill status="active" count={project.active_sessions} size="sm" />
          </div>
        )}
      </div>
    </>
  );
}
