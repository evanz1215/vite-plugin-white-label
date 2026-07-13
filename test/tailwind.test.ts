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
  it("等 shadowReady 後才同步:runtime 有設定檔就複製", async () => {
    const { ctx, write, presetPath, cleanup } = await setup();
    await write(
      ".runtime/brand/tailwind.config.ts",
      "export default { a: 1 };",
    );

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

  it("runtime 沒有設定檔:preset 不存在時寫入空 preset,已存在則不覆蓋", async () => {
    const { ctx, presetPath, cleanup } = await setup();
    const plugin = tailwindPlugin(ctx, Promise.resolve());

    await (plugin.configResolved as Function)();
    expect(readFileSync(presetPath, "utf8")).toBe("export default {};\n");

    await fs.writeFile(presetPath, "export default { keep: true };");
    await (plugin.configResolved as Function)();
    expect(readFileSync(presetPath, "utf8")).toBe(
      "export default { keep: true };",
    );

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
    await write(
      ".runtime/brand/tailwind.config.ts",
      "export default { v: 1 };",
    );

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
    expect(watcher.add).toHaveBeenCalledWith(brandTwConfig);

    // 模擬品牌設定變更(hard link 下 runtime 檔內容已同步),事件觸發重新複製
    await write(
      ".runtime/brand/tailwind.config.ts",
      "export default { v: 2 };",
    );
    watcher.emit("all", "change", brandTwConfig);
    await vi.waitFor(() =>
      expect(readFileSync(presetPath, "utf8")).toContain("v: 2"),
    );

    // 無關檔案的事件不觸發
    await write(
      ".runtime/brand/tailwind.config.ts",
      "export default { v: 3 };",
    );
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
