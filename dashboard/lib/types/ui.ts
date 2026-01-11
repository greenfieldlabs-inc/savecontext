// UI component props

import type { ReactNode, ErrorInfo } from 'react';

export interface LocalDateProps {
  date: Date | number | string;
  format?: 'date' | 'datetime';
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}
