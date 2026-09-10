# GVCS Student Hub

A Google Apps Script–ready student workspace prototype. It provides local-first study guides, editable announcements, community chats, campus utilities, and daily trivia.

## Run locally

Open `index.html` in a browser or serve the repository with any static web server. The app works offline and stores its prototype state in the browser's `localStorage` key `gvcs-student-hub-v2`.

## Deploy as a Google Apps Script web app

1. Create a new Google Apps Script project.
2. Add the repository's `Code.gs`, `appsscript.json`, and `index.html` files to the project. Keep the HTML file name as **index**.
3. In **Project Settings**, choose the V8 runtime if it is not already enabled.
4. Deploy with **Deploy → New deployment → Web app**. Select an access policy appropriate for the school. For individual student state, choose **Execute as: User accessing the web app**.
5. Authorize the requested services. Apps Script uses User Properties for user state and Drive only when attachment uploads are configured.

When hosted by Apps Script, the browser automatically hydrates from `getAppState()` and syncs state using `saveAppState()`. If the Apps Script bridge is unavailable, the same page remains usable with local browser storage.

## Configure Drive uploads

1. Create a Drive folder for announcement attachments.
2. In **Project Settings → Script properties**, add `GVCS_UPLOAD_FOLDER_ID` with that folder's ID.
3. Ensure users who need uploaded files have the required Drive access.

The client sends the selected attachment to `uploadAttachment()` only when the app is running in Apps Script. The server returns Drive file metadata and a Drive URL. Consider adding school-specific permission checks before production deployment.

## Connect an existing API server

`Code.gs` includes `requestBackend(path, options)`, an Apps Script server-side proxy for an existing HTTPS API. This prevents browser CORS restrictions and keeps an optional bearer token off the client.

1. Set `GVCS_BACKEND_BASE_URL` in Script Properties, for example `https://api.example.edu`.
2. Optionally set `GVCS_BACKEND_TOKEN` in Script Properties.
3. Call `google.script.run.requestBackend('/v1/endpoint', { method: 'post', body: { ... } })` from a client feature, or add dedicated server methods that call `requestBackend`.

Only relative paths are accepted by the proxy, so the configured base URL cannot be bypassed by a browser caller. For production, use dedicated API methods with validation and authorization rather than exposing a general-purpose client API.

## Production notes

* `UserProperties` is suitable for a small per-user prototype, but a shared school deployment should use a database or authenticated API for announcements and chat.
* Community chat is persisted per browser/user in this prototype; real-time multi-user chat requires a backend service, polling, or a WebSocket-capable provider.
* Review Google Workspace access controls, Drive sharing, retention rules, moderation, and student privacy requirements before deploying to students.
