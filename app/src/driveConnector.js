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

module.exports = { buildDriveClient, listFilesInFolder };
