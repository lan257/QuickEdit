export interface WallpaperPreset {
  id: string;
  label: string;
  light: string;
  dark: string;
}

// 壁纸画在窗口底层，正文与侧栏以半透明表面浮在上面，因此预设本身要保持低对比。
export const WALLPAPERS: WallpaperPreset[] = [
  {
    id: "mist",
    label: "晨雾",
    light: "radial-gradient(880px 520px at 8% -12%, #d7e3ff 0%, rgba(215,227,255,0) 62%), radial-gradient(760px 460px at 98% 2%, #e2f0fb 0%, rgba(226,240,251,0) 60%), linear-gradient(158deg, #eef2fa 0%, #e6ecf6 100%)",
    dark: "radial-gradient(880px 520px at 8% -12%, #2c3a60 0%, rgba(44,58,96,0) 62%), radial-gradient(760px 460px at 98% 2%, #223349 0%, rgba(34,51,73,0) 60%), linear-gradient(158deg, #171c26 0%, #131821 100%)",
  },
  {
    id: "dusk",
    label: "暮色",
    light: "radial-gradient(820px 500px at 12% 100%, #ffe2cf 0%, rgba(255,226,207,0) 60%), radial-gradient(760px 460px at 92% -8%, #e9ddff 0%, rgba(233,221,255,0) 58%), linear-gradient(168deg, #fdf3ee 0%, #f3e9f2 100%)",
    dark: "radial-gradient(820px 500px at 12% 100%, #4a3226 0%, rgba(74,50,38,0) 60%), radial-gradient(760px 460px at 92% -8%, #35284a 0%, rgba(53,40,74,0) 58%), linear-gradient(168deg, #1c1a22 0%, #17151d 100%)",
  },
  {
    id: "pine",
    label: "青野",
    light: "radial-gradient(860px 520px at 6% 8%, #d5f0e4 0%, rgba(213,240,228,0) 60%), radial-gradient(720px 480px at 96% 96%, #d9ecf5 0%, rgba(217,236,245,0) 58%), linear-gradient(152deg, #eef6f3 0%, #e7eff0 100%)",
    dark: "radial-gradient(860px 520px at 6% 8%, #22413a 0%, rgba(34,65,58,0) 60%), radial-gradient(720px 480px at 96% 96%, #1f3743 0%, rgba(31,55,67,0) 58%), linear-gradient(152deg, #16201f 0%, #141b1e 100%)",
  },
  {
    id: "linen",
    label: "纸纹",
    light: "repeating-linear-gradient(90deg, rgba(120,135,160,.07) 0 1px, rgba(0,0,0,0) 1px 26px), repeating-linear-gradient(0deg, rgba(120,135,160,.07) 0 1px, rgba(0,0,0,0) 1px 26px), linear-gradient(180deg, #f2f4f8 0%, #eaedf3 100%)",
    dark: "repeating-linear-gradient(90deg, rgba(180,195,220,.05) 0 1px, rgba(0,0,0,0) 1px 26px), repeating-linear-gradient(0deg, rgba(180,195,220,.05) 0 1px, rgba(0,0,0,0) 1px 26px), linear-gradient(180deg, #191e27 0%, #15191f 100%)",
  },
];

export function presetWallpaper(value: string): WallpaperPreset | null {
  return WALLPAPERS.find((preset) => preset.id === value) || null;
}

export function wallpaperCss(value: string, theme: "light" | "dark"): string | null {
  const preset = presetWallpaper(value);
  if (!preset) return null;
  return theme === "dark" ? preset.dark : preset.light;
}

// 预设之外的取值按本地图片路径处理。
export function isWallpaperPath(value: string): boolean {
  return Boolean(value) && value !== "none" && !presetWallpaper(value);
}

export const MIN_SURFACE_ALPHA = 0.6;

const WALLPAPER_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp", ".svg": "image/svg+xml",
};

export function wallpaperMime(path: string): string {
  const dot = path.toLowerCase().lastIndexOf(".");
  return dot >= 0 ? WALLPAPER_MIME[path.slice(dot)] || "application/octet-stream" : "application/octet-stream";
}

// 透明度滑杆 0–100 表示背景可见度：0 时表面完全不透明，100 时表面最透。
export function surfaceAlpha(opacity: number): number {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(opacity) ? opacity : 0));
  return Number((1 - (clamped / 100) * (1 - MIN_SURFACE_ALPHA)).toFixed(3));
}
