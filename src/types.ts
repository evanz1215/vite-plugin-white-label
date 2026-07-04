export interface ThemeOptions {
  /** 主題目錄,相對於專案根目錄。預設 "./themes" */
  themesDir?: string;
  /** shadow 合成目錄。預設 "./.runtime/theme" */
  runtimeDir?: string;
  /** 讀取當前主題的環境變數名。預設 "VITE_THEME" */
  envKey?: string;
  /** 找不到環境變數時的預設主題。預設 "default" */
  defaultTheme?: string;
  /** shadow 忽略清單(檔名或路徑片段)。預設 [".DS_Store", "public/"] */
  ignore?: string[];
  /** Tailwind v3 主題 preset 同步(v4 CSS-first 不需要,主題 CSS 直接走 shadow)。預設 false */
  tailwind?: boolean | { presetPath?: string };
  /** 額外注入的 resolve.alias(專案私有 alias 放這裡,套件只內建 @theme 系列) */
  aliases?: Record<string, string>;
}

export interface ResolvedThemeOptions {
  themesDir: string;
  runtimeDir: string;
  theme: string;
  ignore: string[];
  tailwind: false | { presetPath: string };
  aliases: Record<string, string>;
}

/** themes/<name>/config.jsonc */
export interface ThemeConfig {
  /** 頁面標題,取代 index.html 中的 =VITE_TITLE= */
  title?: string;
  /** 繼承的主題名稱 */
  extends?: string;
  [key: string]: unknown;
}
