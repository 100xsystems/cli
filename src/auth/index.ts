import fs from 'fs';
import path from 'path';
import { authenticateWithDeviceFlow } from './device-auth.js';
import type { AuthResult } from './device-auth.js';

// ─── Token Storage ──────────────────────────────────────────────────

const AUTH_DIR = () => path.resolve(process.env.HOME || process.env.USERPROFILE || '~', '.100x');
const AUTH_FILE = () => path.join(AUTH_DIR(), 'auth.json');

interface AuthToken {
  accessToken: string;
  tokenType: string;
  scope: string;
  expiresAt?: number;
  createdAt: string;
  user?: {
    login: string;
    name: string;
    email: string;
    avatarUrl: string;
  };
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Ensure the user is authenticated with GitHub.
 * Returns the access token and username.
 *
 * Strategy:
 *   1. Check cached token on disk
 *   2. If valid, return cached token
 *   3. Otherwise, authenticate via GitHub Device Flow (opens browser)
 *   4. Cache the new token and return
 */
export async function ensureAuthenticated(): Promise<{ token: string; user: string }> {
  const cached = loadCachedToken();
  if (cached?.accessToken) {
    if (cached.expiresAt && cached.expiresAt < Date.now()) {
      // Token expired — re-authenticate
      return authenticateFresh();
    }
    return { token: cached.accessToken, user: cached.user?.login || 'unknown' };
  }

  return authenticateFresh();
}

/**
 * Authenticate from scratch using Device Flow (browser-based).
 */
async function authenticateFresh(): Promise<{ token: string; user: string }> {
  let result: AuthResult;

  try {
    result = await authenticateWithDeviceFlow();
  } catch (err) {
    throw new Error(
      `GitHub authentication failed.\n` +
      `  ${(err as Error).message}`
    );
  }

  // Cache the token with full user info
  saveTokenFromAuth(result.token, result.user, result.userInfo);

  return { token: result.token, user: result.user };
}

/**
 * Clear the cached authentication token from disk.
 */
export function clearAuth(): void {
  try {
    const authFile = AUTH_FILE();
    if (fs.existsSync(authFile)) {
      fs.unlinkSync(authFile);
    }
  } catch {
    // Ignore — best effort cleanup
  }
}

/**
 * Check if the user is currently authenticated (has cached token).
 * Does NOT verify the token is still valid with GitHub.
 */
export function isAuthenticated(): boolean {
  const cached = loadCachedToken();
  return cached !== null && !!cached.accessToken;
}

/**
 * Get cached user info without authenticating or making network requests.
 */
export function getCachedUser(): { login: string; name: string } | null {
  const cached = loadCachedToken();
  if (!cached?.user) return null;
  return { login: cached.user.login, name: cached.user.name };
}

// ─── Internal Helpers ───────────────────────────────────────────────

function loadCachedToken(): AuthToken | null {
  try {
    const authFile = AUTH_FILE();
    if (!fs.existsSync(authFile)) return null;
    const raw = fs.readFileSync(authFile, 'utf-8');
    return JSON.parse(raw) as AuthToken;
  } catch {
    return null;
  }
}

function saveTokenFromAuth(
  accessToken: string,
  login: string,
  userInfo?: { login: string; name: string; email: string; avatarUrl: string }
): void {
  try {
    const authDir = AUTH_DIR();
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const authToken: AuthToken = {
      accessToken,
      tokenType: 'bearer',
      scope: 'user:email',
      createdAt: new Date().toISOString(),
      user: {
        login: userInfo?.login || login,
        name: userInfo?.name || login,
        email: userInfo?.email || '',
        avatarUrl: userInfo?.avatarUrl || '',
      },
    };

    const authFile = AUTH_FILE();
    fs.writeFileSync(authFile, JSON.stringify(authToken, null, 2), 'utf-8');
    // Restrictive permissions — only owner can read
    fs.chmodSync(authFile, 0o600);
  } catch {
    // Best effort — non-critical
  }
}
