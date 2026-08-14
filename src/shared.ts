export const WL_URL = "https://www.youtube.com/playlist?list=WL";
export const MONTHS = [6, 12, 24] as const;
export type Months = (typeof MONTHS)[number];

export type RuntimeStatus = {
  running: boolean;
  months: Months;
  removed: number;
  recent: string[];
  wakeLock: boolean;
  line: string;
};

export type IncomingMessage =
  | { type: "ytc-status" }
  | { type: "ytc-stop" }
  | { type: "ytc-set-months"; months: number }
  | { type: "ytc-start"; months?: number }
  | { type: "ytc-badge"; count: number | null };

export function isMonths(value: number): value is Months {
  return (MONTHS as readonly number[]).includes(value);
}

function isYouTubeHost(host: string): boolean {
  return host === "youtube.com" || host.endsWith(".youtube.com");
}

export function isWatchLaterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      isYouTubeHost(parsed.hostname) &&
      parsed.pathname.startsWith("/playlist") &&
      parsed.searchParams.get("list") === "WL"
    );
  } catch {
    return false;
  }
}

declare const chrome: typeof browser | undefined;

export const extApi: typeof browser =
  typeof browser !== "undefined"
    ? browser
    : typeof chrome !== "undefined"
      ? chrome
      : (undefined as unknown as typeof browser);
