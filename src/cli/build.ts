/**
 * 多品牌批次打包。
 * 移植自 .xgi/core/cli/themeBuilder.ts:每個品牌設 VITE_BRAND 後呼叫 Vite build API,
 * 輸出到 <outDir>/<brand>/。必須依序執行(shadow 的 .runtime/brand 是全域單例)。
 */
import path from "path";
import { existsSync } from "fs";

export const buildBrands = async (opts: {
  brandsDir: string;
  brands: string[];
  outDir: string;
  configFile?: string;
}) => {
  // 動態載入:switch/create/isolate 不需要 vite
  const { build } = await import("vite");

  for (const brand of opts.brands) {
    if (!existsSync(path.join(opts.brandsDir, brand))) {
      throw new Error(`品牌不存在:${brand}`);
    }
  }

  for (const brand of opts.brands) {
    console.log(
      `\n[vite-plugin-white-label] ======== build: ${brand} ========\n`,
    );
    // defineBrandConfig 的 loadEnv 會讀 process.env,優先於 .env 檔
    process.env.VITE_BRAND = brand;

    await build({
      configFile: opts.configFile
        ? path.resolve(process.cwd(), opts.configFile)
        : undefined,
      build: {
        outDir: path.resolve(process.cwd(), opts.outDir, brand),
        emptyOutDir: true,
      },
    });
  }

  console.log(
    `\n[vite-plugin-white-label] ✔ ${opts.brands.length} 個品牌已打包到 ${opts.outDir}/<brand>/\n`,
  );
};
