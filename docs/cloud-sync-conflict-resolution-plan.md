# Cloud Sync Conflict Resolution Plan

## Goal

When logged-in cloud sync detects multiple-device data conflicts, stop silent overwrite/retry behavior and present explicit choices: merge local data into the remote version, or pull the remote version to overwrite local data. The conflict prompt should show a concise summary of the current remote version and what differs from this browser.

## Steps

- done: Audit cloud sync upload/login conflict behavior and identify affected frontend/worker paths.
- done: Add conflict detection helpers and merge/remote-overwrite actions to `src/app/cloudSync.js`.
- done: Update login/account UI to show conflict details and resolution buttons.
- done: Add focused tests for conflict summary and local-over-remote merge behavior.
- done: Rebuild frontend Pages artifacts and verify UI in browser.
- done: Record verification evidence and deployment notes.

## Key Decisions

- Do not silently retry a 409 upload with the current remote version; surface a resolvable conflict instead.
- Merge means remote payload plus local payload, with local values winning on keys present in both, then save the merged result back to cloud and local storage.
- Pull remote means decrypt and apply the current remote backup with `wipePrefix: true`, overwriting syncable local data.
- Conflict summaries compare local and remote backup payload keys/values and list changed, remote-only, and local-only modules.

## Open Confirmations

- None. The UI will use the requested two actions: merge local changes or pull remote to overwrite local.

## Deliverables

- Conflict-aware cloud sync helpers.
- Account menu conflict UI with remote version summary and two resolution actions.
- Tests for summary and merge semantics.
- Updated Pages bundle if frontend build succeeds.

## Verification

- `node --check src/app/cloudSync.js`: passed.
- `node --test test/cloudSyncConflict.test.mjs`: passed.
- `node --test test/dailyFundBreakdown.test.mjs`: passed.
- `node --test test/*.mjs`: passed, 9 tests.
- `npm run build`: passed; Vite built 2733 modules and `publish_react_pages.mjs` completed.
- Browser verification with local Vite + Playwright desktop viewport `1280x900`: conflict panel rendered with text `发现多端同步冲突`, remote version `v8`, buttons `合并本机` and `拉取云端`; screenshot `test-results/cloud-sync-conflict-account-menu.png`.
- Browser verification with mobile viewport `390x844`: conflict panel action buttons rendered as `合并本机 | 拉取云端`; screenshot `test-results/cloud-sync-conflict-account-menu-mobile.png`.
- `node --check src/components/account-menu.jsx` was attempted but Node cannot check `.jsx` directly (`ERR_UNKNOWN_FILE_EXTENSION`); JSX was instead verified by `npm run build`.
