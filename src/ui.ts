import {
  type Months,
  type RuntimeStatus,
  WL_URL,
  extApi,
  isMonths,
  isWatchLaterUrl,
} from "./shared";

const titleEl = document.querySelector("[data-el='title']") as HTMLElement;
const actionEl = document.querySelector("[data-el='action']") as HTMLButtonElement;
const statusEl = document.querySelector("[data-el='status']") as HTMLElement;
const wakeEl = document.querySelector("[data-el='wake']") as HTMLElement;
const choiceEls = [...document.querySelectorAll<HTMLButtonElement>("[data-months]")];
const pillEls = [...document.querySelectorAll<HTMLLIElement>(".gone")];

let months: Months = 6;
let mode: "open" | "start" | "stop" = "start";

async function activeTab(): Promise<browser.tabs.Tab | null> {
  const tabs = await extApi.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function send(tabId: number, message: unknown): Promise<RuntimeStatus | { ok: true } | undefined> {
  return extApi.tabs.sendMessage(tabId, message) as Promise<
    RuntimeStatus | { ok: true } | undefined
  >;
}

function paintChoices(): void {
  for (const button of choiceEls) {
    const on = Number(button.getAttribute("data-months")) === months;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  }
}

function paintPills(titles: string[]): void {
  for (let i = 0; i < pillEls.length; i += 1) {
    const title = titles[i] ?? "";
    pillEls[i].textContent = title;
    pillEls[i].classList.toggle("is-empty", !title);
  }
}

function paintIdle(onWl: boolean, status?: RuntimeStatus): void {
  if (status?.months) months = status.months;
  paintChoices();
  paintPills(status?.recent ?? []);
  titleEl.textContent = onWl
    ? "Remove videos posted more than"
    : "Open Watch Later to clean the list";
  statusEl.textContent = status?.line || (onWl ? "Pick a window, then Start." : "This only runs on Watch Later.");
  wakeEl.textContent = "Keep this YouTube tab focused so the PC does not sleep";
  wakeEl.classList.remove("is-on");
  for (const button of choiceEls) button.disabled = !onWl;
  if (onWl) {
    actionEl.textContent = "Start";
    mode = "start";
  } else {
    actionEl.textContent = "Open Watch Later";
    mode = "open";
  }
}

function paintRun(status: RuntimeStatus): void {
  months = status.months;
  paintChoices();
  paintPills(status.recent);
  titleEl.textContent = "Remove videos posted more than";
  statusEl.textContent = status.line || "Removing…";
  wakeEl.textContent = status.wakeLock
    ? "Screen stay-awake is on"
    : "Keep this YouTube tab focused so the PC does not sleep";
  wakeEl.classList.toggle("is-on", status.wakeLock);
  for (const button of choiceEls) button.disabled = true;
  actionEl.textContent = "Stop";
  mode = "stop";
}

async function refresh(): Promise<void> {
  const tab = await activeTab();
  const url = tab?.url ?? "";
  const onWl = isWatchLaterUrl(url);
  if (!tab || !onWl) {
    paintIdle(false);
    return;
  }
  try {
    const status = (await send(tab.id!, { type: "ytc-status" })) as RuntimeStatus | undefined;
    if (status?.running) {
      paintRun(status);
      return;
    }
    paintIdle(true, status);
  } catch {
    paintIdle(true);
    statusEl.textContent = "Refresh the Watch Later tab, then open this again.";
  }
}

document.querySelector(".months")?.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest("[data-months]");
  if (!(button instanceof HTMLElement) || mode === "stop") return;
  const next = Number(button.getAttribute("data-months"));
  if (!isMonths(next)) return;
  months = next;
  paintChoices();
  const tab = await activeTab();
  if (!tab?.id || !isWatchLaterUrl(tab.url ?? "")) return;
  try {
    await send(tab.id, { type: "ytc-set-months", months });
  } catch {
    /* content script not ready */
  }
});

async function openWatchLater(): Promise<void> {
  const playlistTabs = await extApi.tabs.query({ url: "https://www.youtube.com/playlist*" });
  const existing = playlistTabs.find((tab) => isWatchLaterUrl(tab.url ?? ""));
  if (existing?.id != null) {
    await extApi.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await extApi.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await extApi.windows.create({ url: WL_URL, focused: true });
}

actionEl.addEventListener("click", async () => {
  const tab = await activeTab();
  if (mode === "open") {
    await openWatchLater();
    window.close();
    return;
  }
  if (!tab?.id) return;
  try {
    if (mode === "stop") await send(tab.id, { type: "ytc-stop" });
    else await send(tab.id, { type: "ytc-start", months });
    await refresh();
  } catch {
    statusEl.textContent = "Refresh the Watch Later tab, then press Start.";
  }
});

paintChoices();
void refresh();
setInterval(() => {
  if (mode === "stop") void refresh();
}, 800);
