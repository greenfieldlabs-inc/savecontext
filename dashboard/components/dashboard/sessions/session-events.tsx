'use client';

import { useAppEvents } from '@/lib/hooks/use-issue-events';

export function SessionEvents() {
  // Listen for both session and context events (context items are shown on session detail)
  useAppEvents(['session', 'context']);
  return null;
}
