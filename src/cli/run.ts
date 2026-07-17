/**
 * CLI 解析與指令分派(可測試:錯誤用 throw,互動用 io 注入)。
 * switch / create / isolate / build,全用 node:util parseArgs + readline,零依賴。
 */
import path from "path";
import { existsSync, readFileSync } from "fs";
import { parseArgs, parseEnv, styleText } from "node:util";
import readline from "node:readline";
import {
  createBrand,
  isolateBrand,
  listBrands,
  switchBrand,
  type CliContext,
} from "./actions";
import { buildBrands } from "./build";

export interface RunIO {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

const HELP = `vite-brand <command>

指令:
  switch [brand]              切換品牌(改寫 env 檔的品牌變數)
  create [brand]              建立新品牌(--from/-f 來源;--isolate/-i 完整複製不繼承)
  isolate [brand]             將繼承品牌獨立成完整品牌
  build <brands..>            依序打包多個品牌,各自輸出到 <out-dir>/<brand>/

選項:
  --dir       brands 目錄(預設 ./brands)
  --env-file  品牌環境變數檔(預設 .env.development)
  --env-key   品牌環境變數名(預設 VITE_BRAND)
  --out-dir, -o  build 輸出根目錄(預設 dist)
  --config, -c   build 用的 vite config 路徑(預設自動尋找)
  --help, -h     顯示說明
`;

const green = (s: string) => styleText("green", s);
const yellow = (s: string) => styleText("yellow", s);

export const run = async (argv: string[], io: RunIO = {}) => {
  const output = io.output ?? process.stdout;

  // 整個 run 共用一個 readline,以其內建的 async iterator 取行:
  // iterator 本身就會緩衝「還沒被消費」的行(rl.question 才會丟掉),
  // 不需要自己再刻一份 lines/waiters 佇列
  let rl: readline.Interface | undefined;
  let lineIter: AsyncIterator<string> | undefined;
  const question = async (q: string) => {
    if (!rl) {
      rl = readline.createInterface({
        input: io.input ?? process.stdin,
        output,
      });
      lineIter = rl[Symbol.asyncIterator]();
    }
    output.write(q);
    const { value } = await lineIter!.next();
    return value ?? "";
  };

  /** 數字選單(inquirer list 的原生替代);disabled 項照列但不可選 */
  const pick = async (
    message: string,
    choices: { name: string; hint?: string; disabled?: boolean }[],
  ): Promise<string> => {
    output.write(`\n${message}\n`);
    choices.forEach((c, i) => {
      const hint = c.hint ? ` ${c.hint}` : "";
      output.write(`  ${i + 1}) ${c.name}${hint}\n`);
    });
    for (;;) {
      const answer = await question("請輸入編號: ");
      const choice = choices[Number(answer) - 1];
      if (choice && !choice.disabled) return choice.name;
      const msg = choice
        ? "該選項不可選,請重新輸入\n"
        : "無效的選項,請重新輸入\n";
      output.write(msg);
    }
  };

  /** 文字輸入 + 驗證 */
  const ask = async (
    message: string,
    validate: (input: string) => true | string,
  ): Promise<string> => {
    for (;;) {
      const answer = await question(`${message}: `);
      const result = validate(answer);
      if (result === true) return answer;
      output.write(`${result}\n`);
    }
  };
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: "string", default: "./brands" },
      "env-file": { type: "string", default: ".env.development" },
      "env-key": { type: "string", default: "VITE_BRAND" },
      from: { type: "string", short: "f" },
      isolate: { type: "boolean", short: "i", default: false },
      "out-dir": { type: "string", short: "o", default: "dist" },
      config: { type: "string", short: "c" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [command, ...args] = positionals;
  if (values.help || !command) {
    output.write(HELP);
    return;
  }

  const ctx: CliContext = {
    brandsDir: path.resolve(process.cwd(), values.dir),
    envFile: path.resolve(process.cwd(), values["env-file"]),
    envKey: values["env-key"],
  };

  const requireBrands = async () => {
    const brands = await listBrands(ctx.brandsDir);
    if (brands.length === 0) {
      throw new Error(`找不到任何品牌(${ctx.brandsDir})`);
    }
    return brands;
  };

  try {
    switch (command) {
      case "switch": {
        const brands = await requireBrands();
        const current = existsSync(ctx.envFile)
          ? parseEnv(readFileSync(ctx.envFile, "utf8"))[ctx.envKey]
          : undefined;

        const brand =
          args[0] ??
          (await pick(
            "請選擇要切換的品牌",
            brands.map((t) => ({
              name: t.name,
              hint: t.name === current ? "(當前品牌)" : "",
              disabled: t.name === current,
            })),
          ));

        if (!brands.some((t) => t.name === brand)) {
          throw new Error(`品牌不存在:${brand}`);
        }
        switchBrand(ctx, brand);
        output.write(`\n${green("✔")} 已切換品牌:${brand}\n`);
        break;
      }

      case "create": {
        const name =
          args[0] ??
          (await ask(
            "請輸入品牌名稱",
            (input) =>
              /^[a-z0-9][a-z0-9-]{2,}$/.test(input) ||
              "至少 3 個字元,僅限小寫英數與 -",
          ));

        const brands = await requireBrands();
        const from =
          values.from ??
          (await pick(
            "請選擇來源品牌",
            brands.map((t) => ({
              name: t.name,
              hint: t.config.extends ? `(繼承自 ${t.config.extends})` : "",
            })),
          ));

        await createBrand(ctx, name, from, values.isolate);
        output.write(`\n${green("✔")} 品牌 ${name} 已建立(來源:${from})\n`);
        if (existsSync(path.join(ctx.brandsDir, from, "public"))) {
          output.write(
            `${yellow("!")} 來源品牌有 public 目錄,public 不會被複製/繼承,請自行處理\n`,
          );
        }
        break;
      }

      case "isolate": {
        const brands = await requireBrands();
        const candidates = brands.filter((t) => t.config.extends);
        if (args[0] === undefined && candidates.length === 0) {
          throw new Error("沒有可獨立的品牌(皆無 extends 設定)");
        }

        const brand =
          args[0] ??
          (await pick(
            "請選擇要獨立的品牌",
            candidates.map((t) => ({
              name: t.name,
              hint: `(繼承自 ${t.config.extends})`,
            })),
          ));

        await isolateBrand(ctx, brand);
        output.write(`\n${green("✔")} 品牌 ${brand} 已獨立\n`);
        break;
      }

      case "build": {
        const brands = args.flatMap((t) => t.split(","));
        if (brands.length === 0) {
          throw new Error("build 需要至少一個品牌");
        }
        await buildBrands({
          brandsDir: ctx.brandsDir,
          brands,
          outDir: values["out-dir"],
          configFile: values.config,
        });
        break;
      }

      default:
        throw new Error(`未知指令:${command}\n\n${HELP}`);
    }
  } finally {
    rl?.close();
  }
};
