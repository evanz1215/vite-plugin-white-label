import { describe, expect, it } from "vitest";
import fs from "fs/promises";
import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import {
  createBrand,
  isolateBrand,
  listBrands,
  switchBrand,
  type CliContext,
} from "../src/cli/actions";
import { run } from "../src/cli/run";
import { readBrandConfig } from "../src/options";

const setup = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vpt-cli-"));
  const write = async (rel: string, content: string) => {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  };

  await write("brands/base/config.jsonc", `{ "title": "Base" }`);
  await write("brands/base/components/Logo.vue", "base-logo");
  await write("brands/base/views/Home.vue", "base-home");
  await write("brands/base/public/favicon.ico", "icon");
  await write(
    "brands/client/config.jsonc",
    `{ "title": "Client", "extends": "base" }`,
  );
  await write("brands/client/components/Logo.vue", "client-logo");

  const ctx: CliContext = {
    brandsDir: path.join(root, "brands"),
    envFile: path.join(root, ".env.development"),
    envKey: "VITE_BRAND",
  };
  return { root, ctx };
};

/** 帶假輸入/輸出跑 run(),回傳輸出文字 */
const runCli = async (argv: string[], stdin = "") => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (c) => chunks.push(c));
  if (stdin) input.write(stdin);
  await run(argv, { input, output });
  return Buffer.concat(chunks).toString();
};

describe("cli actions", () => {
  it("switchBrand 改寫品牌變數並保留其他 key", async () => {
    const { root, ctx } = await setup();
    await fs.writeFile(ctx.envFile, "VITE_BRAND=base\nVITE_OTHER=keep\n");

    switchBrand(ctx, "client");

    const env = readFileSync(ctx.envFile, "utf8");
    expect(env).toContain("VITE_BRAND=client");
    expect(env).toContain("VITE_OTHER=keep");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("switchBrand:env 檔不存在時直接建立", async () => {
    const { root, ctx } = await setup();

    switchBrand(ctx, "client");

    expect(readFileSync(ctx.envFile, "utf8")).toBe("VITE_BRAND=client\n");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("createBrand 繼承模式:只建 config.jsonc", async () => {
    const { root, ctx } = await setup();

    await createBrand(ctx, "client-b", "base", false);

    expect(readBrandConfig(ctx.brandsDir, "client-b")).toEqual({
      title: "client-b",
      extends: "base",
    });
    const files = await fs.readdir(path.join(ctx.brandsDir, "client-b"));
    expect(files).toEqual(["config.jsonc"]);

    await fs.rm(root, { recursive: true, force: true });
  });

  it("createBrand isolate 模式:完整複製含 extends 補檔,不設 extends", async () => {
    const { root, ctx } = await setup();

    await createBrand(ctx, "client-full", "client", true);

    const read = (rel: string) =>
      readFileSync(path.join(ctx.brandsDir, "client-full", rel), "utf8");
    expect(read("components/Logo.vue")).toBe("client-logo"); // 來源覆蓋優先
    expect(read("views/Home.vue")).toBe("base-home"); // extends 補檔
    const config = readBrandConfig(ctx.brandsDir, "client-full");
    expect(config.extends).toBeUndefined();
    expect(config.title).toBe("client-full");
    expect(existsSync(path.join(ctx.brandsDir, "client-full", "public"))).toBe(
      false,
    );

    await fs.rm(root, { recursive: true, force: true });
  });

  it("isolateBrand 實體化 extends 並移除設定;已存在的品牌不接受重複建立", async () => {
    const { root, ctx } = await setup();

    await isolateBrand(ctx, "client");

    const read = (rel: string) =>
      readFileSync(path.join(ctx.brandsDir, "client", rel), "utf8");
    expect(read("components/Logo.vue")).toBe("client-logo"); // 自己的覆蓋檔不被蓋掉
    expect(read("views/Home.vue")).toBe("base-home"); // 補進來
    expect(readBrandConfig(ctx.brandsDir, "client").extends).toBeUndefined();

    await expect(createBrand(ctx, "client", "base", false)).rejects.toThrow(
      "品牌已存在",
    );
    await expect(isolateBrand(ctx, "base")).rejects.toThrow("沒有 extends");

    expect((await listBrands(ctx.brandsDir)).map((t) => t.name)).toEqual([
      "base",
      "client",
    ]);

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("cli run", () => {
  it("無指令或 --help 印出用法", async () => {
    expect(await runCli([])).toContain("vite-brand <command>");
    expect(await runCli(["--help"])).toContain("vite-brand <command>");
  });

  it("未知指令 / 不存在的品牌 / 空 build 皆丟錯", async () => {
    const { root, ctx } = await setup();
    const base = ["--dir", ctx.brandsDir, "--env-file", ctx.envFile];

    await expect(runCli(["nope", ...base])).rejects.toThrow("未知指令");
    await expect(runCli(["switch", "ghost", ...base])).rejects.toThrow(
      "品牌不存在:ghost",
    );
    await expect(runCli(["build", ...base])).rejects.toThrow(
      "build 需要至少一個品牌",
    );
    await expect(runCli(["build", "ghost", ...base])).rejects.toThrow(
      "品牌不存在:ghost",
    );

    await fs.rm(root, { recursive: true, force: true });
  });

  it("switch <brand>:非互動直接切換", async () => {
    const { root, ctx } = await setup();

    const out = await runCli([
      "switch",
      "client",
      "--dir",
      ctx.brandsDir,
      "--env-file",
      ctx.envFile,
    ]);

    expect(out).toContain("已切換品牌:client");
    expect(readFileSync(ctx.envFile, "utf8")).toContain("VITE_BRAND=client");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("switch 互動選單:列出全部品牌,當前品牌標示且不可選", async () => {
    const { root, ctx } = await setup();
    await fs.writeFile(ctx.envFile, "VITE_BRAND=base\n");

    // 當前是 base → 照列但選 1 被拒 → 改選 2(client)
    const out = await runCli(
      ["switch", "--dir", ctx.brandsDir, "--env-file", ctx.envFile],
      "1\n2\n",
    );

    expect(out).toContain("1) base (當前品牌)");
    expect(out).toContain("2) client");
    expect(out).toContain("該選項不可選");
    expect(readFileSync(ctx.envFile, "utf8")).toContain("VITE_BRAND=client");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("互動選單:無效編號要求重輸", async () => {
    const { root, ctx } = await setup();

    const out = await runCli(
      ["switch", "--dir", ctx.brandsDir, "--env-file", ctx.envFile],
      "99\n2\n",
    );

    expect(out).toContain("無效的選項");
    expect(readFileSync(ctx.envFile, "utf8")).toContain("VITE_BRAND=client");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("create <name> -f <from>:建立繼承品牌並提示 public", async () => {
    const { root, ctx } = await setup();

    const out = await runCli([
      "create",
      "client-b",
      "-f",
      "base",
      "--dir",
      ctx.brandsDir,
      "--env-file",
      ctx.envFile,
    ]);

    expect(out).toContain("品牌 client-b 已建立(來源:base)");
    expect(out).toContain("public 不會被複製/繼承");
    expect(readBrandConfig(ctx.brandsDir, "client-b").extends).toBe("base");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("create 互動:名稱驗證失敗要求重輸,-i 走 isolate 模式", async () => {
    const { root, ctx } = await setup();

    // "AB" 不合法(大寫、太短)→ 重輸 "client-c";來源選單選 2(client)
    const out = await runCli(
      ["create", "-i", "--dir", ctx.brandsDir, "--env-file", ctx.envFile],
      "AB\nclient-c\n2\n",
    );

    expect(out).toContain("僅限小寫英數與 -");
    const config = readBrandConfig(ctx.brandsDir, "client-c");
    expect(config.extends).toBeUndefined(); // isolate 不繼承
    expect(
      readFileSync(path.join(ctx.brandsDir, "client-c/views/Home.vue"), "utf8"),
    ).toBe("base-home"); // extends 一層補檔

    await fs.rm(root, { recursive: true, force: true });
  });

  it("isolate:互動選單只列出有 extends 的品牌", async () => {
    const { root, ctx } = await setup();

    const out = await runCli(
      ["isolate", "--dir", ctx.brandsDir, "--env-file", ctx.envFile],
      "1\n",
    );

    expect(out).toContain("1) client");
    expect(out).not.toContain("1) base");
    expect(out).toContain("品牌 client 已獨立");
    expect(readBrandConfig(ctx.brandsDir, "client").extends).toBeUndefined();

    await fs.rm(root, { recursive: true, force: true });
  });

  it("isolate:沒有可獨立的品牌時丟錯", async () => {
    const { root, ctx } = await setup();
    await isolateBrand(ctx, "client"); // 先把唯一有 extends 的獨立掉

    await expect(
      runCli(["isolate", "--dir", ctx.brandsDir, "--env-file", ctx.envFile]),
    ).rejects.toThrow("沒有可獨立的品牌");

    await fs.rm(root, { recursive: true, force: true });
  });
});
