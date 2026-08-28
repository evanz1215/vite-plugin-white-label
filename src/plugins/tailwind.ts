import type { Plugin } from "vite";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { ResolvedBrandOptions } from "../types";
import { normalizePath, readBrandConfig } from "../options";

const TW_CONFIG = "tailwind.config.ts";
const EMPTY_PRESET = `export default {};
`;

/**
 * Tailwind 品牌 preset 同步(Tailwind v3 用;v4 的 CSS-first 設定直接走 shadow)。
 *
 * 使用端的根 tailwind.config.ts 引用 ctx.tailwind.presetPath。
 *
 * 來源刻意直接讀 brands/ 而非 shadow 出來的 runtimeDir:runtimeDir 由 shadow
 * 的事件佇列非同步重建,從那裡讀就得跟它競速 —— 品牌設定剛被刪除時很容易複製到
 * 還沒斷鏈的舊內容。自己解析一層繼承只是多讀一個 config.jsonc,卻讓這個 plugin
 * 完全不依賴 shadow 的時序。
 */
export const tailwindPlugin = (
  ctx: ResolvedBrandOptions,
  shadowReady: Promise<void>,
): Plugin => {
  const tw = ctx.tailwind;

  /** 依「當前品牌 → extends」的優先序找出品牌設定檔,都沒有則回傳 null */
  const resolveSource = (): string | null => {
    const config = readBrandConfig(ctx.brandsDir, ctx.brand);
    for (const brand of [ctx.brand, config.extends]) {
      if (!brand) continue;
      const p = path.join(ctx.brandsDir, brand, TW_CONFIG);
      if (existsSync(p)) return p;
    }
    return null;
  };

  const sync = async () => {
    if (!tw) return;
    await fs.mkdir(path.dirname(tw.presetPath), { recursive: true });

    const src = resolveSource();
    if (src) {
      await fs.copyFile(src, tw.presetPath);
      return;
    }
    // 沒有任何品牌設定(或剛被移除)→ 一律寫回空 preset:讓根設定的 import 不會
    // 失敗,也不會留著前一個品牌的殘留。
    await fs.writeFile(tw.presetPath, EMPTY_PRESET);
  };

  return {
    name: "vite-plugin-white-label:tailwind",
    enforce: "post",

    async configResolved() {
      if (!tw) return;
      // 來源已不是 runtimeDir,這裡等待只是避免 shadow 失敗時仍寫出 preset
      await shadowReady;
      await sync();
    },

    configureServer(server) {
      if (!tw) return;
      // 監看整個 brandsDir:繼承來源可能是任一品牌,且 extends 本身也會被改
      server.watcher.add(ctx.brandsDir);

      const base = normalizePath(ctx.brandsDir) + "/";
      server.watcher.on("all", (_evt, file) => {
        const p = normalizePath(file);
        if (!p.startsWith(base)) return;

        // 設定檔本身,或 config.jsonc(extends 換了就等於換了來源)
        const name = p.slice(p.lastIndexOf("/") + 1);
        if (
          name !== TW_CONFIG &&
          name !== "config.jsonc" &&
          name !== "config.json"
        ) {
          return;
        }

        void sync().catch((err) =>
          console.error("[vite-plugin-white-label]", err),
        );
      });
    },
  };
};
