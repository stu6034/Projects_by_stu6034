/**
 * GVCS Student Hub — Google Apps Script server entry points.
 *
 * Deploy this project as a Web app (Execute as: user accessing the web app)
 * and give the intended audience access. App state is stored per signed-in user
 * in UserProperties. This lets the static prototype keep working locally while
 * transparently syncing when it is hosted by Apps Script.
 */
const GVCS_STATE_KEY = 'gvcs.studentHub.state.v1';
const GVCS_BACKEND_URL_KEY = 'GVCS_BACKEND_BASE_URL';
const GVCS_BACKEND_TOKEN_KEY = 'GVCS_BACKEND_TOKEN';
const GVCS_UPLOAD_FOLDER_KEY = 'GVCS_UPLOAD_FOLDER_ID';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('GVCS Student Hub')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Returns the current user's saved application state, or null on first use. */
function getAppState() {
  const raw = PropertiesService.getUserProperties().getProperty(GVCS_STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** Saves a JSON-safe application state for the signed-in user. */
function saveAppState(nextState) {
  if (!nextState || typeof nextState !== 'object') {
    throw new Error('A valid application state is required.');
  }
  PropertiesService.getUserProperties().setProperty(GVCS_STATE_KEY, JSON.stringify(nextState));
  return { savedAt: new Date().toISOString() };
}

/**
 * Saves an attachment in the configured Drive folder and returns safe metadata.
 * Set GVCS_UPLOAD_FOLDER_ID in Script Properties before enabling uploads.
 */
function uploadAttachment(file) {
  if (!file || !file.name || !file.base64) {
    throw new Error('A file name and base64 content are required.');
  }
  const folderId = PropertiesService.getScriptProperties().getProperty(GVCS_UPLOAD_FOLDER_KEY);
  if (!folderId) {
    throw new Error('Uploads are not configured. Set GVCS_UPLOAD_FOLDER_ID in Script Properties.');
  }
  const bytes = Utilities.base64Decode(file.base64);
  const blob = Utilities.newBlob(bytes, file.mimeType || 'application/octet-stream', file.name);
  const driveFile = DriveApp.getFolderById(folderId).createFile(blob);
  return { id: driveFile.getId(), name: driveFile.getName(), mimeType: driveFile.getMimeType(), url: driveFile.getUrl() };
}

/**
 * Optional secure proxy to an existing API.
 * Configure GVCS_BACKEND_BASE_URL (and optionally GVCS_BACKEND_TOKEN) in Script
 * Properties. Only relative paths are accepted, so callers cannot use this as
 * an open proxy.
 */
function requestBackend(path, options) {
  if (!/^\/[A-Za-z0-9_\-./?=&%]*$/.test(path || '')) {
    throw new Error('Only relative API paths are allowed.');
  }
  const baseUrl = PropertiesService.getScriptProperties().getProperty(GVCS_BACKEND_URL_KEY);
  if (!baseUrl) {
    throw new Error('No backend is configured. Set GVCS_BACKEND_BASE_URL in Script Properties.');
  }
  const token = PropertiesService.getScriptProperties().getProperty(GVCS_BACKEND_TOKEN_KEY);
  const request = options || {};
  const headers = Object.assign({ Accept: 'application/json' }, request.headers || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = UrlFetchApp.fetch(baseUrl.replace(/\/$/, '') + path, {
    method: request.method || 'get',
    contentType: request.contentType || 'application/json',
    payload: request.body ? JSON.stringify(request.body) : undefined,
    headers: headers,
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Backend request failed (' + status + '): ' + body.slice(0, 300));
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    return { body: body };
  }
}
