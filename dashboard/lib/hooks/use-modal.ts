import { useState, useCallback } from 'react';

/**
 * Hook for managing modal/dialog state with optional associated data.
 * Combines open state and data into a single atomic interface.
 *
 * @example
 * // Simple modal (no data)
 * const addModal = useModal();
 * addModal.open();
 * <Dialog open={addModal.isOpen} onOpenChange={addModal.setOpen} />
 *
 * @example
 * // Modal with data (e.g., delete confirmation)
 * const deleteModal = useModal<Issue>();
 * deleteModal.open(issueToDelete);
 * <Dialog open={deleteModal.isOpen}>
 *   {deleteModal.data && <p>Delete {deleteModal.data.title}?</p>}
 * </Dialog>
 */
export function useModal<T = undefined>() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<T | null>(null);

  const open = useCallback((modalData?: T) => {
    if (modalData !== undefined) {
      setData(modalData);
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Clear data after a short delay to allow exit animations
    setTimeout(() => setData(null), 150);
  }, []);

  // For Dialog onOpenChange prop
  const setOpen = useCallback((open: boolean) => {
    if (open) {
      setIsOpen(true);
    } else {
      close();
    }
  }, [close]);

  return {
    isOpen,
    data,
    open,
    close,
    setOpen,
    setData,
  };
}

export type UseModalReturn<T = undefined> = ReturnType<typeof useModal<T>>;
