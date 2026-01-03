'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Pencil, GitMerge, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RenameProjectDialog } from './rename-project-dialog';
import { MergeProjectDialog } from './merge-project-dialog';
import { DeleteProjectDialog } from './delete-project-dialog';

interface ProjectActionsProps {
  projectId: string;
  projectName: string;
  projectPath: string;
  sessionCount: number;
}

export function ProjectActions({
  projectId,
  projectName,
  projectPath,
  sessionCount,
}: ProjectActionsProps) {
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleSuccess = () => {
    router.refresh();
  };

  const stopProp = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm transition-all hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            onClick={stopProp}
            onMouseDown={stopProp}
          >
            <MoreHorizontal className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48 bg-white dark:bg-zinc-900"
          onClick={stopProp}
          onMouseDown={stopProp}
        >
          <DropdownMenuItem
            onClick={(e) => { stopProp(e); setDropdownOpen(false); setRenameOpen(true); }}
            onMouseDown={stopProp}
          >
            <Pencil className="h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => { stopProp(e); setDropdownOpen(false); setMergeOpen(true); }}
            onMouseDown={stopProp}
          >
            <GitMerge className="h-4 w-4" />
            Merge into...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => { stopProp(e); setDropdownOpen(false); setDeleteOpen(true); }}
            onMouseDown={stopProp}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameProjectDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        projectId={projectId}
        projectName={projectName}
        onSuccess={handleSuccess}
      />

      <MergeProjectDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        projectId={projectId}
        projectName={projectName}
        sessionCount={sessionCount}
        onSuccess={handleSuccess}
      />

      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectId={projectId}
        projectName={projectName}
        sessionCount={sessionCount}
        onDelete={handleSuccess}
      />
    </>
  );
}
