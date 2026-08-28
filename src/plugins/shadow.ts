import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Plugin } from "vite";
import type { ResolvedBrandOptions, BrandConfig } from "../types";
import { isIgnored, normalizePath, readBrandConfig } from "../options";

/**
 * Shadow plugin:建立並維護 .runtime/brand 硬連結合成目錄。
 * 移植自 .xgi/core/vite/plugins/xgi-plugin-shadow;
 * dev 監聽改用 Vite 自帶的 server.watcher(生命週期由 Vite 管理),不另起 chokidar。
 */

/**
 * shadow 目錄的所有權標記。runtimeDir 是使用者可設定的選項,而 createShadow
 * 會整個清空它 —— 誤設成 "./src" 就等於刪光原始碼。有此標記才視為本套件所建。
 */
export const MARKER = ".vite-plugin-white-label";

/** title 會被塞進 index.html,插入前先跳脫;來源雖是本機 config.jsonc,仍不該原樣注入標記 */
const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;"); // 單引號屬性 content='…' 同樣要擋

/** 清空並重建 runtimeDir;拒絕動不是自己建立的目錄 */
const clearRuntimeDir = async (runtimeDir: string) => {
  if (existsSync(runtimeDir)) {
    // 空目錄刪掉沒有任何損失,不必有 marker 也放行 —— 否則 git checkout 之後
    // 留下的空 .runtime/brand 會直接擋住 dev server。
    const entries = await fs.readdir(runtimeDir);
    if (entries.length > 0 && !existsSync(path.join(runtimeDir, MARKER))) {
      throw new Error(
        `runtimeDir 已存在且不是本套件建立的,拒絕刪除:${runtimeDir}` +
          `\n若確定要用這個目錄,請先自行清空。`,
      );
    }
    await fs.rm(runtimeDir, { recursive: true, force: true });
  }
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, MARKER), "");
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
  await clearRuntimeDir(ctx.runtimeDir);

  const linkBrand = async (brand: string) => {
    const dir = path.join(ctx.brandsDir, brand);
    if (!existsSync(dir)) return;

    const files = await fs.readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });

    // 同一品牌內每個檔案的目的路徑互不重疊,可平行 link(跨品牌順序仍序列,見下方呼叫處)
    await Promise.all(
      files
        .filter((f) => f.isFile())
        .map((f) => path.join(f.parentPath, f.name))
        .map((src) => ({ src, rel: path.relative(dir, src) }))
        .filter(({ rel }) => !isIgnored(ctx.ignore, rel))
        .map(({ src, rel }) => linkFile(src, path.join(ctx.runtimeDir, rel))),
    );
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
    if (evt === "change") {
      const brandRel = relIn(brandDir, file);
      const rel = brandRel ?? (extendsDir ? relIn(extendsDir, file) : null);
      if (!rel || isIgnored(ctx.ignore, rel)) return;
      // extends 檔被當前品牌覆蓋 → runtime 連的是 brand 版本,不受影響
      if (!brandRel && existsSync(path.join(brandDir, rel))) return;
      await relinkIfStale(file, path.join(ctx.runtimeDir, rel));
      return;
    }

    if (evt !== "add" && evt !== "unlink") return;

    const brandRel = relIn(brandDir, file);
    if (brandRel) {
      if (isIgnored(ctx.ignore, brandRel)) return;
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
    if (!extRel || isIgnored(ctx.ignore, extRel)) return;
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

/** createWatchHandler 需要的 server 能力,抽成介面讓事件流程可單元測試 */
export interface ShadowWatchDeps {
  /** 對 runtime 檔對應的模組觸發 HMR */
  reload: (runtimeFile: string) => void | Promise<void>;
  /** 整頁重載(繼承鏈變動時細粒度 HMR 沒有意義) */
  fullReload: () => void;
}

/**
 * dev 事件總管:維護連結、處理 config.jsonc 變更、觸發 HMR。
 *
 * 兩件事必須在這裡集中處理:
 * 1. 事件序列化 —— 原子寫入會連續丟出 unlink + add,各開一條 async 鏈的話會交錯,
 *    linkFile 的 existsSync → unlink → link 也就被插隊(TOCTOU)。
 * 2. config.jsonc 熱更新 —— brandConfig 原本只在 configResolved 讀一次,
 *    改 extends 後舊的繼承 handler 會繼續維護錯誤的連結。
 */
export const createWatchHandler = (
  ctx: ResolvedBrandOptions,
  initialConfig: BrandConfig,
  deps: ShadowWatchDeps,
) => {
  let brandConfig = initialConfig;
  let handler = createShadowHandler(ctx, brandConfig);

  /** 監聽清單依 extends 而變,每次事件都要重算 */
  const configFiles = () =>
    [ctx.brand, brandConfig.extends]
      .filter((b): b is string => Boolean(b))
      .flatMap((brand) =>
        ["config.jsonc", "config.json"].map((f) =>
          normalizePath(path.join(ctx.brandsDir, brand, f)),
        ),
      );

  const onEvent = async (evt: string, file: string) => {
    if (configFiles().includes(normalizePath(file))) {
      brandConfig = readBrandConfig(ctx.brandsDir, ctx.brand);
      await createShadow(ctx, brandConfig);
      handler = createShadowHandler(ctx, brandConfig);
      deps.fullReload();
      return;
    }

    await handler(evt, file);

    // 模組圖掛的是 runtime 路徑,brands/ 的事件 Vite 不會自己觸發 HMR;
    // 且原子寫入存檔可能以 unlink+add 而非 change 呈現 —— 因此在連結
    // 維護完成後,由這裡統一對 runtime 模組觸發 reload。
    const brandDir = path.join(ctx.brandsDir, ctx.brand);
    const extendsDir = brandConfig.extends
      ? path.join(ctx.brandsDir, brandConfig.extends)
      : null;
    const rel =
      relIn(brandDir, file) ?? (extendsDir ? relIn(extendsDir, file) : null);
    if (!rel || isIgnored(ctx.ignore, rel)) return;

    const runtimeFile = path.join(ctx.runtimeDir, rel);
    if (!existsSync(runtimeFile)) return;
    await deps.reload(runtimeFile);
  };

  // ponytail: 全域序列化佇列,dev 場景事件量小;要平行化才需要改成 per-file lock
  let queue: Promise<void> = Promise.resolve();

  return {
    enqueue: (evt: string, file: string) => {
      queue = queue
        .then(() => onEvent(evt, file))
        .catch((err) => console.error("[vite-plugin-white-label]", err));
      return queue;
    },
    getConfig: () => brandConfig,
  };
};

export const shadowPlugin = (
  ctx: ResolvedBrandOptions,
  onReady: () => void,
  onFailed: (err: unknown) => void,
): Plugin => {
  let brandConfig: BrandConfig = {};
  let watch: ReturnType<typeof createWatchHandler> | undefined;
  /** 一律讀最新設定:config.jsonc 可能在 dev 期間被改過 */
  const currentConfig = () => watch?.getConfig() ?? brandConfig;

  return {
    name: "vite-plugin-white-label:shadow",
    enforce: "pre",

    config() {
      return {
        publicDir: path.join(ctx.brandsDir, ctx.brand, "public"),
      };
    },

    async configResolved() {
      try {
        brandConfig = readBrandConfig(ctx.brandsDir, ctx.brand);
        await createShadow(ctx, brandConfig);
      } catch (err) {
        onFailed(err); // 不轉發的話 tailwind 的 await shadowReady 會永久 pending
        throw err;
      }
      onReady();
    },

    configureServer(server) {
      server.watcher.add(ctx.brandsDir);
      watch = createWatchHandler(ctx, brandConfig, {
        reload: async (runtimeFile) => {
          const mods = server.moduleGraph.getModulesByFile(
            normalizePath(runtimeFile),
          );
          if (mods) {
            await Promise.all([...mods].map((m) => server.reloadModule(m)));
          }
        },
        fullReload: () => server.ws.send({ type: "full-reload" }),
      });

      server.watcher.on("all", (evt, file) => void watch!.enqueue(evt, file));
    },

    /**
     * 以品牌 config.jsonc 的 title 取代標題佔位符。
     * %VITE_TITLE% 是 Vite 原生語法(建議用法);=VITE_TITLE= 為相容保留。
     */
    transformIndexHtml(html) {
      const title = currentConfig().title;
      if (!title) return html;
      const safe = escapeHtml(title);
      return html
        .replaceAll("%VITE_TITLE%", safe)
        .replaceAll("=VITE_TITLE=", safe);
    },

    /**
     * HMR 統一由 createWatchHandler 觸發(reload/fullReload),
     * 這裡只抑制 Vite 對 brands/ 與 runtime 檔案的預設 hot update,避免雙重觸發
     * (macOS 上同 inode 的變更會兩條路徑都發事件;框架無關,.vue/.tsx/css 通用)。
     */
    handleHotUpdate({ file }) {
      const config = currentConfig();
      const brandDir = path.join(ctx.brandsDir, ctx.brand);
      const extendsDir = config.extends
        ? path.join(ctx.brandsDir, config.extends)
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
