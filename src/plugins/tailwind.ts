import type { Plugin } from "vite";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { ResolvedBrandOptions } from "../types";
import { normalizePath } from "../options";

/**
 * Tailwind 品牌 preset 同步。
 * 移植自 .xgi/core/vite/plugins/xgi-plugin-tailwindcss。
 *
 * 使用端的根 tailwind.config.ts 引用 ctx.tailwind.presetPath;
 * 本 plugin 在 shadow 建好後(shadowReady resolve)把 <runtimeDir>/tailwind.config.ts
 * 複製過去,dev 模式下由 Vite server.watcher 監聽品牌設定變更後重寫。
 */
export const tailwindPlugin = (
  ctx: ResolvedBrandOptions,
  shadowReady: Promise<void>,
): Plugin => {
  const tw = ctx.tailwind;

  const sync = async () => {
    if (!tw) return;
    const src = path.join(ctx.runtimeDir, "tailwind.config.ts");
    await fs.mkdir(path.dirname(tw.presetPath), { recursive: true });
    if (existsSync(src)) {
      await fs.copyFile(src, tw.presetPath);
    } else {
      // 品牌沒有(或剛移除)tailwind.config.ts → 一律寫回空 preset。
      // 這裡若加上 !existsSync(presetPath) 條件,刪掉品牌設定後舊 preset
      // 會留在原地繼續生效。
      await fs.writeFile(tw.presetPath, "export default {};\n");
    }
  };

  return {
    name: "vite-plugin-white-label:tailwind",
    enforce: "post",

    async configResolved() {
      if (!tw) return;
      await shadowReady;
      await sync();
    },

    configureServer(server) {
      if (!tw) return;
      // watch 品牌來源檔而非 runtime 連結,add/change 都重新同步
      const brandTwConfig = path.join(
        ctx.brandsDir,
        ctx.brand,
        "tailwind.config.ts",
      );
      server.watcher.add(brandTwConfig);
      server.watcher.on("all", (_evt, file) => {
        if (normalizePath(file) === normalizePath(brandTwConfig)) {
          void sync();
        }
      });
    },
  };
};
