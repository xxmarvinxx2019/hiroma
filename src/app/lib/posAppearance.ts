export type PosColorTheme = "light" | "dark";

export type PosAppearanceSettings = {
  useSystem: boolean;
  theme: PosColorTheme;
};

export const POS_APPEARANCE_STORAGE_KEY = "hiroma-pos-appearance-v1";
export const POS_APPEARANCE_CHANGE_EVENT = "hiroma:pos-appearance-change";
export const DEFAULT_POS_APPEARANCE: PosAppearanceSettings = { useSystem: true, theme: "light" };

export function loadPosAppearance(): PosAppearanceSettings {
  if (typeof window === "undefined") return DEFAULT_POS_APPEARANCE;
  try {
    const saved = JSON.parse(window.localStorage.getItem(POS_APPEARANCE_STORAGE_KEY) || "null");
    return {
      useSystem: saved?.useSystem !== false,
      theme: saved?.theme === "dark" ? "dark" : "light",
    };
  } catch {
    return DEFAULT_POS_APPEARANCE;
  }
}

export function savePosAppearance(settings: PosAppearanceSettings) {
  window.localStorage.setItem(POS_APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent<PosAppearanceSettings>(POS_APPEARANCE_CHANGE_EVENT, { detail: settings }));
}

export function resolvePosTheme(settings: PosAppearanceSettings, systemDark: boolean): PosColorTheme {
  return settings.useSystem ? (systemDark ? "dark" : "light") : settings.theme;
}