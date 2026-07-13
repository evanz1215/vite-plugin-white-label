import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Plugin } from "vite";
import type { ResolvedBrandOptions, BrandConfig } from "../types";
import { normalizePath, readBrandConfig } from "../options";

/**
 * Shadow plugin:建立並維護 .runtime/brand 硬連結合成目錄。
 * 移植自 .xgi/core/vite/plugins/xgi-plugin-shadow;
 * dev 監聽改用 Vite 自帶的 server.watcher(生命週期由 Vite 管理),不另起 chokidar。
 */

const ignored = (ctx: ResolvedBrandOptions, target: string) => {
  const p = normalizePath(target);
  return ctx.ignore.some((item) => p.includes(item));
};

/** hard link,跨分割區時 fallback 為 copy */
const linkFile = async (src: string, dest: string) => {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    await fs.unlink(dest);
  }
  try {
    await fs.link(src, dest);
  } catch (err: any) {
    if (err?.code === "ENOENT" && !existsSync(src)) {
      // 來源已消失(編輯器暫存檔在 link 前被 rename 走)→ 略過,後續事件會處理
      return;
    }
    if (err?.code === "EXDEV") {
      // ponytail: 跨 volume 無法 hard link,copy fallback(此模式下內容修改不會自動同步)
      console.warn(
        `[vite-plugin-white-label] hard link failed (cross-device), copied instead: ${dest}`,
      );
      await fs.copyFile(src, dest);
    } else {
      throw err;
    }
  }
};

/**
 * 重建 shadow 目錄:
 * 1. 清空 runtimeDir 後重建
 * 2. 連結當前品牌所有檔案
 * 3. 若 config.extends 存在,補連結「當前品牌沒有覆蓋」的繼承品牌檔案
 */
export const createShadow = async (
  ctx: ResolvedBrandOptions,
  brandConfig: BrandConfig,
) => {
  await fs.rm(ctx.runtimeDir, { recursive: true, force: true });
  await fs.mkdir(ctx.runtimeDir, { recursive: true });

  const linkBrand = async (brand: string) => {
    const dir = path.join(ctx.brandsDir, brand);
    if (!existsSync(dir)) return;

    const files = await fs.readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });

    for (const f of files) {
      if (!f.isFile()) continue;
      const src = path.join(f.parentPath, f.name);
      if (ignored(ctx, src)) continue;
      await linkFile(src, path.join(ctx.runtimeDir, path.relative(dir, src)));
    }
  };

  // 先鋪繼承品牌,再讓當前品牌覆蓋 —— 順序即優先級
  if (brandConfig.extends) {
    await linkBrand(brandConfig.extends);
  }
  await linkBrand(ctx.brand);
};

/**
 * dev 模式:處理 brands/<brand> 與 brands/<extends> 的檔案事件,維護 runtime 連結。
 * 回傳的 handler 掛在 Vite server.watcher 的 "all" 事件上,非相關路徑一律 no-op。
 *
 * 事件對應:
 * - brand add       → 直接 link(蓋掉原本連到 extends 的檔)
 * - brand unlink    → 移除 runtime 檔;若 extends 有同名檔則回退連 extends 版本
 * - extends add      → 僅當 brand 沒有同名檔時才 link
 * - extends unlink   → 僅當 brand 沒有同名檔時才移除 runtime 檔
 * - change          → 就地寫入因同 inode 天然生效;原子寫入會換 inode,偵測後重連
 */
/** file 在 dir 之下時回傳相對路徑,否則 null */
const relIn = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : null;
};

/**
 * 原子寫入(先寫 temp 檔再 rename 覆蓋,JetBrains safe write 等編輯器預設)會換掉
 * inode,舊 hard link 因而指向舊內容 → 比對 inode,不同(或斷鏈)就重新連結。
 */
const relinkIfStale = async (src: string, dest: string) => {
  let s: Awaited<ReturnType<typeof fs.stat>>;
  try {
    s = await fs.stat(src, { bigint: true });
  } catch {
    return; // 來源不存在(暫存檔或已刪除,unlink 事件會善後)→ 不動
  }
  try {
    const d = await fs.stat(dest, { bigint: true });
    if (s.ino === d.ino) return;
  } catch {
    // dest 不存在 → 直接重連
  }
  await linkFile(src, dest);
};

export const createShadowHandler = (
  ctx: ResolvedBrandOptions,
  brandConfig: BrandConfig,
) => {
  const brandDir = path.join(ctx.brandsDir, ctx.brand);
  const extendsDir = brandConfig.extends
    ? path.join(ctx.brandsDir, brandConfig.extends)
    : null;

  return async (evt: string, file: string) => {
    if (ignored(ctx, file)) return;

    if (evt === "change") {
      const brandRel = relIn(brandDir, file);
      const rel = brandRel ?? (extendsDir ? relIn(extendsDir, file) : null);
      if (!rel) return;
      // extends 檔被當前品牌覆蓋 → runtime 連的是 brand 版本,不受影響
      if (!brandRel && existsSync(path.join(brandDir, rel))) return;
      await relinkIfStale(file, path.join(ctx.runtimeDir, rel));
      return;
    }

    if (evt !== "add" && evt !== "unlink") return;

    const brandRel = relIn(brandDir, file);
    if (brandRel) {
      const runtimeFile = path.join(ctx.runtimeDir, brandRel);
      if (evt === "add") {
        await linkFile(file, runtimeFile);
      } else {
        if (existsSync(runtimeFile)) await fs.unlink(runtimeFile);
        const extendsFile = extendsDir && path.join(extendsDir, brandRel);
        if (extendsFile && existsSync(extendsFile)) {
          await linkFile(extendsFile, runtimeFile);
        }
      }
      return;
    }

    const extRel = extendsDir && relIn(extendsDir, file);
    if (!extRel) return;
    // 當前品牌有同名檔 → runtime 連的是 brand 版本,extends 的變動不影響
    if (existsSync(path.join(brandDir, extRel))) return;

    const runtimeFile = path.join(ctx.runtimeDir, extRel);
    if (evt === "add") {
      await linkFile(file, runtimeFile);
    } else if (existsSync(runtimeFile)) {
      await fs.unlink(runtimeFile);
    }
  };
};

export const shadowPlugin = (
  ctx: ResolvedBrandOptions,
  onReady: () => void,
): Plugin => {
  let brandConfig: BrandConfig = {};

  return {
    name: "vite-plugin-white-label:shadow",
    enforce: "pre",

    config() {
      return {
        publicDir: path.join(ctx.brandsDir, ctx.brand, "public"),
      };
    },

    async configResolved() {
      brandConfig = readBrandConfig(ctx.brandsDir, ctx.brand);
      await createShadow(ctx, brandConfig);
      onReady();
    },

    configureServer(server) {
      server.watcher.add(ctx.brandsDir);
      const handler = createShadowHandler(ctx, brandConfig);
      const brandDir = path.join(ctx.brandsDir, ctx.brand);
      const extendsDir = brandConfig.extends
        ? path.join(ctx.brandsDir, brandConfig.extends)
        : null;

      server.watcher.on("all", (evt, file) => {
        (async () => {
          await handler(evt, file);

          // 模組圖掛的是 runtime 路徑,brands/ 的事件 Vite 不會自己觸發 HMR;
          // 且原子寫入存檔可能以 unlink+add 而非 change 呈現 —— 因此在連結
          // 維護完成後,由這裡統一對 runtime 模組觸發 reload。
          if (ignored(ctx, file)) return;
          const rel =
            relIn(brandDir, file) ??
            (extendsDir ? relIn(extendsDir, file) : null);
          if (!rel) return;
          const runtimeFile = path.join(ctx.runtimeDir, rel);
          if (!existsSync(runtimeFile)) return;
          const mods = server.moduleGraph.getModulesByFile(
            normalizePath(runtimeFile),
          );
          if (mods) {
            await Promise.all([...mods].map((m) => server.reloadModule(m)));
          }
        })().catch((err) => console.error("[vite-plugin-white-label]", err));
      });
    },

    /** 以品牌 config.jsonc 的 title 取代 index.html 中的 =VITE_TITLE= 佔位符 */
    transformIndexHtml(html) {
      return brandConfig.title
        ? html.replace("=VITE_TITLE=", brandConfig.title)
        : html;
    },

    /**
     * HMR 統一由 configureServer 的 watcher 觸發(reloadModule),
     * 這裡只抑制 Vite 對 brands/ 與 runtime 檔案的預設 hot update,避免雙重觸發
     * (macOS 上同 inode 的變更會兩條路徑都發事件;框架無關,.vue/.tsx/css 通用)。
     */
    handleHotUpdate({ file }) {
      const brandDir = path.join(ctx.brandsDir, ctx.brand);
      const extendsDir = brandConfig.extends
        ? path.join(ctx.brandsDir, brandConfig.extends)
        : null;

      if (
        relIn(brandDir, file) ||
        (extendsDir && relIn(extendsDir, file)) ||
        relIn(ctx.runtimeDir, file)
      ) {
        return [];
      }
    },
  };
};
