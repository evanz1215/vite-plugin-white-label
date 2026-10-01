import { describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { existsSync } from "fs";
import { createShadow, MARKER } from "../src/plugins/shadow";
import { readBrandConfig, resolveOptions } from "../src/options";

const setup = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vpt-"));
  const write = async (rel: string, content: string) => {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  };

  await write("brands/base/components/Logo.vue", "base-logo");
  await write("brands/base/views/Home.vue", "base-home");
  await write("brands/base/public/favicon.ico", "icon");
  await write("brands/client/components/Logo.vue", "client-logo");

  const ctx = resolveOptions({}, { VITE_BRAND: "client" }, root);
  return { root, ctx };
};

describe("createShadow", () => {
  it("客戶檔案覆蓋 extends,缺檔由 extends 補上,public 不進 shadow", async () => {
    const { root, ctx } = await setup();

    await createShadow(ctx, { extends: "base" });

    const read = (rel: string) =>
      fs.readFile(path.join(ctx.runtimeDir, rel), "utf8");

    expect(await read("components/Logo.vue")).toBe("client-logo"); // 覆蓋
    expect(await read("views/Home.vue")).toBe("base-home"); // 繼承補鏈
    await expect(read("public/favicon.ico")).rejects.toThrow(); // ignore

    // hard link:同 inode,改來源內容 runtime 立即同步
    await fs.writeFile(
      path.join(root, "brands/client/components/Logo.vue"),
      "client-logo-v2",
    );
    expect(await read("components/Logo.vue")).toBe("client-logo-v2");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("無 extends 時只鋪當前品牌", async () => {
    const { root, ctx } = await setup();

    await createShadow(ctx, {});

    const files = await fs.readdir(ctx.runtimeDir, { recursive: true });
    expect(files.map(String).map((f) => f.replaceAll("\\", "/"))).toEqual([
      MARKER,
      "components",
      "components/Logo.vue",
    ]);

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("runtimeDir 所有權防護", () => {
  it("拒絕清除不是本套件建立的 runtimeDir,原有內容不動", async () => {
    const { root, ctx } = await setup();
    await fs.mkdir(ctx.runtimeDir, { recursive: true });
    await fs.writeFile(path.join(ctx.runtimeDir, "precious.txt"), "keep me");

    await expect(createShadow(ctx, {})).rejects.toThrow("拒絕刪除");
    expect(
      await fs.readFile(path.join(ctx.runtimeDir, "precious.txt"), "utf8"),
    ).toBe("keep me");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("自己建立的 runtimeDir 可以重複重建(dev server 重啟)", async () => {
    const { root, ctx } = await setup();

    await createShadow(ctx, {});
    await expect(createShadow(ctx, {})).resolves.not.toThrow();

    // marker 在重建後仍在
    expect(existsSync(path.join(ctx.runtimeDir, MARKER))).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });

  it("清空刪到一半失敗(重啟重疊、Windows ENOTEMPTY)後,下一次重建必須能恢復", async () => {
    const { root, ctx } = await setup();
    await createShadow(ctx, {});

    // 模擬刪整個 runtimeDir 時只刪掉了 marker 就 ENOTEMPTY 的情況
    const realRm = fs.rm;
    const spy = vi.spyOn(fs, "rm").mockImplementation(async (p, opts) => {
      if (path.resolve(String(p)) === path.resolve(ctx.runtimeDir)) {
        await realRm(path.join(ctx.runtimeDir, MARKER), { force: true });
        throw Object.assign(new Error("ENOTEMPTY"), { code: "ENOTEMPTY" });
      }
      return realRm(p, opts);
    });
    await createShadow(ctx, {}).catch(() => {});
    spy.mockRestore();

    await expect(createShadow(ctx, {})).resolves.not.toThrow();
    expect(existsSync(path.join(ctx.runtimeDir, MARKER))).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("ignore 比對基準", () => {
  it("專案路徑本身含 public/ 時不得誤過濾整個品牌", async () => {
    // 重現 /var/www/public/myapp 這類部署路徑
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vpt-pub-"));
    const root = path.join(tmp, "public", "proj");
    const write = async (rel: string, content: string) => {
      const p = path.join(root, rel);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content);
    };
    await write("brands/base/components/Logo.vue", "base-logo");

    const ctx = resolveOptions({}, { VITE_BRAND: "base" }, root);
    await createShadow(ctx, {});

    expect(existsSync(path.join(ctx.runtimeDir, "components/Logo.vue"))).toBe(
      true,
    );

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("品牌內的 public/ 仍然被過濾", async () => {
    const { root, ctx } = await setup();

    await createShadow(ctx, { extends: "base" });

    expect(existsSync(path.join(ctx.runtimeDir, "public"))).toBe(false);
    expect(existsSync(path.join(ctx.runtimeDir, "public/favicon.ico"))).toBe(
      false,
    );

    await fs.rm(root, { recursive: true, force: true });
  });

  it("只是字尾像 ignore 項目的檔案不該被過濾", async () => {
    const { root, ctx } = await setup();
    await fs.writeFile(
      path.join(root, "brands/client/my.DS_Store_backup"),
      "x",
    );

    await createShadow(ctx, {});

    expect(existsSync(path.join(ctx.runtimeDir, "my.DS_Store_backup"))).toBe(
      true,
    );

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("extends 邊界", () => {
  it("config.jsonc 的 extends 不得逃出 brandsDir", async () => {
    const { root, cleanup } = await (async () => {
      const r = await fs.mkdtemp(path.join(os.tmpdir(), "vpt-ext-"));
      const w = async (rel: string, c: string) => {
        const p = path.join(r, rel);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, c);
      };
      await w("secret/leak.txt", "should not be linked");
      await w("brands/client/config.jsonc", `{ "extends": "../secret" }`);
      return {
        root: r,
        cleanup: () => fs.rm(r, { recursive: true, force: true }),
      };
    })();

    expect(() => readBrandConfig(path.join(root, "brands"), "client")).toThrow(
      "品牌名不合法",
    );

    await cleanup();
  });
});

describe("codex 回饋修正", () => {
  it("既有但空的 runtimeDir 視為可用,不該擋住 dev server", async () => {
    const { root, ctx, cleanup } = await (async () => {
      const s = await setup();
      return {
        ...s,
        cleanup: () => fs.rm(s.root, { recursive: true, force: true }),
      };
    })();
    await fs.mkdir(ctx.runtimeDir, { recursive: true });

    await expect(createShadow(ctx, {})).resolves.not.toThrow();

    void root;
    await cleanup();
  });

  it("非字串的 title 在讀取時就被拒絕,不會炸在 transformIndexHtml", async () => {
    const r = await fs.mkdtemp(path.join(os.tmpdir(), "vpt-title-"));
    await fs.mkdir(path.join(r, "brands/a"), { recursive: true });
    await fs.writeFile(
      path.join(r, "brands/a/config.jsonc"),
      `{ "title": 123 }`,
    );

    expect(() => readBrandConfig(path.join(r, "brands"), "a")).toThrow(
      "title 必須是字串",
    );

    await fs.rm(r, { recursive: true, force: true });
  });
});
