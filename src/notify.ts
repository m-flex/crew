import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let cachedGranted: boolean | null = null;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (cachedGranted !== null) return cachedGranted;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    cachedGranted = granted;
    return granted;
  } catch (e) {
    console.warn("notification permission check failed:", e);
    cachedGranted = false;
    return false;
  }
}

export async function notifyAgentIdle(label: string) {
  const ok = await ensureNotificationPermission();
  if (!ok) return;
  try {
    sendNotification({
      title: "Agent idle",
      body: label,
    });
  } catch (e) {
    console.warn("sendNotification failed:", e);
  }
}

export function labelFromCwd(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return cwd;
  if (parts.length === 1) return parts[0];
  return parts.slice(-2).join("/");
}
