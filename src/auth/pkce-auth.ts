import http from 'http';
import crypto from 'crypto';
import open from 'open';

// ─── Configuration ──────────────────────────────────────────────────

const AUTH_PROXY_BASE = 'https://100xsystems.dev';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

// ─── PKCE Helpers ───────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ─── Find an available port on localhost ────────────────────────────

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'string' ? 0 : address?.port || 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// ─── Auth Result ────────────────────────────────────────────────────

export interface AuthResult {
  token: string;
  user: string;
  /** Full user info from GitHub API, if available */
  userInfo?: {
    login: string;
    name: string;
    email: string;
    avatarUrl: string;
  };
}

// ─── Main PKCE Loopback Auth ────────────────────────────────────────

/**
 * Authenticate with GitHub using PKCE OAuth 2.0 Authorization Code Flow.
 *
 * Flow:
 *   1. Start a local HTTP server on a random port
 *   2. Open the browser to the Vercel auth proxy with PKCE challenge
 *   3. The proxy redirects to GitHub for user authorization
 *   4. GitHub redirects back to the proxy with an auth code
 *   5. The proxy exchanges the code for a token (using server-side client_secret)
 *   6. The proxy redirects back to our local server with the token
 *   7. We capture the token and close the server
 *
 * This is the preferred auth method for desktop environments.
 */
export async function authenticateWithPKCE(): Promise<AuthResult> {
  const port = await getAvailablePort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Generate PKCE challenge + CSRF state token
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    // ── 1. Start local callback server ───────────────────────────
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '', `http://${req.headers.host}`);

      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      // Validate state to prevent CSRF attacks
      const returnedState = reqUrl.searchParams.get('state');

      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="font-family:sans-serif;text-align:center;padding-top:50px;background:#0B0F19;color:#fff;">
            <h1 style="color:#ef4444;">✗ Security check failed</h1>
            <p style="color:#9CA3AF;">State parameter mismatch — possible CSRF attack detected.</p>
            <p style="color:#9CA3AF;">Please try authenticating again from the terminal.</p>
          </body></html>
        `);
        server.close();
        reject(new Error('State mismatch — possible CSRF attack detected.'));
        return;
      }

      // Capture the token from the redirect
      const token = reqUrl.searchParams.get('token');
      const user = reqUrl.searchParams.get('user') || '';
      const errorParam = reqUrl.searchParams.get('error');

      if (errorParam) {
        // Show error in browser
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="font-family:sans-serif;text-align:center;padding-top:50px;background:#0B0F19;color:#fff;">
            <h1 style="color:#ef4444;">✗ Authentication Failed</h1>
            <p style="color:#9CA3AF;">${escapeHtml(errorParam)}</p>
            <p style="color:#9CA3AF;">Please try again from the terminal.</p>
          </body></html>
        `);
        server.close();
        reject(new Error(errorParam));
        return;
      }

      if (!token) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="font-family:sans-serif;text-align:center;padding-top:50px;background:#0B0F19;color:#fff;">
            <h1 style="color:#ef4444;">✗ No token received</h1>
            <p style="color:#9CA3AF;">The authorization server did not return a token.</p>
          </body></html>
        `);
        server.close();
        reject(new Error('No token received from auth proxy.'));
        return;
      }

      // Success! Show confirmation in browser
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding-top:50px;background:#0B0F19;color:#fff;">
          <h1 style="color:#00F2FE;">✓ Authenticated successfully!</h1>
          <p style="color:#9CA3AF;">${user ? `Signed in as <strong>${escapeHtml(user)}</strong>.` : ''}</p>
          <p style="color:#9CA3AF;">You can close this window and return to the terminal.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body></html>
      `);

      server.close();

      // Fetch full user info to enrich the cache
      let login = user;
      let userInfo: AuthResult['userInfo'] = undefined;

      try {
        const ghUser = await fetchGitHubUser(token);
        login = ghUser.login;
        userInfo = {
          login: ghUser.login,
          name: ghUser.name || ghUser.login,
          email: ghUser.email || '',
          avatarUrl: ghUser.avatar_url || '',
        };
      } catch {
        if (!login) login = 'unknown';
      }

      resolve({ token, user: login, userInfo });
    });

    // ── 2. Start listening and open browser ──────────────────────
    server.listen(port, '127.0.0.1', async () => {
      // Build the auth URL pointing to our Vercel proxy
      const authUrl = new URL(`${AUTH_PROXY_BASE}/api/auth/github`);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('state', state);

      console.log(`\n  ${'→'.padEnd(3)} Opening browser for GitHub authentication...\n`);

      try {
        await open(authUrl.href, { wait: false });
      } catch {
        // Fallback: show the URL
        console.log(`  ${'→'.padEnd(3)} Open this URL in your browser:`);
        console.log(`     ${authUrl.href}\n`);
      }

      console.log(`  ${'→'.padEnd(3)} Waiting for authorization...`);
    });

    // ── 3. Timeout after 5 minutes ───────────────────────────────
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out. Please try again.'));
    }, 5 * 60 * 1000);
  });
}

// ─── Device Flow Fallback ───────────────────────────────────────────

/**
 * Fallback authentication using GitHub Device Flow.
 * Used when the PKCE loopback is not possible (headless environments).
 */
export async function authenticateWithDeviceFlow(): Promise<AuthResult> {
  const clientId = process.env.GITHUB_CLIENT_ID || 'Ov23li0E1qp01QZyjXX3';
  const scope = 'repo,user:email';

  console.log('\n  ' + '─'.repeat(40));
  console.log('  GitHub Authentication (Device Flow)');
  console.log('  ' + '─'.repeat(40) + '\n');

  // Step 1: Request device code
  const deviceResponse = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope }),
  });

  if (!deviceResponse.ok) {
    throw new Error(`Failed to start device auth: ${await deviceResponse.text()}`);
  }

  const deviceData: any = await deviceResponse.json();

  if (deviceData.error) {
    throw new Error(`Device auth error: ${deviceData.error_description || deviceData.error}`);
  }

  // Step 2: Display code and open browser
  console.log(`  ${'→'.padEnd(3)} Go to: ${deviceData.verification_uri}`);
  console.log(`  ${'→'.padEnd(3)} Enter code: \x1b[1m${deviceData.user_code}\x1b[22m\n`);

  // Try to open the direct URL
  try {
    await open(`https://github.com/login/device?user_code=${deviceData.user_code}`, { wait: false });
    console.log(`  ${'→'.padEnd(3)} Browser opened automatically.`);
  } catch {
    console.log(`  ${'→'.padEnd(3)} Or open: https://github.com/login/device?user_code=${deviceData.user_code}`);
  }

  console.log(`\n  ${'→'.padEnd(3)} Waiting for authorization...`);

  // Step 3: Poll for token
  const interval = (deviceData.interval || 5) * 1000;
  let attempts = 0;
  const maxAttempts = 60;

  while (attempts < maxAttempts) {
    await sleep(interval);
    attempts++;

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceData.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!tokenResponse.ok) continue;

    const tokenData: any = await tokenResponse.json();

    if (tokenData.access_token) {
      const ghUser = await fetchGitHubUser(tokenData.access_token);
      const userInfo: AuthResult['userInfo'] = {
        login: ghUser.login,
        name: ghUser.name || ghUser.login,
        email: ghUser.email || '',
        avatarUrl: ghUser.avatar_url || '',
      };
      return { token: tokenData.access_token, user: ghUser.login, userInfo };
    }

    if (tokenData.error === 'authorization_pending') {
      if (attempts % 6 === 0) process.stdout.write('  Still waiting...\n');
    } else if (tokenData.error === 'slow_down') {
      await sleep(interval);
    } else if (tokenData.error === 'expired_token') {
      throw new Error('Device code expired. Please try again.');
    } else if (tokenData.error === 'access_denied') {
      throw new Error('Authorization denied by user.');
    }
  }

  throw new Error('Authentication timed out. Please try again.');
}

// ─── Helpers ────────────────────────────────────────────────────────

async function fetchGitHubUser(token: string): Promise<any> {
  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': '100xsystems-cli',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.statusText}`);
  }

  return response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
