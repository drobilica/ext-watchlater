# WatchLater Cleaner for YT

Firefox add-on that removes videos from YouTube **Watch Later** when the video is older than 6, 12, or 24 months.

YouTube does not show when you saved a video. This uses the **upload date** on each row. Removals go through YouTube’s playlist edit call so the ⋮ menu does not flash. Nothing is sent off your machine.

The only UI is the **toolbar popup**. Nothing is drawn on the YouTube page. While a run is active, the toolbar icon shows a uBlock-style count for that run only.

Desktop Firefox 140+ only. YouTube UI must be in English. Not for Android, and it does not unlike videos.

## Install

The add-on is unsigned until it is listed or self-distributed from AMO.

1. Build with `pnpm xpi` (see below), or grab a release XPI when one exists.
2. Firefox → `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on…** → `dist/clear-watch-later.xpi`
4. Open [Watch Later](https://www.youtube.com/playlist?list=WL), then click the toolbar icon.

Restarting Firefox unloads a temporary add-on. Load the file again to continue.

## Use

Click the toolbar icon. Pick **6 / 12 / 24 mo**, then **Start**. The same button becomes **Stop**. The last five removed titles stay in the list. The icon badge is the count for this run and disappears when the run ends.

Removals cannot be undone. Leave the Watch Later tab focused while it runs.

## Build

Current Node.js LTS and [pnpm](https://pnpm.io) 10.

```bash
pnpm install
pnpm lint:css
pnpm exec tsc --noEmit
pnpm xpi
```

That writes `dist/clear-watch-later.xpi`. Source of truth is `src/`. Vite emits the unpacked add-on to `build/extension/`.

## Release

Tag a version that matches `package.json` / `src/manifest.json`, then push the tag:

```bash
git tag v2.6.0
git push origin v2.6.0
```

GitHub Actions attaches `clear-watch-later-<version>.xpi` and a source zip for AMO.

## Privacy

No accounts, analytics, or network calls. Firefox data-collection permission is `none`. Host access is `https://www.youtube.com/playlist*` only.

Add-on ID: `clear-watch-later@yt-cleanup`.

## License

[MIT](LICENSE)

AMO reviewers: see [REVIEWERS.md](REVIEWERS.md).
