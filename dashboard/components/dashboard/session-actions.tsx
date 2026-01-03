'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, GitBranch, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DeleteSessionDialog } from './delete-session-dialog';
import { ManageProjectsDialog } from './manage-projects-dialog';
import type { SessionStatus } from '@/lib/types';

interface SessionActionsProps {
  sessionId: string;
  sessionName: string;
  currentStatus: SessionStatus;
  redirectOnDelete?: string;
}

export function SessionActions({
  sessionId,
  sessionName,
  currentStatus,
  redirectOnDelete,
}: SessionActionsProps) {
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleSuccess = () => {
    router.refresh();
  };

  const handleDeleteSuccess = () => {
    if (redirectOnDelete) {
      router.push(redirectOnDelete);
    } else {
      router.refresh();
    }
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
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            onClick={stopProp}
            onMouseDown={stopProp}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48 bg-white dark:bg-zinc-900"
          onClick={stopProp}
          onMouseDown={stopProp}
        >
          <DropdownMenuItem
            onClick={(e) => { stopProp(e); setDropdownOpen(false); setProjectsOpen(true); }}
            onMouseDown={stopProp}
          >
            <GitBranch className="h-4 w-4" />
            Connections
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => { stopProp(e); setDropdownOpen(false); setDeleteOpen(true); }}
            onMouseDown={stopProp}
            disabled={currentStatus === 'active'}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ManageProjectsDialog
        open={projectsOpen}
        onOpenChange={setProjectsOpen}
        sessionId={sessionId}
        sessionName={sessionName}
        onSuccess={handleSuccess}
      />

      <DeleteSessionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        sessionId={sessionId}
        sessionName={sessionName}
        onSuccess={handleDeleteSuccess}
      />
    </>
  );
}
