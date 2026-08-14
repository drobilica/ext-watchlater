import { olderThanMonths, parseAgeDays } from "./age";
import {
  type IncomingMessage,
  type Months,
  type RuntimeStatus,
  extApi,
  isMonths,
  isWatchLaterUrl,
} from "./shared";

const DELAY_MS = 700;
const MENU_WAIT_MS = 350;
const SCROLL_WAIT_MS = 800;
const GONE_WAIT_MS = 2500;

declare function cloneInto<T>(
  obj: T,
  targetScope: object,
  options?: { cloneFunctions?: boolean },
): T;

type PlaylistRendererData = {
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

function collectDateTexts(video: HTMLElement): string[] {
  const texts: string[] = [];
  const data = rendererData(video);
  const published = data?.publishedTimeText;
  if (published?.simpleText) texts.push(published.simpleText);
  const label = published?.accessibility?.accessibilityData?.label;
  if (label) texts.push(label);
  for (const run of data?.videoInfo?.runs ?? []) {
    if (run.text) texts.push(run.text);
  }

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
    if (text) texts.push(text);
  }

  const blob = video.innerText.trim();
  if (blob) texts.push(blob);
  return texts;
}

const ageCache = new Map<string, number | null>();
const skipIds = new Set<string>();

function uploadAgeDays(video: HTMLElement): number | null {
  const id = videoIdOf(video);
  if (id && ageCache.has(id)) return ageCache.get(id) ?? null;
  let days: number | null = null;
  for (const text of collectDateTexts(video)) {
    days = parseAgeDays(text);
    if (days != null) break;
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

function pageWindow(): Window & { ytcfg?: YtCfg } {
  const view = window as Window & { wrappedJSObject?: Window & { ytcfg?: YtCfg } };
  return view.wrappedJSObject ?? view;
}

async function removeViaPlaylistEdit(videoId: string): Promise<boolean> {
  if (!isWatchLaterUrl(location.href)) return false;
  try {
    const ytcfg = pageWindow().ytcfg;
    const key = ytcfg?.get("INNERTUBE_API_KEY");
    const context = ytcfg?.get("INNERTUBE_CONTEXT");
    if (typeof key !== "string" || !context) return false;

    const url = `https://www.youtube.com/youtubei/v1/browse/edit_playlist?prettyPrint=false&key=${encodeURIComponent(key)}`;
    const init = {
      method: "POST",
      credentials: "same-origin" as const,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: JSON.parse(JSON.stringify(context)),
        playlistId: "WL",
        actions: [
          { action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: videoId },
        ],
      }),
    };

    const page = pageWindow();
    const request = typeof cloneInto === "function" ? cloneInto(init, page) : init;
    const response = await page.fetch(url, request);
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function waitGone(videoId: string): Promise<boolean> {
  const deadline = Date.now() + GONE_WAIT_MS;
  while (Date.now() < deadline) {
    if (!getVideos().some((row) => videoIdOf(row) === videoId)) return true;
    await sleep(150);
  }
  return false;
}

async function removeFromWatchLater(video: HTMLElement, videoId: string): Promise<void> {
  if (!isWatchLaterUrl(location.href)) throw new Error("Left Watch Later.");
  if (await removeViaPlaylistEdit(videoId)) {
    video.remove();
    return;
  }
  await clickRemove(video, videoId);
}

async function clickRemove(video: HTMLElement, videoId: string): Promise<void> {
  if (!isWatchLaterUrl(location.href)) throw new Error("Left Watch Later.");
  closeMenus();
  await sleep(120);
  const button = menuButton(video);
  if (!button) throw new Error("Could not find the ⋮ menu on this row.");
  button.click();
  const deadline = Date.now() + 2500;
  let item: HTMLElement | null = null;
  while (Date.now() < deadline) {
    await sleep(MENU_WAIT_MS);
    item = findRemoveItem();
    if (item) break;
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

async function scrollForMore(previousCount: number): Promise<boolean> {
  const last = getVideos().at(-1);
  last?.scrollIntoView({ block: "nearest", inline: "nearest" });
  const scroller =
    $("ytd-playlist-video-list-renderer") ||
    $("#primary-inner") ||
    $("#primary");
  if (scroller instanceof HTMLElement) scroller.scrollTop += 900;
  await sleep(SCROLL_WAIT_MS);
  return getVideos().length > previousCount;
}

function nextTarget(months: Months): { video: HTMLElement; id: string } | null {
  for (const video of getVideos()) {
    const id = videoIdOf(video);
    if (!id || skipIds.has(id)) continue;
    const age = uploadAgeDays(video);
    if (age != null && olderThanMonths(age, months)) return { video, id };
  }
  return null;
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
  setLine("Starting…");
  reportBadge(0);
  await acquireWakeLock();

  let emptyScrolls = 0;
  let misses = 0;
  try {
    while (!state.stop) {
      if (!isWatchLaterUrl(location.href)) {
        setLine("Left Watch Later. Stopped.");
        break;
      }

      const videos = getVideos();
      if (!videos.length) {
        setLine("No videos on the page. Scroll the list once, then press Start.");
        break;
      }

      const hit = nextTarget(months);
      if (hit) {
        emptyScrolls = 0;
        const title = videoTitle(hit.video);
        setLine(`${state.removed} removed · ${title}`);
        try {
          await removeFromWatchLater(hit.video, hit.id);
          skipIds.add(hit.id);
          remember(title);
          state.removed += 1;
          misses = 0;
          reportBadge(state.removed);
          setLine(`${state.removed} removed`);
        } catch (err) {
          skipIds.add(hit.id);
          misses += 1;
          setLine(err instanceof Error ? err.message : String(err));
          closeMenus();
          if (misses >= 5) throw err;
          await sleep(DELAY_MS);
        }
        await sleep(DELAY_MS);
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
        break;
      }
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
