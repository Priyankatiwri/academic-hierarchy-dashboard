const { google } = require('googleapis');

function buildDriveClient(authClient) {
  return google.drive({ version: 'v3', auth: authClient });
}

/** Submissions are files dropped directly into a Task's Drive folder, named after their group. */
async function listFilesInFolder(drive, folderId) {
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name, createdTime, webViewLink)',
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * Removes every non-owner permission from a folder — the closest available approximation of
 * "revoke student access," since individual student identities aren't tracked anywhere in this
 * app (group identity is just a filename-derived string). Never touches the owner/organizer
 * role, and `protectedEmail` (the connected account) is skipped even if its role looks
 * unexpected — defense in depth against ever locking the Prof out. One permission failing to
 * revoke doesn't abort the rest; each attempt is reported individually so the caller can log
 * exactly what happened.
 */
async function revokeNonOwnerPermissions(drive, folderId, protectedEmail) {
  const listRes = await drive.permissions.list({
    fileId: folderId,
    fields: 'permissions(id, role, type, emailAddress)',
    supportsAllDrives: true
  });
  const permissions = listRes.data.permissions || [];

  const results = [];
  for (const p of permissions) {
    if (p.role === 'owner' || p.role === 'organizer') continue;
    if (protectedEmail && p.emailAddress && p.emailAddress.toLowerCase() === protectedEmail.toLowerCase()) continue;

    try {
      await drive.permissions.delete({ fileId: folderId, permissionId: p.id, supportsAllDrives: true });
      results.push({ ok: true, id: p.id, type: p.type, emailAddress: p.emailAddress || null });
    } catch (err) {
      results.push({ ok: false, id: p.id, type: p.type, emailAddress: p.emailAddress || null, error: err.message });
    }
  }
  return results;
}

module.exports = { buildDriveClient, listFilesInFolder, revokeNonOwnerPermissions };
