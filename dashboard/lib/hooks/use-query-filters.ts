'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

/**
 * Hook for managing URL query parameter filters.
 * Provides a consistent way to update URL params across list views.
 *
 * @example
 * const { updateFilter, clearFilters, getFilter } = useQueryFilters();
 *
 * // Set a filter (adds to URL: ?status=active)
 * updateFilter('status', 'active');
 *
 * // Clear a filter (removes from URL)
 * updateFilter('status', null);
 *
 * // 'all' is treated as clearing the filter
 * updateFilter('status', 'all');
 *
 * // Clear multiple filters at once
 * clearFilters(['status', 'project', 'category']);
 *
 * // Get current filter value
 * const status = getFilter('status'); // returns string | null
 */
export function useQueryFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateFilter = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());

    if (value === null || value === 'all' || value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    const queryString = params.toString();
    router.push(`${pathname}${queryString ? `?${queryString}` : ''}`);
  }, [router, pathname, searchParams]);

  const clearFilters = useCallback((keys: string[]) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const key of keys) {
      params.delete(key);
    }

    const queryString = params.toString();
    router.push(`${pathname}${queryString ? `?${queryString}` : ''}`);
  }, [router, pathname, searchParams]);

  const getFilter = useCallback((key: string): string | null => {
    return searchParams.get(key);
  }, [searchParams]);

  return {
    updateFilter,
    clearFilters,
    getFilter,
    searchParams,
  };
}

export type UseQueryFiltersReturn = ReturnType<typeof useQueryFilters>;
