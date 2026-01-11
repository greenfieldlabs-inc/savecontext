'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type EventType = 'issue' | 'session' | 'memory' | 'plan' | 'context';

// Global refresh counter that can be subscribed to
let globalRefreshCounter = 0;
const listeners = new Set<() => void>();

function notifyListeners() {
  globalRefreshCounter++;
  listeners.forEach(fn => fn());
}

export function useRefreshCounter(): number {
  const [counter, setCounter] = useState(globalRefreshCounter);

  useEffect(() => {
    const listener = () => setCounter(globalRefreshCounter);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return counter;
}

export function useAppEvents(eventTypes: EventType[] = ['issue', 'session', 'memory', 'plan', 'context']) {
  const router = useRouter();
  const eventSourceRef = useRef<EventSource | null>(null);
  // Stabilize eventTypes to prevent reconnects on every render
  const eventTypesKey = eventTypes.sort().join(',');

  useEffect(() => {
    const eventSource = new EventSource('/api/events');
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const types = eventTypesKey.split(',');

        // Refresh on matching event types
        if (types.includes(data.event)) {
          router.refresh();
          notifyListeners(); // Notify all subscribers to refetch
        }
      } catch {
        // Ignore parse errors for heartbeats
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [eventTypesKey]); // Only reconnect if event types actually change
}

// Convenience hooks
export function useIssueEvents() {
  useAppEvents(['issue']);
}

export function useSessionEvents() {
  useAppEvents(['session']);
}

export function useMemoryEvents() {
  useAppEvents(['memory']);
}

export function usePlanEvents() {
  useAppEvents(['plan']);
}

export function useContextEvents() {
  useAppEvents(['context']);
}
