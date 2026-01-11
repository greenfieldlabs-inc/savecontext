import { useEffect, type RefObject } from 'react';

/**
 * Hook that detects clicks outside of specified element(s) and calls a callback.
 *
 * @param refs - Single ref or array of refs to elements that should NOT trigger the callback
 * @param callback - Function to call when clicking outside the ref element(s)
 * @param enabled - Optional flag to enable/disable the listener (default: true)
 *
 * @example
 * // Single ref
 * const dropdownRef = useRef<HTMLDivElement>(null);
 * useClickOutside(dropdownRef, () => setIsOpen(false));
 *
 * @example
 * // Multiple refs (e.g., dropdown + trigger button)
 * const dropdownRef = useRef<HTMLDivElement>(null);
 * const buttonRef = useRef<HTMLButtonElement>(null);
 * useClickOutside([dropdownRef, buttonRef], () => setIsOpen(false));
 *
 * @example
 * // Conditionally enabled
 * useClickOutside(ref, () => setIsOpen(false), isOpen);
 */
export function useClickOutside(
  refs: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[],
  callback: () => void,
  enabled: boolean = true
): void {
  useEffect(() => {
    if (!enabled) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const refArray = Array.isArray(refs) ? refs : [refs];

      // Check if click is inside any of the refs
      const isInside = refArray.some(
        (ref) => ref.current && ref.current.contains(target)
      );

      if (!isInside) {
        callback();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [refs, callback, enabled]);
}
