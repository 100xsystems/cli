/**
 * GitHub Authentication — Device Authorization Flow
 *
 * Uses GitHub's OAuth Device Flow (the industry standard for CLI tools).
 * Same approach as `gh`, `npm`, `heroku`, etc.
 *
 * Flow:
 *   1. POST to GitHub's device code endpoint → get device_code + user_code
 *   2. Open browser with code pre-filled (user just clicks "Authorize")
 *   3. Poll GitHub for token until user approves
 *   4. Fetch user info from GitHub API
 *   5. Done — no local server, no proxy, no state parameters
 */

import open from 'open';

const GITHUB_API_URL = 'https://api.github.com';

// ─── Auth Result ────────────────────────────────────────────────────

export interface AuthResult {
  token: string;
  user: string;
  userInfo?: {
    login: string;
    name: string;
    email: string;
    avatarUrl: string;
  };
}

// ─── Device Authorization Flow ──────────────────────────────────────

export async function authenticateWithDeviceFlow(): Promise<AuthResult> {
  // Use a public GitHub OAuth client ID (no secret needed for device flow)
  const clientId = process.env.GITHUB_CLIENT_ID || 'Ov23li0E1qp01QZyjXX3';
  const scope = 'user:email';

  console.log('');
  console.log(`  ${'→'.padEnd(3)} Opening browser for GitHub authorization...`);

  // Step 1: Request device code from GitHub
  const deviceResponse = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope }),
  });

  if (!deviceResponse.ok) {
    throw new Error(`GitHub device auth error: ${await deviceResponse.text()}`);
  }

  const deviceData: any = await deviceResponse.json();

  if (deviceData.error) {
    throw new Error(`GitHub error: ${deviceData.error_description || deviceData.error}`);
  }

  // Step 2: Open browser with code pre-filled (seamless UX — user just clicks authorize)
  const directUrl = `https://github.com/login/device?user_code=${deviceData.user_code}`;
  try {
    await open(directUrl, { wait: false });
    console.log(`  ${'→'.padEnd(3)} Browser opened. Click "Authorize" to continue.`);
  } catch {
    // Fallback: show URL + code for manual entry
    console.log(`  ${'→'.padEnd(3)} Open this URL in your browser:`);
    console.log(`     ${deviceData.verification_uri}`);
    console.log(`  ${'→'.padEnd(3)} Enter code: ${deviceData.user_code}`);
  }

  console.log(`  ${'→'.padEnd(3)} Waiting for authorization...`);

  // Step 3: Poll for token
  const interval = (deviceData.interval || 5) * 1000;
  let attempts = 0;
  const maxAttempts = 60; // 5 minute timeout max

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
      // Fetch user info
      const ghUser = await fetchGitHubUser(tokenData.access_token);
      const userInfo: AuthResult['userInfo'] = {
        login: ghUser.login,
        name: ghUser.name || ghUser.login,
        email: ghUser.email || '',
        avatarUrl: ghUser.avatar_url || '',
      };

      console.log(`  ${'→'.padEnd(3)} Authorized as ${ghUser.login}\n`);

      return { token: tokenData.access_token, user: ghUser.login, userInfo };
    }

    if (tokenData.error === 'authorization_pending') {
      // Normal — user hasn't approved yet
      if (attempts % 6 === 0) process.stdout.write('  Still waiting...\n');
    } else if (tokenData.error === 'slow_down') {
      // GitHub asks us to slow down polling
      await sleep(interval);
    } else if (tokenData.error === 'expired_token') {
      throw new Error('Authorization code expired. Please run the command again.');
    } else if (tokenData.error === 'access_denied') {
      throw new Error('Authorization was denied. Please run the command again to retry.');
    }
  }

  throw new Error('Authorization timed out after 5 minutes. Please try again.');
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
