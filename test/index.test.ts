import { describe, expect, it } from "vitest";
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
