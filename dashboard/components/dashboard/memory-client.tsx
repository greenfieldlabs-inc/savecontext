'use client';

import { useEffect, useState, useRef } from 'react';
import { Brain, Plus, Search, Trash2, Edit, Terminal, Settings, FileText, ChevronDown, X, Info } from 'lucide-react';
import type { ProjectSummary } from '@/lib/types';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface Memory {
  id: string;
  project_path: string;
  key: string;
  value: string;
  category: 'command' | 'config' | 'note';
  created_at: number;
  updated_at: number;
}

interface MemoryClientProps {
  projects: ProjectSummary[];
  initialProjectFilter?: string;
  initialCategoryFilter: string;
}

const categoryOptions = [
  { value: 'all', label: 'All', icon: Brain },
  { value: 'command', label: 'Commands', icon: Terminal },
  { value: 'config', label: 'Configs', icon: Settings },
  { value: 'note', label: 'Notes', icon: FileText },
];

export function MemoryClient({ projects, initialProjectFilter, initialCategoryFilter }: MemoryClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [memoryToDelete, setMemoryToDelete] = useState<{ key: string; projectPath: string } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    key: '',
    value: '',
    category: 'note' as 'command' | 'config' | 'note'
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const currentProject = initialProjectFilter || null;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateFilters = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());

    if (value === null || value === 'all') {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    const queryString = params.toString();
    router.push(`${pathname}${queryString ? `?${queryString}` : ''}`);
  };

  useEffect(() => {
    loadMemories();
  }, [currentProject, initialCategoryFilter]);

  const loadMemories = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        ...(currentProject && { projectPath: currentProject }),
        ...(initialCategoryFilter !== 'all' && { category: initialCategoryFilter })
      });

      const response = await fetch(`/api/memory/list?${params}`);
      const data = await response.json();

      if (data.success) {
        setMemories(data.memories);
      }
    } catch (error) {
      console.error('Failed to load memories:', error);
    } finally {
      setLoading(false);
    }
  };

  const [editingProjectPath, setEditingProjectPath] = useState<string | null>(null);

  const handleSave = async () => {
    const targetProject = editingProjectPath || currentProject;
    if (!targetProject || !formData.key || !formData.value) return;

    try {
      const response = await fetch('/api/memory/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: targetProject,
          ...formData
        })
      });

      if (response.ok) {
        setFormData({ key: '', value: '', category: 'note' });
        setIsAddDialogOpen(false);
        setEditingId(null);
        setEditingProjectPath(null);
        loadMemories();
      }
    } catch (error) {
      console.error('Failed to save memory:', error);
    }
  };

  const handleDelete = (key: string, projectPath: string) => {
    setMemoryToDelete({ key, projectPath });
    setIsConfirmDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!memoryToDelete) return;

    try {
      const params = new URLSearchParams({
        projectPath: memoryToDelete.projectPath,
        key: memoryToDelete.key
      });

      const response = await fetch(`/api/memory/delete?${params}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        loadMemories();
      }
    } catch (error) {
      console.error('Failed to delete memory:', error);
    } finally {
      setMemoryToDelete(null);
    }
  };

  const handleEdit = (memory: Memory) => {
    setFormData({
      key: memory.key,
      value: memory.value,
      category: memory.category
    });
    setEditingId(memory.id);
    setEditingProjectPath(memory.project_path);
    setIsAddDialogOpen(true);
  };

  const filteredMemories = memories.filter(m =>
    m.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.value.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'command': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'config': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
      case 'note': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      default: return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
    }
  };

  const getCategoryIcon = (category: string) => {
    const option = categoryOptions.find(opt => opt.value === category);
    return option?.icon || Brain;
  };

  const selectedProject = projects.find(p => p.project_path === currentProject);
  const projectName = selectedProject
    ? selectedProject.project_path.split('/').pop()
    : null;

  const categoryStats = {
    command: memories.filter(m => m.category === 'command').length,
    config: memories.filter(m => m.category === 'config').length,
    note: memories.filter(m => m.category === 'note').length,
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Memory
          </h1>
          <p className="mt-1 sm:mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Store commands, configs, and notes that persist across sessions
          </p>
        </div>
        <div className="relative group w-full sm:w-auto">
          <button
            onClick={() => {
              setFormData({ key: '', value: '', category: 'note' });
              setEditingId(null);
              setEditingProjectPath(null);
              setIsAddDialogOpen(true);
            }}
            disabled={!currentProject}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[rgb(var(--sidebar-primary))] px-4 py-2.5 text-sm font-medium text-[rgb(var(--sidebar-primary-foreground))] shadow-sm transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Add Memory
          </button>
          {!currentProject && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none dark:bg-zinc-100 dark:text-zinc-900 flex items-center gap-1.5">
              <Info className="h-3 w-3 stroke-[2.5]" />
              Select a project first
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-900 dark:border-t-zinc-100" />
            </div>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      {memories.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Terminal className="h-4 w-4 text-blue-500" />
            {categoryStats.command} commands
          </span>
          <span className="flex items-center gap-1.5">
            <Settings className="h-4 w-4 text-purple-500" />
            {categoryStats.config} configs
          </span>
          <span className="flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-green-500" />
            {categoryStats.note} notes
          </span>
          <span className="hidden sm:inline text-zinc-400">•</span>
          <span>{memories.length} total</span>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Project Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
              className="flex items-center gap-1.5 sm:gap-2 rounded-lg border border-zinc-200 bg-white px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/50"
            >
              <span>{projectName || 'All Projects'}</span>
              <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-zinc-500" />
            </button>

            {isProjectDropdownOpen && (
              <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                <div className="max-h-80 overflow-y-auto p-1">
                  <button
                    onClick={() => {
                      updateFilters('project', null);
                      setIsProjectDropdownOpen(false);
                    }}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      !initialProjectFilter
                        ? 'bg-primary font-medium text-primary-foreground'
                        : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/50'
                    }`}
                  >
                    All Projects
                  </button>
                  {projects.map((project) => {
                    const name = project.project_path.split('/').pop();
                    return (
                      <button
                        key={project.project_path}
                        onClick={() => {
                          updateFilters('project', project.project_path);
                          setIsProjectDropdownOpen(false);
                        }}
                        className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                          initialProjectFilter === project.project_path
                            ? 'bg-primary font-medium text-primary-foreground'
                            : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/50'
                        }`}
                      >
                        <div className="truncate">{name}</div>
                        <div className="truncate text-xs text-zinc-500 dark:text-zinc-500">
                          {project.project_path}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Category Pills */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {categoryOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => updateFilters('category', option.value)}
                className={`rounded-full px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-all ${
                  initialCategoryFilter === option.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Clear Filters */}
          {(initialProjectFilter || initialCategoryFilter !== 'all') && (
            <button
              onClick={() => {
                updateFilters('project', null);
                updateFilters('category', 'all');
              }}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search memories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white pl-10 pr-4 py-2.5 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-600 dark:focus:ring-zinc-600"
          />
        </div>
      </div>

      {/* Memory List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-50" />
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
            <div className="mx-auto max-w-lg space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                <Brain className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  {searchTerm || initialCategoryFilter !== 'all' ? 'No memory items found' : 'No Memory Items Yet'}
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {searchTerm || initialCategoryFilter !== 'all'
                    ? 'Try adjusting your filters or search term'
                    : 'Have your AI agent call the context_memory_save tool in your project to save commands, configs, and notes.'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          filteredMemories.map((memory) => {
            const Icon = getCategoryIcon(memory.category);
            return (
              <div
                key={memory.id}
                className="group rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-all hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <div className="flex items-start justify-between">
                  <div className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                      <Icon className="h-5 w-5 text-accent-foreground" />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <span className={`rounded-md px-2 py-1 text-xs font-medium ${getCategoryColor(memory.category)}`}>
                          {memory.category}
                        </span>
                        <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                          {memory.key}
                        </h3>
                      </div>
                      <pre className="whitespace-pre-wrap break-all rounded-lg bg-zinc-50 p-3 font-mono text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {memory.value}
                      </pre>
                      <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-500">
                        {!currentProject && (
                          <>
                            <span className="font-medium">{memory.project_path.split('/').pop()}</span>
                            <span>•</span>
                          </>
                        )}
                        <span>Updated {new Date(memory.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => handleEdit(memory)}
                      className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(memory.key, memory.project_path)}
                      className="rounded-lg p-2 text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add/Edit Dialog */}
      {isAddDialogOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-xs font-medium">
                  {currentProject ? currentProject.split('/').pop() : 'PROJECT'}
                </span>
                <span className="text-zinc-400">›</span>
                <span className="text-zinc-700 dark:text-zinc-300">
                  {editingId ? 'Edit memory' : 'New memory'}
                </span>
              </div>
              <button
                onClick={() => {
                  setIsAddDialogOpen(false);
                  setEditingId(null);
                  setEditingProjectPath(null);
                  setFormData({ key: '', value: '', category: 'note' });
                }}
                className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              <input
                type="text"
                value={formData.key}
                onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                placeholder="Memory key (e.g., run_tests)"
                autoFocus
                className="w-full text-lg font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 bg-transparent border-none outline-none"
              />
              <textarea
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                placeholder="Value (e.g., npm test)"
                rows={4}
                className="w-full text-sm text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-400 bg-transparent border-none outline-none resize-none"
              />
            </div>

            {/* Property Pills */}
            <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value as 'command' | 'config' | 'note' })}
                  className="h-7 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                >
                  <option value="command">Command</option>
                  <option value="config">Config</option>
                  <option value="note">Note</option>
                </select>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
              <button
                onClick={() => {
                  setIsAddDialogOpen(false);
                  setEditingId(null);
                  setEditingProjectPath(null);
                  setFormData({ key: '', value: '', category: 'note' });
                }}
                className="px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.key || !formData.value}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingId ? 'Update Memory' : 'Create Memory'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={isConfirmDeleteOpen}
        onClose={() => setIsConfirmDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Memory"
        message="Are you sure you want to delete this memory item? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}
