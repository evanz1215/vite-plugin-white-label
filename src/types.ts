export interface BrandOptions {
  /** 品牌目錄,相對於專案根目錄。預設 "./brands" */
  brandsDir?: string;
  /** shadow 合成目錄。預設 "./.runtime/brand" */
  runtimeDir?: string;
  /** 讀取當前品牌的環境變數名。預設 "VITE_BRAND" */
  envKey?: string;
  /** 找不到環境變數時的預設品牌。預設 "default" */
  defaultBrand?: string;
  /** shadow 忽略清單(檔名或路徑片段)。預設 [".DS_Store", "public/"] */
  ignore?: string[];
  /** Tailwind v3 品牌 preset 同步(v4 CSS-first 不需要,品牌 CSS 直接走 shadow)。預設 false */
  tailwind?: boolean | { presetPath?: string };
  /** 額外注入的 resolve.alias(專案私有 alias 放這裡,套件只內建 @brand 系列) */
  aliases?: Record<string, string>;
  /**
   * 是否注入全域常數 DEV(= mode === "development")。預設 true。
   * DEV 是很通用的識別字,且會蓋掉使用者自己的 define.DEV —— 有衝突時設 false。
   */
  defineDev?: boolean;
}

export interface ResolvedBrandOptions {
  brandsDir: string;
  runtimeDir: string;
  brand: string;
  ignore: string[];
  tailwind: false | { presetPath: string };
  aliases: Record<string, string>;
}

/** brands/<name>/config.jsonc */
export interface BrandConfig {
  /** 頁面標題,取代 index.html 中的 =VITE_TITLE= */
  title?: string;
  /** 繼承的品牌名稱 */
  extends?: string;
  [key: string]: unknown;
}
