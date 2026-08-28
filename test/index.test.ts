import { describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { ConfigEnv, Plugin, UserConfig } from "vite";
import { defineBrandConfig } from "../src";

const resolve = async (
  fn: unknown,
  env: ConfigEnv = { mode: "development", command: "serve" },
) => (fn as (env: ConfigEnv) => Promise<UserConfig>)(env);

describe("defineBrandConfig", () => {
  it("合併使用者設定並注入 DEV define 與三個 white-label plugins", async () => {
    const config = await resolve(
      defineBrandConfig({}, ({ mode }) => ({
        base: `/${mode}/`,
        plugins: [{ name: "user-plugin" }],
      })),
    );

    expect(config.base).toBe("/development/");
    expect(config.define?.DEV).toBe(true);
    expect((config.plugins as Plugin[]).map((p) => p.name)).toEqual([
      "user-plugin",
      "vite-plugin-white-label:alias",
      "vite-plugin-white-label:shadow",
      "vite-plugin-white-label:tailwind",
    ]);

    // alias plugin 注入 @brand 系列
    const alias = (config.plugins as Plugin[]).find(
      (p) => p.name === "vite-plugin-white-label:alias",
    )!;
    const aliasConf = (alias.config as Function)();
    expect(Object.keys(aliasConf.resolve.alias)).toEqual([
      "@brand",
      "@brand-components",
      "@brand-router",
      "@brand-assets",
    ]);
  });

  it("兩個參數皆可省略;production 時 DEV 為 false", async () => {
    const config = await resolve(defineBrandConfig(), {
      mode: "production",
      command: "build",
    });

    expect(config.define?.DEV).toBe(false);
    expect((config.plugins as Plugin[]).length).toBe(3);
  });
});

describe("shadowReady 失敗傳播", () => {
  it("createShadow 失敗時 tailwind 的等待被 reject,不會永久 pending", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vpt-ready-"));
    const runtimeDir = path.join(root, "occupied");
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(path.join(runtimeDir, "precious.txt"), "keep");

    const config = await resolve(
      defineBrandConfig({
        runtimeDir,
        tailwind: true,
        defaultBrand: "base",
        brandsDir: path.join(root, "brands"),
      }),
    );
    const plugins = config.plugins as Plugin[];
    const shadow = plugins.find((p) => p.name.endsWith(":shadow"))!;
    const tailwind = plugins.find((p) => p.name.endsWith(":tailwind"))!;

    // tailwind 先進入等待,再讓 shadow 失敗
    const waiting = (tailwind.configResolved as Function)();
    await expect((shadow.configResolved as Function)()).rejects.toThrow(
      "拒絕刪除",
    );
    await expect(waiting).rejects.toThrow("拒絕刪除");

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("自訂 envKey", () => {
  it("非 VITE_ 前綴的 envKey 也能從 env 檔讀到品牌", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vpt-envkey-"));
    await fs.writeFile(path.join(root, ".env.development"), "BRAND=client-a\n");
    await fs.mkdir(path.join(root, "brands/client-a"), { recursive: true });

    const cwd = process.cwd();
    process.chdir(root); // defineBrandConfig 的 loadEnv 讀 process.cwd()
    try {
      const config = await resolve(
        defineBrandConfig({ envKey: "BRAND", defaultBrand: "base" }),
      );
      const shadow = (config.plugins as Plugin[]).find((p) =>
        p.name.endsWith(":shadow"),
      )!;
      // publicDir 帶品牌名,是唯一能從 config 觀察到當前品牌的出口
      const shadowConf = (shadow.config as Function)();
      expect(shadowConf.publicDir).toContain("client-a");
    } finally {
      process.chdir(cwd);
    }

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("defineDev 選項", () => {
  it("預設仍注入 DEV(維持相容)", async () => {
    const config = await resolve(defineBrandConfig());
    expect(config.define?.DEV).toBe(true);
  });

  it("defineDev: false 時不注入,也不覆蓋使用者自己的 define.DEV", async () => {
    const config = await resolve(
      defineBrandConfig({ defineDev: false }, { define: { DEV: '"mine"' } }),
    );
    expect(config.define?.DEV).toBe('"mine"');
  });
});
