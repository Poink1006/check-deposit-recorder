'use strict';

/**
 * config.js — embedded Supabase connection for the office's shared database.
 *
 * These are safe to ship in the app: the URL is public, and the publishable
 * key is designed to live in clients. Data is protected by Row-Level Security
 * that requires an authenticated user — so this key alone is useless to anyone
 * who extracts it from the installer; they'd still need the shared login.
 */

module.exports = {
  SUPABASE_URL: 'https://tttizooecbjbvcdaigft.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_CUz7USrGQO6AWTLjJLlNUg_y9L5lLtE',
};
