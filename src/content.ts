import { olderThanMonths, parseAgeDays } from "./age";
import {
  BATCH_SIZE,
  MAX_PLAYLIST_ITEMS,
  extractPlaylistPage,
  playlistEditActions,
  playlistEditSucceeded,
} from "./innertube";
import {
  type IncomingMessage,
  type Months,
  type RuntimeStatus,
  extApi,
  isMonths,
  isWatchLaterUrl,
} from "./shared";

const DELAY_MS = 400;
const BATCH_DELAY_MS = 30;
const FAIL_DELAY_MS = 400;
const POLL_MS = 60;
const SCROLL_WAIT_MS = 800;
const GONE_WAIT_MS = 2500;
const AUTH_TTL_MS = 45_000;
const MAX_MISSES = 5;

declare function cloneInto<T>(
  obj: T,
  targetScope: object,
  options?: { cloneFunctions?: boolean },
): T;

type PlaylistRendererData = {
  setVideoId?: string;
  publishedTimeText?: {
    simpleText?: string;
    accessibility?: { accessibilityData?: { label?: string } };
  };
  videoInfo?: { runs?: Array<{ text?: string }> };
};

type PageVideo = HTMLElement & {
  data?: PlaylistRendererData;
  __data?: { data?: PlaylistRendererData };
  wrappedJSObject?: {
    data?: PlaylistRendererData;
    __data?: { data?: PlaylistRendererData };
  };
};

type Target = {
  videoId: string;
  setVideoId: string | null;
  title: string;
  video?: HTMLElement;
};

const state = {
  running: false,
  stop: false,
  months: 6 as Months,
  removed: 0,
  recent: [] as string[],
  wakeLock: null as WakeLockSentinel | null,
  wakeOn: false,
  line: "Pick a window, then Start.",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function $(sel: string, root: ParentNode = document): Element | null {
  return root.querySelector(sel);
}

function $$(sel: string, root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(sel)];
}

function visible(el: Element | null): el is HTMLElement {
  return Boolean(el instanceof HTMLElement && el.offsetParent !== null);
}

function getVideos(): HTMLElement[] {
  const classic = $$("ytd-playlist-video-renderer").filter(visible);
  if (classic.length) return classic;
  return $$(
    "ytd-playlist-video-list-renderer yt-lockup-view-model, #contents yt-lockup-view-model",
  ).filter(visible);
}

function videoTitle(video: HTMLElement): string {
  const title =
    $("#video-title", video)?.textContent ||
    $("a#video-title", video)?.getAttribute("title") ||
    $("a[href*='watch']", video)?.textContent ||
    $("h3", video)?.textContent ||
    "";
  return title.replace(/\s+/g, " ").trim() || "(untitled)";
}

function rendererData(video: HTMLElement): PlaylistRendererData | null {
  try {
    const page = (video as PageVideo).wrappedJSObject ?? (video as PageVideo);
    return page.data ?? page.__data?.data ?? null;
  } catch {
    return null;
  }
}

function videoIdOf(video: HTMLElement): string | null {
  const href =
    video.querySelector<HTMLAnchorElement>("a[href*='watch?v=']")?.href ??
    video.querySelector<HTMLAnchorElement>("a#video-title")?.href ??
    "";
  if (!href) return null;
  try {
    return new URL(href, location.origin).searchParams.get("v");
  } catch {
    const match = href.match(/[?&]v=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

const ageCache = new Map<string, number | null>();
const skipIds = new Set<string>();

function firstAge(texts: Iterable<string>): number | null {
  for (const text of texts) {
    const days = parseAgeDays(text);
    if (days != null) return days;
  }
  return null;
}

function uploadAgeDays(video: HTMLElement): number | null {
  const id = videoIdOf(video);
  if (id && ageCache.has(id)) return ageCache.get(id) ?? null;

  const texts: string[] = [];
  const data = rendererData(video);
  const published = data?.publishedTimeText;
  if (published?.simpleText) texts.push(published.simpleText);
  const label = published?.accessibility?.accessibilityData?.label;
  if (label) texts.push(label);
  for (const run of data?.videoInfo?.runs ?? []) {
    if (run.text) texts.push(run.text);
  }

  let days = firstAge(texts);
  if (days == null) {
    for (const node of $$(
      [
        "#metadata-line",
        "#video-info",
        ".yt-content-metadata-view-model",
        ".yt-content-metadata-view-model__metadata-row",
        "yt-formatted-string",
        ".yt-core-attributed-string",
      ].join(","),
      video,
    )) {
      const text = node.textContent?.trim();
      if (!text) continue;
      days = parseAgeDays(text);
      if (days != null) break;
    }
  }
  if (days == null) {
    const blob = video.innerText.trim();
    if (blob) days = parseAgeDays(blob);
  }
  if (id) ageCache.set(id, days);
  return days;
}

function closeMenus(): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

function menuIconType(el: Element): string {
  try {
    const raw = (el as PageVideo).wrappedJSObject ?? (el as PageVideo);
    const data = raw.data as { icon?: { iconType?: string } } | undefined;
    return data?.icon?.iconType ?? "";
  } catch {
    return "";
  }
}

function findRemoveItem(): HTMLElement | null {
  if (!isWatchLaterUrl(location.href)) return null;
  const scopes = $$(
    "ytd-menu-popup-renderer, tp-yt-iron-dropdown:not([aria-hidden='true']), [role='menu']",
  );
  const hay = scopes.flatMap((scope) =>
    $$(
      "ytd-menu-service-item-renderer, tp-yt-paper-item, yt-list-item-view-model, [role='menuitem'], button",
      scope,
    ),
  );
  const usable: HTMLElement[] = [];
  for (const el of hay) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.offsetParent === null && el.offsetHeight === 0) continue;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length === 0 || text.length >= 80) continue;
    usable.push(el);
  }
  const byLater = usable.find((el) => /watch later/i.test(el.textContent || ""));
  if (byLater) return byLater;
  const byIcon = usable.find((el) => menuIconType(el) === "PLAYLIST_REMOVE");
  if (byIcon) return byIcon;
  return usable.find((el) => /^remove from/i.test((el.textContent || "").trim())) ?? null;
}

function menuButton(video: HTMLElement): HTMLElement | null {
  const button = $(
    [
      "#menu button",
      "#button[aria-haspopup='true']",
      "ytd-menu-renderer button",
      "button[aria-label*='Action menu']",
      "button[aria-label*='More actions']",
      "button[aria-label*='More options']",
      "button[aria-label*='Action']",
    ].join(","),
    video,
  );
  return button instanceof HTMLElement ? button : null;
}

type YtCfg = { get: (key: string) => unknown };

type InnertubeSession = {
  key: string;
  context: unknown;
  clientVersion: string;
  visitorData: string | null;
  authUser: string | null;
  pageId: string | null;
};

function pageWindow(): Window & { ytcfg?: YtCfg } {
  const view = window as Window & { wrappedJSObject?: Window & { ytcfg?: YtCfg } };
  return view.wrappedJSObject ?? view;
}

function findSetVideoId(value: unknown, depth = 0): string | null {
  if (depth > 8 || !value || typeof value !== "object") return null;
  try {
    const rec = value as Record<string, unknown>;
    if (typeof rec.setVideoId === "string" && rec.setVideoId.length > 4) return rec.setVideoId;
    for (const child of Object.values(rec)) {
      const found = findSetVideoId(child, depth + 1);
      if (found) return found;
    }
  } catch {
    return null;
  }
  return null;
}

function headerValue(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

let sessionCache: InnertubeSession | null = null;
let authCache: { header: string; until: number } | null = null;

function resetInnertubeCache(): void {
  sessionCache = null;
  authCache = null;
}

function innertubeSession(): InnertubeSession | null {
  if (sessionCache) return sessionCache;
  try {
    const ytcfg = pageWindow().ytcfg;
    const key = ytcfg?.get("INNERTUBE_API_KEY");
    const context = ytcfg?.get("INNERTUBE_CONTEXT");
    if (typeof key !== "string" || !context) return null;
    const plainContext = JSON.parse(JSON.stringify(context)) as {
      client?: { visitorData?: string; clientVersion?: string };
      user?: { sessionIndex?: string | number; onBehalfOfUser?: string };
    };
    sessionCache = {
      key,
      context: plainContext,
      clientVersion: String(plainContext.client?.clientVersion ?? ""),
      visitorData: typeof plainContext.client?.visitorData === "string" ? plainContext.client.visitorData : null,
      authUser:
        headerValue(plainContext.user?.sessionIndex) ?? headerValue(ytcfg?.get("SESSION_INDEX")),
      pageId:
        headerValue(plainContext.user?.onBehalfOfUser) ?? headerValue(ytcfg?.get("DELEGATED_SESSION_ID")),
    };
    return sessionCache;
  } catch {
    return null;
  }
}

async function sha1Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sapisidAuthorization(): Promise<string | null> {
  if (authCache && Date.now() < authCache.until) return authCache.header;
  const sapisid =
    document.cookie.match(/(?:^|;\s*)SAPISID=([^;]+)/)?.[1] ||
    document.cookie.match(/(?:^|;\s*)__Secure-3PAPISID=([^;]+)/)?.[1];
  if (!sapisid) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const hash = await sha1Hex(`${timestamp} ${sapisid} ${location.origin}`);
  const header = `SAPISIDHASH ${timestamp}_${hash}`;
  authCache = { header, until: Date.now() + AUTH_TTL_MS };
  return header;
}

type WireResult = { body: unknown } | { retry: boolean };

async function innertubeRequestOnce(path: string, payload: Record<string, unknown>): Promise<WireResult> {
  if (!isWatchLaterUrl(location.href)) return { retry: false };
  const session = innertubeSession();
  if (!session) return { retry: true };
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": "1",
      "X-YouTube-Client-Version": session.clientVersion,
    };
    if (session.visitorData) headers["X-Goog-Visitor-Id"] = session.visitorData;
    if (session.authUser != null) headers["X-Goog-AuthUser"] = session.authUser;
    if (session.pageId) headers["X-Goog-PageId"] = session.pageId;
    const authorization = await sapisidAuthorization();
    if (authorization) headers.Authorization = authorization;

    const url = `${location.origin}/youtubei/v1/${path}?prettyPrint=false&key=${encodeURIComponent(session.key)}`;
    const init = {
      method: "POST",
      credentials: "same-origin" as const,
      headers,
      body: JSON.stringify({ context: session.context, ...payload }),
    };
    const page = pageWindow();
    const request = typeof cloneInto === "function" ? cloneInto(init, page) : init;
    const response = await page.fetch(url, request);
    if (!response) return { retry: true };
    if (response.status === 429 || response.status === 503) return { retry: false };
    if (!response.ok) return { retry: true };
    return { body: JSON.parse(String(await response.text())) as unknown };
  } catch {
    return { retry: true };
  }
}

async function innertubeRequest(path: string, payload: Record<string, unknown>): Promise<unknown | null> {
  const first = await innertubeRequestOnce(path, payload);
  if ("body" in first) return first.body;
  if (!first.retry) return null;
  resetInnertubeCache();
  const second = await innertubeRequestOnce(path, payload);
  return "body" in second ? second.body : null;
}

async function removeViaPlaylistEdit(targets: Target[]): Promise<boolean> {
  if (!targets.length) return false;
  const body = await innertubeRequest("browse/edit_playlist", {
    playlistId: "WL",
    actions: playlistEditActions(targets),
  });
  return playlistEditSucceeded(body);
}

function dropRows(ids: Iterable<string>): void {
  const want = ids instanceof Set ? ids : new Set(ids);
  for (const video of getVideos()) {
    const id = videoIdOf(video);
    if (id && want.has(id)) video.remove();
  }
}

function rowFor(videoId: string): HTMLElement | null {
  return getVideos().find((row) => videoIdOf(row) === videoId) ?? null;
}

async function waitGone(videoId: string): Promise<boolean> {
  const deadline = Date.now() + GONE_WAIT_MS;
  while (Date.now() < deadline) {
    if (!getVideos().some((row) => videoIdOf(row) === videoId)) return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function clickRemove(video: HTMLElement, videoId: string): Promise<void> {
  if (!isWatchLaterUrl(location.href)) throw new Error("Left Watch Later.");
  closeMenus();
  await sleep(POLL_MS);
  const button = menuButton(video);
  if (!button) throw new Error("Could not find the ⋮ menu on this row.");
  button.click();
  const deadline = Date.now() + 2500;
  let item = findRemoveItem();
  while (!item && Date.now() < deadline) {
    await sleep(POLL_MS);
    item = findRemoveItem();
  }
  if (!item) {
    closeMenus();
    throw new Error('No "Remove from Watch later" item.');
  }
  item.click();
  if (!(await waitGone(videoId))) {
    throw new Error("Video did not leave Watch Later.");
  }
}

async function acquireWakeLock(): Promise<void> {
  state.wakeOn = false;
  if (!navigator.wakeLock?.request) return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeOn = true;
    state.wakeLock.addEventListener("release", () => {
      state.wakeOn = false;
    });
  } catch {
    state.wakeLock = null;
    state.wakeOn = false;
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    await state.wakeLock?.release();
  } catch {
    /* already released */
  }
  state.wakeLock = null;
  state.wakeOn = false;
}

function remember(title: string): void {
  state.recent = [title, ...state.recent.filter((item) => item !== title)].slice(0, 5);
}

function snapshot(): RuntimeStatus {
  return {
    running: state.running,
    months: state.months,
    removed: state.removed,
    recent: state.recent.slice(),
    wakeLock: state.wakeOn,
    line: state.line,
  };
}

function setLine(text: string): void {
  state.line = text;
}

function reportBadge(count: number | null): void {
  void extApi.runtime.sendMessage({ type: "ytc-badge", count }).catch(() => {
    /* popup-only session; badge page may be asleep */
  });
}

function markRemoved(targets: Target[]): void {
  for (const item of targets) {
    skipIds.add(item.videoId);
    remember(item.title);
    state.removed += 1;
  }
  dropRows(targets.map((item) => item.videoId));
  reportBadge(state.removed);
}

function uniqueTargets(targets: Target[]): Target[] {
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const item of targets) {
    if (!item.videoId || seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    out.push(item);
  }
  return out;
}

async function removeBatches(targets: Target[]): Promise<number> {
  const queue = uniqueTargets(targets);
  let misses = 0;
  let size = BATCH_SIZE;
  let index = 0;

  while (index < queue.length && !state.stop) {
    if (!isWatchLaterUrl(location.href)) throw new Error("Left Watch Later.");
    const batch = queue.slice(index, index + size);
    setLine(`Removing ${state.removed + batch.length} of ${state.removed + (queue.length - index)}…`);

    if (await removeViaPlaylistEdit(batch)) {
      markRemoved(batch);
      setLine(`${state.removed} removed`);
      index += batch.length;
      misses = 0;
      size = BATCH_SIZE;
      if (index < queue.length && !state.stop) await sleep(BATCH_DELAY_MS);
      continue;
    }

    if (batch.length > 1) {
      size = Math.max(1, Math.floor(batch.length / 2));
      await sleep(FAIL_DELAY_MS);
      continue;
    }

    const single = batch[0];
    const row = single.video ?? rowFor(single.videoId);
    if (row) {
      try {
        await clickRemove(row, single.videoId);
        markRemoved([single]);
        setLine(`${state.removed} removed`);
        misses = 0;
      } catch (err) {
        skipIds.add(single.videoId);
        misses += 1;
        closeMenus();
        setLine(err instanceof Error ? err.message : String(err));
        if (misses >= MAX_MISSES) throw err;
        await sleep(DELAY_MS);
      }
    } else {
      skipIds.add(single.videoId);
      misses += 1;
      setLine("Playlist edit failed for one video. Skipped.");
      if (misses >= MAX_MISSES) throw new Error("Playlist edit failed repeatedly.");
    }
    index += 1;
    size = BATCH_SIZE;
    await sleep(DELAY_MS);
  }

  return misses;
}

type ScanResult =
  | { ok: true; targets: Target[]; seen: number; dated: number; truncated: boolean }
  | { ok: false };

async function scanPlaylist(months: Months): Promise<ScanResult> {
  if (!innertubeSession()) return { ok: false };

  const targets: Target[] = [];
  const seen = new Set<string>();
  let dated = 0;
  let truncated = false;
  let page = await innertubeRequest("browse", { browseId: "VLWL" });
  if (!page) return { ok: false };

  for (let n = 0; n < 80 && !state.stop; n += 1) {
    const parsed = extractPlaylistPage(page);
    if (n === 0 && parsed.items.length === 0 && !parsed.continuation) return { ok: false };

    const nextPage =
      parsed.continuation && seen.size < MAX_PLAYLIST_ITEMS
        ? innertubeRequest("browse", { continuation: parsed.continuation })
        : null;

    for (const item of parsed.items) {
      if (seen.has(item.videoId) || skipIds.has(item.videoId)) continue;
      seen.add(item.videoId);
      const age = firstAge(item.dateTexts);
      if (age != null) dated += 1;
      if (age != null && olderThanMonths(age, months)) {
        targets.push({
          videoId: item.videoId,
          setVideoId: item.setVideoId,
          title: item.title,
        });
      }
      if (seen.size >= MAX_PLAYLIST_ITEMS) break;
    }

    setLine(`Scanning Watch Later… ${seen.size}`);
    if (!nextPage || seen.size >= MAX_PLAYLIST_ITEMS || state.stop) break;
    const next = await nextPage;
    if (!next) {
      truncated = !state.stop;
      break;
    }
    page = next;
  }

  if (seen.size === 0) return { ok: false };
  return { ok: true, targets, seen: seen.size, dated, truncated };
}

async function scrollForMore(previousCount: number): Promise<boolean> {
  const last = getVideos().at(-1);
  last?.scrollIntoView({ block: "nearest", inline: "nearest" });
  const scroller =
    $("ytd-playlist-video-list-renderer") ||
    $("#primary-inner") ||
    $("#primary");
  if (scroller instanceof HTMLElement) scroller.scrollTop += 900;
  const deadline = Date.now() + SCROLL_WAIT_MS;
  while (Date.now() < deadline) {
    if (getVideos().length > previousCount) return true;
    await sleep(POLL_MS);
  }
  return getVideos().length > previousCount;
}

function collectDomTargets(months: Months): Target[] {
  const hits: Target[] = [];
  for (const video of getVideos()) {
    const videoId = videoIdOf(video);
    if (!videoId || skipIds.has(videoId)) continue;
    const age = uploadAgeDays(video);
    if (age == null || !olderThanMonths(age, months)) continue;
    hits.push({
      videoId,
      setVideoId: findSetVideoId(rendererData(video)),
      title: videoTitle(video),
      video,
    });
  }
  return hits;
}

async function runFromDom(months: Months): Promise<void> {
  let emptyScrolls = 0;
  while (!state.stop) {
    if (!isWatchLaterUrl(location.href)) {
      setLine("Left Watch Later. Stopped.");
      return;
    }

    const videos = getVideos();
    if (!videos.length) {
      setLine("No videos on the page. Scroll the list once, then press Start.");
      return;
    }

    const hits = collectDomTargets(months);
    if (hits.length) {
      emptyScrolls = 0;
      await removeBatches(hits);
      continue;
    }

    if (await scrollForMore(videos.length)) {
      emptyScrolls = 0;
      continue;
    }
    emptyScrolls += 1;
    if (emptyScrolls >= 4) {
      setLine(
        state.removed
          ? `Done. Removed ${state.removed}.`
          : "No matching videos, or upload dates could not be read.",
      );
      return;
    }
  }
}

async function startRun(months: Months): Promise<void> {
  if (state.running) return;
  if (!isWatchLaterUrl(location.href)) {
    setLine("Open Watch Later, then press Start.");
    return;
  }

  state.running = true;
  state.stop = false;
  state.months = months;
  state.removed = 0;
  skipIds.clear();
  ageCache.clear();
  resetInnertubeCache();
  setLine("Starting…");
  reportBadge(0);

  try {
    const wake = acquireWakeLock();
    const scan = await scanPlaylist(months);
    await wake;
    if (scan.ok && (scan.dated > 0 || scan.targets.length > 0)) {
      if (scan.targets.length && !state.stop) await removeBatches(scan.targets);
      if (scan.truncated && !state.stop) await runFromDom(months);
      else if (!state.stop) {
        setLine(
          state.removed
            ? `Done. Removed ${state.removed}.`
            : "No matching videos, or upload dates could not be read.",
        );
      }
    } else if (!state.stop) {
      setLine("Reading the visible list…");
      await runFromDom(months);
    }
    if (state.stop) setLine(`Stopped. Removed ${state.removed}.`);
  } catch (err) {
    closeMenus();
    setLine(err instanceof Error ? err.message : String(err));
  } finally {
    state.running = false;
    reportBadge(null);
    await releaseWakeLock();
  }
}

document.addEventListener("yt-navigate-finish", () => {
  if (!isWatchLaterUrl(location.href) && state.running) state.stop = true;
});
document.addEventListener("yt-page-data-updated", () => {
  if (!isWatchLaterUrl(location.href) && state.running) state.stop = true;
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.running && !state.wakeOn) {
    void acquireWakeLock();
  }
});
window.addEventListener("pagehide", () => {
  if (!state.running) return;
  state.stop = true;
  void releaseWakeLock();
});

extApi.runtime.onMessage.addListener(
  (message: IncomingMessage, _sender, sendResponse: (response: unknown) => void) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "ytc-status") {
      sendResponse(snapshot());
      return;
    }
    if (message.type === "ytc-stop") {
      state.stop = true;
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "ytc-set-months") {
      if (isMonths(message.months)) state.months = message.months;
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "ytc-start") {
      if (message.months && isMonths(message.months)) state.months = message.months;
      void startRun(state.months);
      sendResponse({ ok: true });
    }
  },
);
