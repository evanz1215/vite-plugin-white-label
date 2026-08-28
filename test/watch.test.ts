import { describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import { existsSync } from "fs";
import { EventEmitter } from "events";
import os from "os";
import path from "path";
import {
  createShadow,
  createShadowHandler,
  createWatchHandler,
  MARKER,
  shadowPlugin,
} from "../src/plugins/shadow";
import { resolveOptions } from "../src/options";

const setup = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vpt-watch-"));
  const write = async (rel: string, content: string) => {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  };

  await write("brands/base/views/Home.vue", "base-home");
  await write(
    "brands/client/config.jsonc",
    `{ "title": "Client", "extends": "base" }`,
  );

  const ctx = resolveOptions({}, { VITE_BRAND: "client" }, root);
  const brandConfig = { extends: "base" };
  await createShadow(ctx, brandConfig);

  return {
    root,
    ctx,
    write,
    handler: createShadowHandler(ctx, brandConfig),
    at: (rel: string) => path.join(root, rel),
    readRuntime: (rel: string) =>
      fs.readFile(path.join(ctx.runtimeDir, rel), "utf8"),
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
};

describe("createShadowHandler", () => {
  it("brand 新增覆蓋檔 → 補鏈;刪除 → 回退連 extends 版本", async () => {
    const { write, handler, at, readRuntime, cleanup } = await setup();

    expect(await readRuntime("views/Home.vue")).toBe("base-home");

    // 客戶新增覆蓋檔 → runtime 改連客戶版本
    await write("brands/client/views/Home.vue", "client-home");
    await handler("add", at("brands/client/views/Home.vue"));
    expect(await readRuntime("views/Home.vue")).toBe("client-home");

    // 客戶刪除覆蓋檔 → 回退連 extends 版本
    await fs.unlink(at("brands/client/views/Home.vue"));
    await handler("unlink", at("brands/client/views/Home.vue"));
    expect(await readRuntime("views/Home.vue")).toBe("base-home");

    await cleanup();
  });

  it("extends 新增/刪除:僅當 brand 沒有同名檔時才影響 runtime", async () => {
    const { ctx, write, handler, at, readRuntime, cleanup } = await setup();

    // extends 新增檔案(客戶沒有)→ 補鏈
    await write("brands/base/views/About.vue", "base-about");
    await handler("add", at("brands/base/views/About.vue"));
    expect(await readRuntime("views/About.vue")).toBe("base-about");

    // extends 刪除檔案(客戶沒有)→ 斷鏈
    await fs.unlink(at("brands/base/views/About.vue"));
    await handler("unlink", at("brands/base/views/About.vue"));
    expect(existsSync(path.join(ctx.runtimeDir, "views/About.vue"))).toBe(
      false,
    );

    // 客戶有同名檔 → extends 的變動不影響 runtime
    await write("brands/client/views/Home.vue", "client-home");
    await handler("add", at("brands/client/views/Home.vue"));
    await write("brands/base/views/Home.vue", "base-home-v2");
    await handler("add", at("brands/base/views/Home.vue"));
    expect(await readRuntime("views/Home.vue")).toBe("client-home");
    await handler("unlink", at("brands/base/views/Home.vue"));
    expect(await readRuntime("views/Home.vue")).toBe("client-home");

    await cleanup();
  });

  it("change 事件:同 inode no-op;原子寫入換 inode 後重連", async () => {
    const { write, handler, at, readRuntime, cleanup } = await setup();

    // 就地寫入:hard link 同 inode 天然同步
    await write("brands/base/views/Home.vue", "base-home-inplace");
    await handler("change", at("brands/base/views/Home.vue"));
    expect(await readRuntime("views/Home.vue")).toBe("base-home-inplace");

    // 原子寫入(temp + rename)換掉 inode → change 事件觸發重連
    await write("brands/base/views/Home.vue.tmp", "base-home-atomic");
    await fs.rename(
      at("brands/base/views/Home.vue.tmp"),
      at("brands/base/views/Home.vue"),
    );
    expect(await readRuntime("views/Home.vue")).toBe("base-home-inplace"); // 斷鏈,還是舊的
    await handler("change", at("brands/base/views/Home.vue"));
    expect(await readRuntime("views/Home.vue")).toBe("base-home-atomic"); // 重連後同步

    await cleanup();
  });

  it("ignore 清單、無關路徑一律 no-op", async () => {
    const { ctx, write, handler, at, readRuntime, cleanup } = await setup();

    await handler("change", at("brands/client/views/Home.vue"));
    expect(await readRuntime("views/Home.vue")).toBe("base-home");

    // ignore 清單(.DS_Store、public/)
    await write("brands/client/.DS_Store", "junk");
    await handler("add", at("brands/client/.DS_Store"));
    await write("brands/client/public/favicon.ico", "icon");
    await handler("add", at("brands/client/public/favicon.ico"));
    expect(existsSync(path.join(ctx.runtimeDir, ".DS_Store"))).toBe(false);
    expect(existsSync(path.join(ctx.runtimeDir, "public/favicon.ico"))).toBe(
      false,
    );

    // brands 之外的路徑(server.watcher 會看到整個專案)
    await write("src/App.vue", "app");
    await handler("add", at("src/App.vue"));
    expect(existsSync(path.join(ctx.runtimeDir, "../src/App.vue"))).toBe(false);
    const runtimeFiles = await fs.readdir(ctx.runtimeDir, { recursive: true });
    expect(
      runtimeFiles.map(String).map((f) => f.replaceAll("\\", "/")),
    ).toEqual([MARKER, "config.jsonc", "views", "views/Home.vue"]);

    await cleanup();
  });
});

describe("shadowPlugin", () => {
  it("configResolved 建 shadow 並通知 ready;configureServer 掛上 watcher 維護連結", async () => {
    const { root, ctx, write, at, readRuntime, cleanup } = await setup();

    const onReady = vi.fn();
    const plugin = shadowPlugin(ctx, onReady, vi.fn());

    // config:publicDir 指向當前品牌的 public
    const conf = (plugin.config as Function)();
    expect(conf.publicDir).toBe(path.join(ctx.brandsDir, "client", "public"));

    await fs.rm(ctx.runtimeDir, { recursive: true, force: true });
    await (plugin.configResolved as Function)({ mode: "development" });
    expect(onReady).toHaveBeenCalledOnce();
    expect(await readRuntime("views/Home.vue")).toBe("base-home");

    // transformIndexHtml:title 佔位符取代(config.jsonc 的 title)
    expect(
      (plugin.transformIndexHtml as Function)("<title>=VITE_TITLE=</title>"),
    ).toBe("<title>Client</title>");

    // configureServer:以假 watcher / moduleGraph 模擬 Vite server
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    const runtimeHome =
      ctx.runtimeDir.replaceAll("\\", "/") + "/views/Home.vue";
    const mod = { id: "home" };
    const server = {
      watcher,
      moduleGraph: {
        getModulesByFile: (f: string) =>
          f === runtimeHome ? new Set([mod]) : undefined,
      },
      reloadModule: vi.fn(),
    };
    (plugin.configureServer as Function)(server);
    expect(watcher.add).toHaveBeenCalledWith(ctx.brandsDir);

    await write("brands/client/views/Home.vue", "client-home");
    watcher.emit("all", "add", at("brands/client/views/Home.vue"));
    await vi.waitFor(async () =>
      expect(await readRuntime("views/Home.vue")).toBe("client-home"),
    );
    // brands 事件 → 連結維護後主動 reload 對應的 runtime 模組
    await vi.waitFor(() =>
      expect(server.reloadModule).toHaveBeenCalledWith(mod),
    );

    await cleanup();
    void root;
  });

  it("handleHotUpdate:brands / runtime 事件一律抑制(HMR 由 watcher 觸發),其餘不介入", async () => {
    const { ctx, at, cleanup } = await setup();
    const plugin = shadowPlugin(ctx, () => {}, vi.fn());
    await (plugin.configResolved as Function)({}); // 載入 brandConfig(extends: base)
    const hot = plugin.handleHotUpdate as Function;

    const modules = [{ id: "x" }];
    const runtimeHome =
      ctx.runtimeDir.replaceAll("\\", "/") + "/views/Home.vue";

    expect(hot({ file: at("brands/client/views/Home.vue"), modules })).toEqual(
      [],
    );
    expect(hot({ file: at("brands/base/views/Home.vue"), modules })).toEqual(
      [],
    );
    expect(hot({ file: runtimeHome, modules })).toEqual([]);
    expect(hot({ file: "/other/src/App.vue", modules })).toBeUndefined();

    await cleanup();
  });
});

describe("createWatchHandler", () => {
  const deps = () => {
    const reloaded: string[] = [];
    let fullReloads = 0;
    return {
      reloaded,
      counts: () => fullReloads,
      deps: {
        reload: (f: string) => {
          reloaded.push(f);
        },
        fullReload: () => {
          fullReloads += 1;
        },
      },
    };
  };

  it("config.jsonc 的 extends 變更會重讀設定並重建 shadow", async () => {
    const { ctx, write, at, readRuntime, cleanup } = await setup();
    await write("brands/base-v2/views/Home.vue", "v2-home");

    const d = deps();
    const watch = createWatchHandler(ctx, { extends: "base" }, d.deps);
    expect(await readRuntime("views/Home.vue")).toBe("base-home");

    await write("brands/client/config.jsonc", `{ "extends": "base-v2" }`);
    await watch.enqueue("change", at("brands/client/config.jsonc"));

    expect(await readRuntime("views/Home.vue")).toBe("v2-home");
    expect(watch.getConfig().extends).toBe("base-v2");
    expect(d.counts()).toBe(1); // 繼承鏈換了,細粒度 HMR 沒有意義

    await cleanup();
  });

  it("config.jsonc 的 title 變更即時反映,不必重啟 dev server", async () => {
    const { ctx, write, at, cleanup } = await setup();

    const watch = createWatchHandler(ctx, { extends: "base" }, deps().deps);

    await write(
      "brands/client/config.jsonc",
      `{ "title": "New", "extends": "base" }`,
    );
    await watch.enqueue("change", at("brands/client/config.jsonc"));

    expect(watch.getConfig().title).toBe("New");

    await cleanup();
  });

  it("交錯的 unlink/add 事件被序列化,最終狀態一致", async () => {
    const { ctx, write, at, readRuntime, cleanup } = await setup();
    await write("brands/client/views/Home.vue", "client-home");

    const watch = createWatchHandler(ctx, { extends: "base" }, deps().deps);
    const file = at("brands/client/views/Home.vue");

    // 模擬 atomic write:watcher 連續丟出 unlink + add,兩者不等待彼此
    const a = watch.enqueue("unlink", file);
    const b = watch.enqueue("add", file);
    await Promise.all([a, b]);

    expect(await readRuntime("views/Home.vue")).toBe("client-home");

    await cleanup();
  });
});

describe("transformIndexHtml", () => {
  const html = (plugin: ReturnType<typeof shadowPlugin>, src: string) =>
    (plugin.transformIndexHtml as Function)(src) as string;

  it("title 做 HTML escape,不得注入可執行標記", async () => {
    const { ctx, write, cleanup } = await setup();
    await write(
      "brands/client/config.jsonc",
      JSON.stringify({ title: "</title><script>alert(1)</script>" }),
    );

    const plugin = shadowPlugin(ctx, () => {}, vi.fn());
    await (plugin.configResolved as Function)({ mode: "development" });

    const out = html(plugin, "<title>=VITE_TITLE=</title>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");

    await cleanup();
  });

  it("同時支援 Vite 原生的 %VITE_TITLE% 佔位符", async () => {
    const { ctx, cleanup } = await setup();

    const plugin = shadowPlugin(ctx, () => {}, vi.fn());
    await (plugin.configResolved as Function)({ mode: "development" });

    expect(html(plugin, "<title>%VITE_TITLE%</title>")).toBe(
      "<title>Client</title>",
    );
    expect(html(plugin, "<title>=VITE_TITLE=</title>")).toBe(
      "<title>Client</title>",
    );

    await cleanup();
  });
});

describe("title escape 的屬性情境", () => {
  it("單引號也要跳脫,否則單引號屬性可被逃逸", async () => {
    const { ctx, write, cleanup } = await setup();
    await write(
      "brands/client/config.jsonc",
      JSON.stringify({ title: "a' onload='alert(1)" }),
    );

    const plugin = shadowPlugin(ctx, () => {}, vi.fn());
    await (plugin.configResolved as Function)({ mode: "development" });

    const out = (plugin.transformIndexHtml as Function)(
      "<meta name='x' content='%VITE_TITLE%'>",
    ) as string;

    expect(out).not.toContain("onload='");
    expect(out).toContain("&#39;");

    await cleanup();
  });
});
