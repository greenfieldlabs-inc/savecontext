import { NextResponse } from 'next/server';

// ============================================================================
// Response Types
// ============================================================================

export type ApiSuccessResponse<T = unknown> = {
  success: true;
  data: T;
};

export type ApiErrorResponse = {
  success: false;
  error: string;
};

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Create a standardized success response.
 * @param data The data to return
 * @param status HTTP status code (default: 200)
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

/**
 * Create a standardized error response.
 * @param error Error message
 * @param status HTTP status code (default: 400)
 */
export function apiError(error: string, status = 400): NextResponse<ApiErrorResponse> {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * Create a 404 not found error response.
 */
export function apiNotFound(resource = 'Resource'): NextResponse<ApiErrorResponse> {
  return apiError(`${resource} not found`, 404);
}

/**
 * Create a 500 internal server error response.
 */
export function apiServerError(message = 'Internal server error'): NextResponse<ApiErrorResponse> {
  return apiError(message, 500);
}

// ============================================================================
// Request Helpers
// ============================================================================

/**
 * Safely parse JSON from a request body.
 * Returns the parsed body or a NextResponse error for invalid JSON.
 */
export async function parseJsonBody<T = unknown>(request: Request): Promise<T | NextResponse> {
  try {
    const body = await request.json();
    return body as T;
  } catch {
    return apiError('Invalid JSON in request body', 400);
  }
}

/**
 * Type guard to check if parseJsonBody returned an error response.
 */
export function isJsonError(result: unknown): result is NextResponse {
  return result instanceof NextResponse;
}
