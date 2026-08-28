import {
  defineConfig,
  loadEnv,
  mergeConfig,
  type ConfigEnv,
  type UserConfig,
  type UserConfigExport,
} from "vite";
import { DEFAULT_ENV_KEY, resolveOptions } from "./options";
import { aliasPlugin } from "./plugins/alias";
import { shadowPlugin } from "./plugins/shadow";
import { tailwindPlugin } from "./plugins/tailwind";
import type { BrandOptions } from "./types";

export type { BrandOptions, BrandConfig } from "./types";

/**
 * 包裝 Vite defineConfig:解析當前品牌、注入 white-label plugins。
 * 移植自 .xgi/core/vite/index.ts 的 useXgiDefineConfig
 * (原版 config 函式會被執行兩次的問題在此已修正:只 resolve 一次)。
 *
 * 使用方式:
 * ```ts
 * // vite.config.ts
 * export default defineBrandConfig(
 *   { aliases: { "@stores": "./src/stores" } },
 *   ({ mode }) => ({ plugins: [vue()] }),
 * );
 * ```
 */
export const defineBrandConfig = (
  options: BrandOptions = {},
  config: UserConfigExport = {},
) =>
  defineConfig(async (confEnv: ConfigEnv) => {
    // loadEnv 預設只回傳 VITE_ 前綴的變數,自訂 envKey 必須當作 prefix 傳入,
    // 否則 env[envKey] 永遠是 undefined,靜默 fallback 到 defaultBrand。
    // 不可傳空字串 —— 那會把整個 process.env 灌進來。
    const envKey = options.envKey ?? DEFAULT_ENV_KEY;
    const env = loadEnv(confEnv.mode, process.cwd(), envKey);
    const ctx = resolveOptions(options, env);

    // shadow 建好後 resolve,tailwind plugin 以此排序(取代原本的輪詢 queue)
    let onShadowReady!: () => void;
    let onShadowFailed!: (err: unknown) => void;
    const shadowReady = new Promise<void>((res, rej) => {
      onShadowReady = res;
      onShadowFailed = rej;
    });
    // tailwind 關閉時沒有人 await,吸收掉以免變成 unhandled rejection
    shadowReady.catch(() => {});

    const userConfig: UserConfig =
      typeof config === "function" ? await config(confEnv) : await config;

    return mergeConfig(userConfig, {
      // defineDev: false 時整個 define 都不放,讓使用者自己的 define.DEV 留著
      ...(options.defineDev === false
        ? {}
        : { define: { DEV: confEnv.mode === "development" } }),
      plugins: [
        aliasPlugin(ctx),
        shadowPlugin(ctx, onShadowReady, onShadowFailed),
        tailwindPlugin(ctx, shadowReady),
      ],
    });
  });
