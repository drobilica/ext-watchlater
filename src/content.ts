import panelCss from "./panel.css?inline";
import {
  type IncomingMessage,
  type Months,
  type RuntimeStatus,
  extApi,
  isMonths,
  isWatchLaterUrl,
  WL_URL,
} from "./shared";

const HOST_ID = "ytc-root";
const DELAY_MS = 1300;
const MENU_WAIT_MS = 350;
const SCROLL_WAIT_MS = 900;

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

type Ui = {
  host: HTMLDivElement;
  title: HTMLElement;
  choices: HTMLButtonElement[];
  action: HTMLButtonElement;
  status: HTMLElement;
  wake: HTMLElement;
  pills: HTMLLIElement[];
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
  hidden: false,
};

let ui: Ui | null = null;

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

function parseAgeDays(text: string): number | null {
  const lower = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (/just now|\btoday\b/.test(lower) && !/\d+\s+(day|week|month|year)/.test(lower)) {
    return 0;
  }
  if (/\byesterday\b/.test(lower)) return 1;

  const rel = lower.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    if (unit === "second" || unit === "minute" || unit === "hour") return 0;
    if (unit === "day") return n;
    if (unit === "week") return n * 7;
    if (unit === "month") return n * 30;
    if (unit === "year") return n * 365;
  }

  const abs = Date.parse(
    text.replace(/^(streamed|premiered|uploaded|published)\s+/i, "").replace(/.*•\s*/, ""),
  );
  if (!Number.isNaN(abs) && abs < Date.now() && abs > Date.parse("2005-01-01")) {
    return Math.max(0, Math.floor((Date.now() - abs) / 86400000));
  }
  return null;
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

function uploadAgeDays(video: HTMLElement): number | null {
  for (const text of collectDateTexts(video)) {
    const days = parseAgeDays(text);
    if (days != null) return days;
  }
  return null;
}

function olderThanMonths(ageDays: number, months: Months): boolean {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return Date.now() - ageDays * 86400000 <= cutoff.getTime();
}

function closeMenus(): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

function findRemoveItem(): HTMLElement | null {
  const scopes = $$(
    "ytd-menu-popup-renderer, tp-yt-iron-dropdown:not([aria-hidden='true']), [role='menu']",
  );
  const hay = scopes.flatMap((scope) =>
    $$(
      "ytd-menu-service-item-renderer, tp-yt-paper-item, yt-list-item-view-model, [role='menuitem'], button, yt-formatted-string",
      scope,
    ),
  );
  const hit = hay.find((el) => {
    if (!visible(el) && el instanceof HTMLElement && el.offsetHeight === 0) return false;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 80) return false;
    return /^remove from/i.test(text) || /remove from watch later/i.test(text);
  });
  return hit instanceof HTMLElement ? hit : null;
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

async function clickRemove(video: HTMLElement): Promise<void> {
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
    throw new Error('No "Remove from …" item. Switch YouTube to English.');
  }
  item.click();
}

async function acquireWakeLock(): Promise<void> {
  state.wakeOn = false;
  if (!navigator.wakeLock?.request) return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeOn = true;
    state.wakeLock.addEventListener("release", () => {
      state.wakeOn = false;
      paint();
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

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    attrs?: Record<string, string>;
  } = {},
  kids: HTMLElement[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      node.setAttribute(key, value);
    }
  }
  for (const kid of kids) node.append(kid);
  return node;
}

function monthButton(months: Months, selected: boolean): HTMLButtonElement {
  return el("button", {
    className: selected ? "month is-on" : "month",
    text: `${months} mo`,
    attrs: {
      type: "button",
      "data-months": String(months),
      "aria-pressed": String(selected),
    },
  });
}

function mount(): Ui {
  if (ui) return ui;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.top = "80px";
  host.style.right = "16px";
  host.style.zIndex = "2147483646";
  host.style.width = "320px";
  host.style.height = "432px";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = panelCss;

  const hide = el("button", {
    className: "hide",
    text: "×",
    attrs: { type: "button", "data-act": "hide", "aria-label": "Hide" },
  });
  const title = el("h1", {
    className: "title",
    text: "Remove videos posted more than",
  });
  const months = el(
    "div",
    { className: "months", attrs: { role: "radiogroup", "aria-label": "Age in months" } },
    [monthButton(6, true), monthButton(12, false), monthButton(24, false)],
  );
  const action = el("button", {
    className: "action",
    text: "Start",
    attrs: { type: "button", "data-act": "action" },
  });
  const status = el("p", { className: "status" });
  const wake = el("p", { className: "wake" });
  const pills = [0, 1, 2, 3, 4].map(() =>
    el("li", { className: "gone is-empty" }),
  );
  const frame = el(
    "section",
    { className: "frame", attrs: { "aria-label": "Clear Watch Later" } },
    [
      el("div", { className: "head" }, [
        el("p", { className: "kicker", text: "Watch Later" }),
        hide,
      ]),
      title,
      months,
      action,
      el("div", { className: "meta" }, [status, wake]),
      el("ul", { className: "pills", attrs: { "aria-label": "Last removed" } }, pills),
    ],
  );

  shadow.append(style, frame);

  shadow.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const hide = target.closest("[data-act='hide']");
    const action = target.closest("[data-act='action']");
    const choice = target.closest("[data-months]");
    if (hide) {
      state.hidden = true;
      paint();
      return;
    }
    if (choice instanceof HTMLElement && !state.running) {
      const next = Number(choice.getAttribute("data-months"));
      if (isMonths(next)) state.months = next;
      paint();
      return;
    }
    if (action) {
      const mode = mount().action.dataset.mode;
      if (mode === "open") {
        location.assign(WL_URL);
        return;
      }
      if (mode === "stop") {
        state.stop = true;
        return;
      }
      if (mode === "start") void startRun(state.months);
    }
  });

  document.documentElement.appendChild(host);
  ui = {
    host,
    title: shadow.querySelector(".title") as HTMLElement,
    choices: [...shadow.querySelectorAll<HTMLButtonElement>("[data-months]")],
    action: shadow.querySelector("[data-act='action']") as HTMLButtonElement,
    status: shadow.querySelector(".status") as HTMLElement,
    wake: shadow.querySelector(".wake") as HTMLElement,
    pills: [...shadow.querySelectorAll<HTMLLIElement>(".gone")],
  };
  return ui;
}

function paint(): void {
  if (!isWatchLaterUrl(location.href)) {
    teardown();
    return;
  }
  const view = mount();
  view.host.hidden = state.hidden && !state.running;

  view.title.textContent = "Remove videos posted more than";

  for (const button of view.choices) {
    const value = Number(button.getAttribute("data-months"));
    const on = value === state.months;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
    button.disabled = state.running;
  }

  if (state.running) {
    view.action.textContent = "Stop";
    view.action.dataset.mode = "stop";
  } else {
    view.action.textContent = "Start";
    view.action.dataset.mode = "start";
  }

  view.status.textContent = state.line;
  view.wake.textContent = state.wakeOn
    ? "Screen stay-awake is on"
    : "Keep this tab focused so the PC does not sleep";
  view.wake.classList.toggle("is-on", state.wakeOn);

  for (let i = 0; i < view.pills.length; i += 1) {
    const title = state.recent[i] ?? "";
    view.pills[i].textContent = title;
    view.pills[i].classList.toggle("is-empty", !title);
  }
}

function setLine(text: string): void {
  state.line = text;
  paint();
}

async function scrollForMore(previousCount: number): Promise<boolean> {
  const videos = getVideos();
  const last = videos[videos.length - 1];
  last?.scrollIntoView({ block: "end", inline: "nearest" });
  const scroller =
    $("ytd-playlist-video-list-renderer #contents") ||
    $("ytd-playlist-video-list-renderer") ||
    $("#primary") ||
    document.scrollingElement;
  if (scroller && scroller !== last) scroller.scrollTop += 1400;
  window.scrollBy(0, 1000);
  await sleep(SCROLL_WAIT_MS);
  return getVideos().length > previousCount;
}

function nextTarget(months: Months): HTMLElement | null {
  for (const video of getVideos()) {
    const age = uploadAgeDays(video);
    if (age != null && olderThanMonths(age, months)) return video;
  }
  return null;
}

async function startRun(months: Months): Promise<void> {
  if (state.running) return;
  if (!isWatchLaterUrl(location.href)) {
    location.assign(WL_URL);
    return;
  }

  state.running = true;
  state.stop = false;
  state.months = months;
  state.removed = 0;
  state.hidden = false;
  setLine("Starting…");
  await acquireWakeLock();
  paint();

  let emptyScrolls = 0;
  let misses = 0;
  try {
    while (!state.stop) {
      const videos = getVideos();
      if (!videos.length) {
        setLine("No videos on the page. Scroll the list once, then press Start.");
        break;
      }

      const hit = nextTarget(months);
      if (hit) {
        emptyScrolls = 0;
        const title = videoTitle(hit);
        setLine(`${state.removed} removed · ${title}`);
        try {
          await clickRemove(hit);
          remember(title);
          state.removed += 1;
          misses = 0;
          setLine(`${state.removed} removed`);
        } catch (err) {
          misses += 1;
          setLine(err instanceof Error ? err.message : String(err));
          if (misses >= 3) throw err;
          closeMenus();
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
    await releaseWakeLock();
    paint();
  }
}

function teardown(): void {
  if (state.running) state.stop = true;
  ui?.host.remove();
  ui = null;
}

function onNavigate(): void {
  if (!isWatchLaterUrl(location.href)) {
    teardown();
    return;
  }
  state.hidden = false;
  paint();
}

document.addEventListener("yt-navigate-finish", onNavigate);
document.addEventListener("yt-page-data-updated", onNavigate);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.running && !state.wakeOn) {
    void acquireWakeLock().then(paint);
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
      paint();
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

if (isWatchLaterUrl(location.href)) paint();
