export type PosPaperWidth = "80" | "58";

export type PosDeviceSettings = {
  paperWidth: PosPaperWidth;
  printerName: string;
  autoOpenDrawer: boolean;
  lastTestedAt: string | null;
};

const STORAGE_KEY = "hiroma.pos.device-settings.v1";

export const DEFAULT_POS_DEVICE_SETTINGS: PosDeviceSettings = {
  paperWidth: "80",
  printerName: "",
  autoOpenDrawer: true,
  lastTestedAt: null,
};

export function loadPosDeviceSettings(): PosDeviceSettings {
  if (typeof window === "undefined") return DEFAULT_POS_DEVICE_SETTINGS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_POS_DEVICE_SETTINGS;
    const value = JSON.parse(raw) as Partial<PosDeviceSettings>;
    return {
      paperWidth: value.paperWidth === "58" ? "58" : "80",
      printerName: typeof value.printerName === "string" ? value.printerName : "",
      autoOpenDrawer: value.autoOpenDrawer !== false,
      lastTestedAt: typeof value.lastTestedAt === "string" ? value.lastTestedAt : null,
    };
  } catch {
    return DEFAULT_POS_DEVICE_SETTINGS;
  }
}

export function savePosDeviceSettings(settings: PosDeviceSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
