// Device Auth Types (RFC 8628)
// ====================

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token?: string;
  api_key?: string;
  key_prefix?: string;
  user_id?: string;
  email?: string;
  provider?: string;  // OAuth provider (google, github)
  error?: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied';
}

export interface DeviceAuthResult {
  success: boolean;
  apiKey?: string;
  keyPrefix?: string;
  userId?: string;
  email?: string;
  provider?: string;  // OAuth provider (google, github)
  error?: string;
}

export interface DeviceFlowOptions {
  /** Callback when device code is received */
  onCodeReceived: (userCode: string, verificationUri: string) => void;
  /** Optional callback during polling */
  onPolling?: () => void;
  /** Whether to save credentials to disk (default: true) */
  saveCredentials?: boolean;
}

// ====================
// Status Cache Types
// ====================

/**
 * Session info stored in status cache for Claude Code status line
 */
export interface StatusCacheEntry {
  sessionId: string;
  sessionName: string;
  projectPath: string;
  timestamp: number;
  provider?: string;
  itemCount?: number;
  sessionStatus?: 'active' | 'paused' | 'completed';
}
