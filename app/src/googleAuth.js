const { google } = require('googleapis');

// Full `drive` (not `.readonly`) — revoking student permissions post-deadline is a write
// operation on the folder's ACL, which readonly can't do. Superset of readonly, so this
// covers both scanning submissions and revoking access with one scope.
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email'
];

function getOAuthClient() {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI } = process.env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error(
      'Google OAuth client not configured — set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / ' +
      'GOOGLE_OAUTH_REDIRECT_URI in .env (see credentials/README.md).'
    );
  }
  return new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI);
}

function getAuthUrl() {
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces a fresh refresh_token every sign-in, not just the first time
    scope: SCOPES
  });
}

async function exchangeCode(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google didn't return a refresh token. Revoke this app's access at " +
      'https://myaccount.google.com/permissions and sign in again.'
    );
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ auth: client, version: 'v2' });
  const { data } = await oauth2.userinfo.get();
  return { email: data.email, refreshToken: tokens.refresh_token };
}

async function getAuthorizedClient(refreshToken) {
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

module.exports = { getAuthUrl, exchangeCode, getAuthorizedClient };
