import { type IncomingMessage, extApi } from "./shared";

async function applyBadge(count: number | null): Promise<void> {
  if (count == null) {
    await extApi.action.setBadgeText({ text: "" });
    return;
  }
  await extApi.action.setBadgeBackgroundColor({ color: "#555555" });
  if (extApi.action.setBadgeTextColor) {
    await extApi.action.setBadgeTextColor({ color: "#ffffff" });
  }
  await extApi.action.setBadgeText({ text: String(count) });
}

extApi.runtime.onMessage.addListener((message: IncomingMessage) => {
  if (message?.type === "ytc-badge") void applyBadge(message.count);
});
