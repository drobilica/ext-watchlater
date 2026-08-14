# Clear Watch Later

Firefox add-on that removes videos from **Watch Later** when the video is older than 6, 12, or 24 months.

YouTube does not show when you saved a video. This uses the **upload date** on each row. It clicks YouTube’s own **Remove from Watch later** control. Nothing is sent off your machine.

Desktop Firefox 140+ only. YouTube UI must be in English. Not for Android, and it does not unlike videos.

## Install

The add-on is unsigned until it is listed or self-distributed from AMO.

1. Build with `pnpm xpi` (see below), or grab a release XPI when one exists.
2. Firefox → `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on…** → `dist/clear-watch-later.xpi`
4. Open [Watch Later](https://www.youtube.com/playlist?list=WL) and refresh.

Restarting Firefox unloads a temporary add-on. Load the file again to continue.

## Use

Pick **6 / 12 / 24 mo**, then **Start**. The same button becomes **Stop**. The last five removed titles stay in the list under the button.

Removals cannot be undone.

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
git tag v2.5.0
git push origin v2.5.0
```

GitHub Actions builds two files on the release (and as workflow artifacts):

- `clear-watch-later-<version>.xpi` — upload this to AMO
- `clear-watch-later-<version>-source.zip` — AMO source submission (Vite output is bundled)

You can also run the **release** workflow by hand from the Actions tab.

## Privacy

No accounts, analytics, or network calls. Firefox data-collection permission is `none`. Host access is `https://www.youtube.com/playlist*` only; the panel mounts only on `list=WL`.

Add-on ID: `clear-watch-later@yt-cleanup`.

## License

[MIT](LICENSE)

AMO reviewers: see [REVIEWERS.md](REVIEWERS.md).
