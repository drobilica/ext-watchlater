# AMO reviewer notes

## What this add-on does

It removes videos from the signed-in user’s **YouTube Watch Later** playlist when the video’s **upload date** is older than 6, 12, or 24 months.

It does this by clicking YouTube’s own playlist ⋮ → **Remove from Watch later** control. It does not call the YouTube Data API, does not send data off the device, and does not unlike videos.

YouTube’s UI must be in **English** for the Remove menu item to be found.

Desktop Firefox only. Not supported on Android. There is no `gecko_android` key. addons-linter may warn that Android 140 predates `data_collection_permissions`; ignore that and do **not** enable Firefox for Android on the listing.

## Permissions

- `host_permissions` / content script: `https://www.youtube.com/playlist*` only.
- The panel is mounted only when `list=WL`.
- `browser_specific_settings.gecko.data_collection_permissions.required` is `["none"]`.

## How to test

1. Firefox 140+ (desktop), signed into YouTube.
2. Set YouTube language to English.
3. Open `https://www.youtube.com/playlist?list=WL`.
4. The panel should appear only on that playlist, not on Home or Watch.
5. Choose **6 mo**, press **Start**. **Stop** must halt further removals.
6. Confirm a removed title appears in the reserved list under the button.

## How to reproduce the build

Environment used to produce the submitted XPI:

- Node.js 22.x
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
