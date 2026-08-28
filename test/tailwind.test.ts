import { describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { EventEmitter } from "events";
import os from "os";
import path from "path";
import { tailwindPlugin } from "../src/plugins/tailwind";
import { resolveOptions } from "../src/options";

const setup = async (tailwind: boolean | { presetPath?: string } = true) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vpt-tw-"));
  const write = async (rel: string, content: string) => {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  };
  const ctx = resolveOptions({ tailwind }, { VITE_BRAND: "client" }, root);
  return {
    root,
    ctx,
    write,
    presetPath: ctx.tailwind ? ctx.tailwind.presetPath : "",
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
};

describe("tailwindPlugin", () => {
  it("等 shadowReady 後才同步:品牌有設定檔就複製", async () => {
    const { ctx, write, presetPath, cleanup } = await setup();
    await write("brands/client/tailwind.config.ts", "export default { a: 1 };");

    let ready!: () => void;
    const shadowReady = new Promise<void>((r) => (ready = r));
    const plugin = tailwindPlugin(ctx, shadowReady);

    let resolved = false;
    const p = (plugin.configResolved as Function)().then(
      () => (resolved = true),
    );
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false); // shadow 未完成前不動作
    expect(existsSync(presetPath)).toBe(false);

    ready();
    await p;
    expect(readFileSync(presetPath, "utf8")).toBe("export default { a: 1 };");

    await cleanup();
  });

  it("品牌沒有設定檔:一律寫回空 preset(不保留前一個品牌的殘留)", async () => {
    const { ctx, presetPath, cleanup } = await setup();
    const plugin = tailwindPlugin(ctx, Promise.resolve());

    await (plugin.configResolved as Function)();
    expect(readFileSync(presetPath, "utf8")).toBe("export default {};\n");

    // 舊行為是「已存在就不覆蓋」,會讓切換品牌後舊 preset 繼續生效
    await fs.writeFile(presetPath, "export default { stale: true };");
    await (plugin.configResolved as Function)();
    expect(readFileSync(presetPath, "utf8")).toBe("export default {};\n");

    await cleanup();
  });

  it("tailwind: false 時完全不動作", async () => {
    const { ctx, root, cleanup } = await setup(false);
    const plugin = tailwindPlugin(ctx, Promise.resolve());

    await (plugin.configResolved as Function)();
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    (plugin.configureServer as Function)({ watcher });

    expect(watcher.add).not.toHaveBeenCalled();
    expect(existsSync(path.join(root, ".brand-env"))).toBe(false);

    await cleanup();
  });

  it("dev:server.watcher 收到品牌 tailwind.config.ts 變更時重新同步", async () => {
    const { ctx, write, presetPath, cleanup } = await setup();
    await write("brands/client/tailwind.config.ts", "export default { v: 1 };");

    const plugin = tailwindPlugin(ctx, Promise.resolve());
    await (plugin.configResolved as Function)();
    expect(readFileSync(presetPath, "utf8")).toContain("v: 1");

    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    (plugin.configureServer as Function)({ watcher });
    const brandTwConfig = path.join(
      ctx.brandsDir,
      "client",
      "tailwind.config.ts",
    );
    expect(watcher.add).toHaveBeenCalledWith(ctx.brandsDir);

    // 品牌設定內容變更 → 事件觸發重新複製
    await write("brands/client/tailwind.config.ts", "export default { v: 2 };");
    watcher.emit("all", "change", brandTwConfig);
    await vi.waitFor(() =>
      expect(readFileSync(presetPath, "utf8")).toContain("v: 2"),
    );

    // 無關檔案的事件不觸發
    await write("brands/client/tailwind.config.ts", "export default { v: 3 };");
    watcher.emit(
      "all",
      "change",
      path.join(ctx.brandsDir, "client", "other.ts"),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(readFileSync(presetPath, "utf8")).toContain("v: 2");

    await cleanup();
  });
});

describe("preset 殘留", () => {
  it("品牌設定被刪除後 preset 要退回空設定,而非留著舊內容", async () => {
    const { ctx, write, presetPath, cleanup } = await setup();
    await write(
      "brands/client/tailwind.config.ts",
      "export default { theme: 1 };",
    );

    const shadowReady = Promise.resolve();
    const plugin = tailwindPlugin(ctx, shadowReady);

    await (plugin.configResolved as Function)();
    expect(readFileSync(presetPath, "utf8")).toContain("theme");

    await fs.rm(path.join(ctx.brandsDir, "client", "tailwind.config.ts"));
    await (plugin.configResolved as Function)();

    expect(readFileSync(presetPath, "utf8")).toBe("export default {};\n");

    await cleanup();
  });
});

describe("extends 的 tailwind 設定", () => {
  it("當前品牌沒有設定時,採用 extends 品牌的", async () => {
    const { ctx, write, presetPath, cleanup } = await setup();
    await write("brands/client/config.jsonc", `{ "extends": "base" }`);
    await write(
      "brands/base/tailwind.config.ts",
      "export default { from: 'base' };",
    );

    const plugin = tailwindPlugin(ctx, Promise.resolve());
    await (plugin.configResolved as Function)();

    expect(readFileSync(presetPath, "utf8")).toContain("base");

    await cleanup();
  });

  it("當前品牌的設定優先於 extends", async () => {
    const { ctx, write, presetPath, cleanup } = await setup();
    await write("brands/client/config.jsonc", `{ "extends": "base" }`);
    await write(
      "brands/base/tailwind.config.ts",
      "export default { from: 'base' };",
    );
    await write(
      "brands/client/tailwind.config.ts",
      "export default { from: 'client' };",
    );

    const plugin = tailwindPlugin(ctx, Promise.resolve());
    await (plugin.configResolved as Function)();

    expect(readFileSync(presetPath, "utf8")).toContain("client");

    await cleanup();
  });

  it("extends 品牌的設定變更也會觸發同步", async () => {
    const { ctx, write, presetPath, cleanup } = await setup();
    await write("brands/client/config.jsonc", `{ "extends": "base" }`);
    await write("brands/base/tailwind.config.ts", "export default { v: 1 };");

    const plugin = tailwindPlugin(ctx, Promise.resolve());
    await (plugin.configResolved as Function)();
    expect(readFileSync(presetPath, "utf8")).toContain("v: 1");

    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    (plugin.configureServer as Function)({ watcher });

    await write("brands/base/tailwind.config.ts", "export default { v: 2 };");
    watcher.emit(
      "all",
      "change",
      path.join(ctx.brandsDir, "base", "tailwind.config.ts"),
    );

    await vi.waitFor(() =>
      expect(readFileSync(presetPath, "utf8")).toContain("v: 2"),
    );

    await cleanup();
  });

  it("config.jsonc 改掉 extends 之後 preset 跟著換來源", async () => {
    const { ctx, write, presetPath, cleanup } = await setup();
    await write("brands/client/config.jsonc", `{ "extends": "base" }`);
    await write("brands/base/tailwind.config.ts", "export default { v: 1 };");
    await write(
      "brands/base-v2/tailwind.config.ts",
      "export default { v: 2 };",
    );

    const plugin = tailwindPlugin(ctx, Promise.resolve());
    await (plugin.configResolved as Function)();
    expect(readFileSync(presetPath, "utf8")).toContain("v: 1");

    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    (plugin.configureServer as Function)({ watcher });

    await write("brands/client/config.jsonc", `{ "extends": "base-v2" }`);
    watcher.emit(
      "all",
      "change",
      path.join(ctx.brandsDir, "client", "config.jsonc"),
    );

    await vi.waitFor(() =>
      expect(readFileSync(presetPath, "utf8")).toContain("v: 2"),
    );

    await cleanup();
  });
});
