export type PlaylistEntry = {
  videoId: string;
  setVideoId: string | null;
  title: string;
  dateTexts: string[];
};

export type PlaylistPage = {
  items: PlaylistEntry[];
  continuation: string | null;
};

export const BATCH_SIZE = 50;
export const MAX_PLAYLIST_ITEMS = 5500;

export type PlaylistEditAction =
  | { action: "ACTION_REMOVE_VIDEO"; setVideoId: string; removedVideoId: string }
  | { action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID"; removedVideoId: string };

export function playlistEditActions(
  items: ReadonlyArray<{ videoId: string; setVideoId: string | null }>,
): PlaylistEditAction[] {
  return items.map((item) =>
    item.setVideoId
      ? { action: "ACTION_REMOVE_VIDEO", setVideoId: item.setVideoId, removedVideoId: item.videoId }
      : { action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: item.videoId },
  );
}

export function playlistEditSucceeded(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const rec = body as { error?: unknown; status?: string };
  if (rec.error) return false;
  return rec.status === "STATUS_SUCCEEDED";
}

export function extractPlaylistPage(root: unknown): PlaylistPage {
  const items: PlaylistEntry[] = [];
  const seen = new Set<string>();
  let continuation: string | null = null;

  function takeList(list: unknown): void {
    if (!Array.isArray(list)) return;
    let foundItems = 0;
    let token: string | null = null;
    for (const raw of list) {
      const node = unwrapItem(raw);
      if (!node) continue;
      if (node.continuationItemRenderer) {
        token = continuationToken(node.continuationItemRenderer) ?? token;
        continue;
      }
      const entry = playlistEntry(node);
      if (!entry || seen.has(entry.videoId)) continue;
      seen.add(entry.videoId);
      items.push(entry);
      foundItems += 1;
    }
    // Only follow a token that arrived with playlist rows, not header/chip feeds.
    if (foundItems && token) continuation = token;
  }

  walkContainers(root, takeList);
  return { items, continuation };
}

function unwrapItem(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (rec.richItemRenderer && typeof rec.richItemRenderer === "object") {
    const content = (rec.richItemRenderer as Record<string, unknown>).content;
    if (content && typeof content === "object") return content as Record<string, unknown>;
  }
  return rec;
}

function walkContainers(value: unknown, takeList: (list: unknown) => void, depth = 0): void {
  if (depth > 24 || !value || typeof value !== "object") return;
  const rec = value as Record<string, unknown>;

  if (rec.playlistVideoListRenderer && typeof rec.playlistVideoListRenderer === "object") {
    takeList((rec.playlistVideoListRenderer as Record<string, unknown>).contents);
    return;
  }
  if (rec.playlistVideoListContinuation && typeof rec.playlistVideoListContinuation === "object") {
    takeList((rec.playlistVideoListContinuation as Record<string, unknown>).contents);
    return;
  }
  if (rec.richGridRenderer && typeof rec.richGridRenderer === "object") {
    const contents = (rec.richGridRenderer as Record<string, unknown>).contents;
    if (listHasPlaylistSignal(contents)) takeList(contents);
  }
  if (Array.isArray(rec.continuationItems)) {
    takeList(rec.continuationItems);
  }

  if (Array.isArray(value)) {
    for (const child of value) walkContainers(child, takeList, depth + 1);
    return;
  }
  for (const child of Object.values(rec)) walkContainers(child, takeList, depth + 1);
}

function playlistEntry(node: Record<string, unknown>): PlaylistEntry | null {
  if (node.playlistVideoRenderer && typeof node.playlistVideoRenderer === "object") {
    return fromPlaylistVideo(node.playlistVideoRenderer as Record<string, unknown>);
  }
  if (node.lockupViewModel && typeof node.lockupViewModel === "object") {
    return fromLockup(node.lockupViewModel as Record<string, unknown>);
  }
  return null;
}

function listHasPlaylistSignal(list: unknown): boolean {
  if (!Array.isArray(list)) return false;
  for (const raw of list.slice(0, 12)) {
    const node = unwrapItem(raw);
    if (!node) continue;
    if (node.playlistVideoRenderer) return true;
    if (node.lockupViewModel && findSetVideoId(node.lockupViewModel, 18)) return true;
  }
  return false;
}

function fromPlaylistVideo(data: Record<string, unknown>): PlaylistEntry | null {
  const videoId = typeof data.videoId === "string" ? data.videoId : null;
  if (!videoId) return null;
  const texts: string[] = [];
  pushPublished(data, texts);
  pushRuns((data.videoInfo as Record<string, unknown> | undefined)?.runs, texts);
  if (data.title && typeof data.title === "object") {
    pushText(texts, nested(data.title as Record<string, unknown>, ["accessibility", "accessibilityData", "label"]));
  }
  return {
    videoId,
    setVideoId: stringId(data.setVideoId) ?? findSetVideoId(data, 12),
    title: titleOf(data) || "(untitled)",
    dateTexts: texts,
  };
}

function fromLockup(data: Record<string, unknown>): PlaylistEntry | null {
  if (typeof data.contentType === "string" && data.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") {
    return null;
  }
  const videoId =
    (typeof data.contentId === "string" && data.contentId.length >= 11 ? data.contentId : null) ??
    findVideoId(data, 10);
  if (!videoId) return null;
  const texts: string[] = [];
  const metadata = data.metadata;
  if (metadata && typeof metadata === "object") {
    const lockupMeta = (metadata as Record<string, unknown>).lockupMetadataViewModel;
    if (lockupMeta && typeof lockupMeta === "object") {
      collectMetaTexts((lockupMeta as Record<string, unknown>).metadata, texts, 0);
    }
  }
  return {
    videoId,
    setVideoId: findSetVideoId(data, 18),
    title: lockupTitle(data) || "(untitled)",
    dateTexts: texts,
  };
}

function titleOf(data: Record<string, unknown>): string {
  const title = data.title;
  if (typeof title === "string") return title.replace(/\s+/g, " ").trim();
  if (title && typeof title === "object") {
    const rec = title as Record<string, unknown>;
    if (typeof rec.simpleText === "string") return rec.simpleText.replace(/\s+/g, " ").trim();
    if (Array.isArray(rec.runs)) {
      return rec.runs
        .map((run) => (run && typeof run === "object" ? (run as Record<string, unknown>).text : ""))
        .filter((part): part is string => typeof part === "string")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    }
  }
  return "";
}

function lockupTitle(data: Record<string, unknown>): string {
  const metadata = data.metadata;
  if (!metadata || typeof metadata !== "object") return "";
  const lockupMeta = (metadata as Record<string, unknown>).lockupMetadataViewModel;
  if (!lockupMeta || typeof lockupMeta !== "object") return "";
  const title = (lockupMeta as Record<string, unknown>).title;
  if (title && typeof title === "object") {
    const content = (title as Record<string, unknown>).content;
    if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  }
  return "";
}

function pushPublished(data: Record<string, unknown>, out: string[]): void {
  const published = data.publishedTimeText;
  if (!published || typeof published !== "object") return;
  const rec = published as Record<string, unknown>;
  pushText(out, rec.simpleText);
  const label = nested(rec, ["accessibility", "accessibilityData", "label"]);
  pushText(out, label);
}

function pushRuns(runs: unknown, out: string[]): void {
  if (!Array.isArray(runs)) return;
  for (const run of runs) {
    if (run && typeof run === "object") pushText(out, (run as Record<string, unknown>).text);
  }
}

function collectMetaTexts(value: unknown, out: string[], depth: number): void {
  if (depth > 10 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) collectMetaTexts(child, out, depth + 1);
    return;
  }
  const rec = value as Record<string, unknown>;
  pushText(out, rec.content);
  pushText(out, rec.simpleText);
  pushText(out, rec.text);
  for (const child of Object.values(rec)) collectMetaTexts(child, out, depth + 1);
}

function continuationToken(value: unknown): string | null {
  return findToken(value, 8);
}

function findToken(value: unknown, depth: number): string | null {
  if (depth < 0 || !value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (rec.continuationCommand && typeof rec.continuationCommand === "object") {
    const token = (rec.continuationCommand as Record<string, unknown>).token;
    if (typeof token === "string" && token.length > 8) return token;
  }
  for (const child of Object.values(rec)) {
    const found = findToken(child, depth - 1);
    if (found) return found;
  }
  return null;
}

function findSetVideoId(value: unknown, depth: number): string | null {
  if (depth < 0 || !value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.setVideoId === "string" && rec.setVideoId.length > 4) return rec.setVideoId;
  for (const child of Object.values(rec)) {
    const found = findSetVideoId(child, depth - 1);
    if (found) return found;
  }
  return null;
}

function findVideoId(value: unknown, depth: number): string | null {
  if (depth < 0 || !value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.videoId === "string" && rec.videoId.length >= 11) return rec.videoId;
  for (const child of Object.values(rec)) {
    const found = findVideoId(child, depth - 1);
    if (found) return found;
  }
  return null;
}

function stringId(value: unknown): string | null {
  return typeof value === "string" && value.length > 4 ? value : null;
}

function pushText(out: string[], value: unknown): void {
  if (typeof value !== "string") return;
  const text = value.replace(/\s+/g, " ").trim();
  if (text) out.push(text);
}

function nested(value: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
