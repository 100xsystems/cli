/**
 * Shared configuration for the 100xSystems CLI.
 */

/**
 * Base URL for the 100xSystems API server.
 * Uses www. subdomain to avoid cross-origin redirect that strips
 * the Authorization header in Node.js fetch().
 * (100xsystems.dev → 307 redirect → www.100xsystems.dev drops auth headers)
 */
export const API_BASE_URL = 'https://www.100xsystems.dev';
