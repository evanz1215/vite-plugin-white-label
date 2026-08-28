import path from "path";
import { existsSync, readFileSync } from "fs";
import json5 from "json5";
import type { ResolvedBrandOptions, BrandConfig, BrandOptions } from "./types";

export const DEFAULT_IGNORE = [".DS_Store", "public/"];

export const DEFAULT_ENV_KEY = "VITE_BRAND";

/**
 * 品牌名只允許小寫英數與 -,不得含路徑分隔符、`..` 或磁碟代號。
 * 品牌名會直接進入 path.join(brandsDir, brand),不擋就等於開放路徑穿越
 * (`build ../src` 曾可讓 emptyOutDir 清空專案的 src)。
 */
const BRAND_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export const assertBrandName = (name: string): string => {
  if (!BRAND_NAME_RE.test(name)) {
    throw new Error(`品牌名不合法:${name}(僅限小寫英數與 -,且需以英數開頭)`);
  }
  return name;
};

/** 確認 target 解析後仍在 base 之下(base 自身視為在內),否則丟錯 */
export const assertInside = (base: string, target: string): string => {
  const rel = path.relative(base, target);
  if (rel && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new Error(`路徑逃逸:${target} 不在 ${base} 之下`);
  }
  return target;
};

export const resolveOptions = (
  options: BrandOptions,
  env: Record<string, string>,
  root = process.cwd(),
): ResolvedBrandOptions => {
  const envKey = options.envKey ?? DEFAULT_ENV_KEY;
  // brand 來自 env 檔或使用者設定,是 path.join 的直接輸入 → 邊界驗證
  const brand = assertBrandName(
    env[envKey] ?? options.defaultBrand ?? "default",
  );

  return {
    brandsDir: path.resolve(root, options.brandsDir ?? "./brands"),
    runtimeDir: path.resolve(root, options.runtimeDir ?? "./.runtime/brand"),
    brand,
    ignore: options.ignore ?? DEFAULT_IGNORE,
    tailwind: options.tailwind
      ? {
          presetPath: path.resolve(
            root,
            (typeof options.tailwind === "object" &&
              options.tailwind.presetPath) ||
              "./.brand-env/tailwind.preset.ts",
          ),
        }
      : false,
    aliases: options.aliases ?? {},
  };
};

/**
 * 讀取 brands/<brand>/config.jsonc(或 config.json),不存在則回傳 {}。
 *
 * extends 也會成為 path.join(brandsDir, extends) 的輸入,和品牌名走同一道驗證 ——
 * 讀取是所有使用點的共同入口,擋在這裡就不必每個呼叫端各補一次。
 */
export const readBrandConfig = (
  brandsDir: string,
  brand: string,
): BrandConfig => {
  for (const file of ["config.jsonc", "config.json"]) {
    const p = path.join(brandsDir, brand, file);
    if (existsSync(p)) {
      const config: BrandConfig = json5.parse(readFileSync(p, "utf8"));
      if (config.extends !== undefined) {
        if (typeof config.extends !== "string") {
          throw new Error(`${brand} 的 extends 必須是字串`);
        }
        assertBrandName(config.extends);
      }
      // title 會流進 transformIndexHtml 的字串處理,非字串會等到那裡才炸
      if (config.title !== undefined && typeof config.title !== "string") {
        throw new Error(`${brand} 的 title 必須是字串`);
      }
      return config;
    }
  }
  return {};
};

/** 統一使用 posix 分隔符,修掉 Windows 上 watcher 回傳 `\` 造成 replace 失效的問題 */
export const normalizePath = (p: string) => p.replaceAll("\\", "/");

/**
 * ignore 比對必須以「相對於品牌目錄」的路徑為基準。
 * 早期版本拿絕對路徑做 includes,專案只要放在含 public/ 的路徑下
 * (/var/www/public/app),整個品牌就會被靜默過濾成空 shadow。
 *
 * - 尾端帶 / 的項目視為目錄,匹配目錄本身與其下所有內容
 * - 其餘視為檔名,做完整片段比對(不會誤傷 my.DS_Store_backup)
 */
export const isIgnored = (ignore: string[], rel: string): boolean => {
  const p = normalizePath(rel);
  return ignore.some((item) => {
    if (item.endsWith("/")) {
      const dir = item.slice(0, -1);
      return p === dir || p.startsWith(item) || p.includes(`/${item}`);
    }
    return p === item || p.endsWith(`/${item}`);
  });
};
