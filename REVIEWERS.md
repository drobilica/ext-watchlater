# AMO reviewer notes

## What this add-on does

**WatchLater Cleaner for YT** removes videos from the signed-in user’s **YouTube Watch Later** playlist when the video’s **upload date** is older than 6, 12, or 24 months.

The UI is the toolbar popup. The content script does not inject a page overlay. A non-persistent background script only updates the toolbar badge during a run.

It does this by clicking YouTube’s own playlist ⋮ → **Remove from Watch later** control. It does not call the YouTube Data API, does not send data off the device, and does not unlike videos.

YouTube’s UI must be in **English** for the Remove menu item to be found.

Desktop Firefox only. Not supported on Android. There is no `gecko_android` key. addons-linter may warn that Android 140 predates `data_collection_permissions`; ignore that and do **not** enable Firefox for Android on the listing.

## Permissions

- `host_permissions` / content script: `https://www.youtube.com/playlist*` only.
- Content script runs on playlist pages and only acts when `list=WL`. No page overlay.
- `browser_specific_settings.gecko.data_collection_permissions.required` is `["none"]`.

## How to test

1. Firefox 140+ (desktop), signed into YouTube.
2. Set YouTube language to English.
3. Open `https://www.youtube.com/playlist?list=WL`.
4. No extra UI should appear on the playlist page.
5. Click the toolbar icon. Choose **6 mo**, press **Start**. **Stop** must halt further removals.
6. The toolbar badge should show the count only while running, then clear.
7. Confirm a removed title appears in the popup list.

## How to reproduce the build

Environment used to produce the submitted XPI:

- Current Node.js LTS (CI uses `lts/*`)
- pnpm 10.15.0 (see `packageManager` in `package.json`)

```bash
pnpm install
pnpm lint:css
pnpm exec tsc --noEmit
pnpm exec addons-linter build/extension --min-manifest-version 3 --max-manifest-version 3
pnpm xpi
```

`pnpm xpi` runs Vite, then `pack.py`. The unpacked extension is `build/extension/`. The signed-submission file is `dist/clear-watch-later.xpi`.

The listed JavaScript is bundled by Vite from `src/`. Review `src/*.ts` as the source of truth. Do not treat `build/extension/src/*.js` as hand-written.

No production dependencies. Dev dependencies are fetched only from the npm registry via pnpm.

## Add-on ID

`clear-watch-later@yt-cleanup` — keep this ID for all updates.
