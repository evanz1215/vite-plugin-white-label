/**
 * CLI 核心邏輯(無互動,可單元測試)。
 * 移植自 .xgi/core/cli/theme/{switch,create,isolate}。
 */
import fs from "fs/promises";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  assertBrandName,
  DEFAULT_IGNORE,
  isIgnored,
  readBrandConfig,
} from "../options";
import type { BrandConfig } from "../types";

export interface CliContext {
  /** brands 目錄(絕對路徑) */
  brandsDir: string;
  envFile: string;
  envKey: string;
}

export const listBrands = async (brandsDir: string) => {
  if (!existsSync(brandsDir)) return [];
  const entries = await fs.readdir(brandsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({
      name: e.name,
      config: readBrandConfig(brandsDir, e.name),
    }));
};

/**
 * 行首註解偵測。只看行首是刻意的:行尾註解要正確判斷得先剖析字串字面量
 * (避免把 "https://..." 誤判成註解),為了一句警告不值得。
 */
const hasJsoncComment = (src: string) =>
  src.split("\n").some((row) => {
    const t = row.trimStart();
    return t.startsWith("//") || t.startsWith("/*");
  });

/**
 * 寫回 config.jsonc。回傳原檔是否帶有註解 —— JSON.stringify 寫不回註解,
 * 呼叫端要據此提醒使用者。
 */
const writeBrandConfig = (
  brandsDir: string,
  brand: string,
  config: BrandConfig,
): boolean => {
  const file = path.join(brandsDir, brand, "config.jsonc");
  const commentsLost =
    existsSync(file) && hasJsoncComment(readFileSync(file, "utf8"));

  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  return commentsLost;
};

/** 複製 srcDir 下的檔案到 destDir;overwrite=false 時已存在的檔案跳過 */
const copyBrandFiles = (srcDir: string, destDir: string, overwrite: boolean) =>
  fs.cp(srcDir, destDir, {
    recursive: true,
    force: overwrite,
    errorOnExist: false,
    // 比對基準是相對於來源品牌目錄的路徑,srcDir 自身(rel === "")一律放行
    filter: (src) => {
      const rel = path.relative(srcDir, src);
      return rel === "" || !isIgnored(DEFAULT_IGNORE, rel);
    },
  });

/**
 * switch:就地替換 env 檔中品牌變數所在的那一行,其餘位元組完全不動。
 *
 * 不可用 parseEnv 再整份寫回 —— 那會丟掉註解、空行與 key 順序,且未加引號的
 * 值會在 # 處被當成註解截斷(https://a.com/#hash 會變成 https://a.com/)。
 */
export const switchBrand = (ctx: CliContext, brand: string) => {
  assertBrandName(brand); // 寫進 env 的值之後會成為 path.join 的輸入

  const line = ctx.envKey + "=" + brand;
  const src = existsSync(ctx.envFile) ? readFileSync(ctx.envFile, "utf8") : "";
  const rows = src.split("\n");
  const at = rows.findIndex((row) =>
    row.trimStart().startsWith(ctx.envKey + "="),
  );

  if (at >= 0) {
    rows[at] = line;
    writeFileSync(ctx.envFile, rows.join("\n"));
    return;
  }
  // 沒有這個 key:附加到結尾,原內容一字不動
  const tail = src === "" || src.endsWith("\n") ? "" : "\n";
  writeFileSync(ctx.envFile, src + tail + line + "\n");
};

/**
 * create:建立新品牌。
 * - 繼承模式(預設):只建 config.jsonc { title, extends: from } 的薄品牌,差異檔之後再加
 * - isolate 模式:完整複製 from 品牌(含其 extends 一層的補檔),不設 extends
 */
export const createBrand = async (
  ctx: CliContext,
  name: string,
  from: string,
  isolate: boolean,
) => {
  assertBrandName(name);
  assertBrandName(from);

  const target = path.join(ctx.brandsDir, name);
  if (existsSync(target)) {
    throw new Error(`品牌已存在:${name}`);
  }
  if (!existsSync(path.join(ctx.brandsDir, from))) {
    throw new Error(`來源品牌不存在:${from}`);
  }

  await fs.mkdir(target, { recursive: true });

  if (!isolate) {
    writeBrandConfig(ctx.brandsDir, name, { title: name, extends: from });
    return { commentsLost: false }; // 全新檔案,沒有註解可失
  }

  const fromConfig = readBrandConfig(ctx.brandsDir, from);
  await copyBrandFiles(path.join(ctx.brandsDir, from), target, true);
  if (fromConfig.extends) {
    await copyBrandFiles(
      path.join(ctx.brandsDir, fromConfig.extends),
      target,
      false,
    );
  }

  const config: BrandConfig = { ...fromConfig, title: name };
  delete config.extends;
  return { commentsLost: writeBrandConfig(ctx.brandsDir, name, config) };
};

/** isolate:把 extends 中未被覆蓋的檔案實體複製進品牌,並移除 extends 設定 */
export const isolateBrand = async (ctx: CliContext, brand: string) => {
  assertBrandName(brand);
  const config = readBrandConfig(ctx.brandsDir, brand);
  if (!config.extends) {
    throw new Error(`品牌 ${brand} 沒有 extends 設定,毋須獨立`);
  }

  await copyBrandFiles(
    path.join(ctx.brandsDir, config.extends),
    path.join(ctx.brandsDir, brand),
    false,
  );

  delete config.extends;
  return { commentsLost: writeBrandConfig(ctx.brandsDir, brand, config) };
};
