# vite-plugin-white-label

[繁體中文](./README.zh-TW.md) | [English](./README.md) | 日本語

Vite 向けのフレームワーク非依存(Vue / React どちらも可)なホワイトレーベル(マルチブランド)システムです。**ハードリンクで合成したシャドウディレクトリ** により実現しています。

- 🏷️ **ブランド切り替え** — 環境変数ひとつで現在のブランドを決定、業務コードの変更は不要
- 🧬 **ブランド継承(`extends`)** — クライアントブランドは差分ファイルだけを置けば、それ以外は自動的にベースブランドを引き継ぐ
- ⚡ **即時 HMR** — `brands/` 配下のファイルを編集すると即座にホットリロード、エディタのアトミック書き込みによるリンク切れも自動で修復
- 📦 **マルチブランド一括ビルド** — 1コマンドで各ブランドをそれぞれ独立デプロイ可能なサイトとして出力
- 🔧 **CLI 管理ツール** — 対話形式でブランドの切り替え・作成・独立化が可能

> 要件:Node >= 20.12、Vite >= 5。`json5` 以外の依存なし。

## インストール

```bash
npm install -D vite-plugin-white-label
# または
pnpm add -D vite-plugin-white-label
```

## クイックスタート

### 1. vite.config.ts を設定

```ts
import vue from "@vitejs/plugin-vue";
import { defineBrandConfig } from "vite-plugin-white-label";

export default defineBrandConfig(
  {}, // ブランドオプション(下記「オプション」を参照)
  ({ mode }) => ({
    plugins: [vue()],
  }),
);
```

React プロジェクトではフレームワークプラグインを差し替えるだけで、それ以外は完全に同じです。

```ts
import react from "@vitejs/plugin-react";
import { defineBrandConfig } from "vite-plugin-white-label";

export default defineBrandConfig({}, { plugins: [react()] });
```

### 2. package.json に CLI script を追加

```json
{
  "scripts": {
    "dev": "vite",
    "brand": "vite-brand"
  }
}
```

以降、ブランド関連の操作はすべてこの script 経由で行います。

```bash
pnpm brand switch            # pnpm / yarn:引数はそのまま後ろに続ける
npm run brand -- switch      # npm:引数を渡すには -- を忘れずに
```

### 3. ブランドディレクトリを作成

```
brands/
├── base/                     # ベースブランド(完全版)
│   ├── config.jsonc          # { "title": "Base App" }
│   ├── components/
│   │   ├── Banner.vue
│   │   └── Footer.vue
│   └── assets/
└── client-a/                 # クライアントブランド(差分ファイルのみ)
    ├── config.jsonc          # { "title": "Client A", "extends": "base" }
    └── components/
        └── Banner.vue        # base の Banner を上書き、Footer は base のまま引き継ぐ
```

### 4. 業務コードから alias 経由でブランドを参照

```vue
<script setup lang="ts">
// 常に @brand を import すればよく、現在のブランドを意識する必要はない
import Banner from "@brand-components/Banner.vue";
import Footer from "@brand-components/Footer.vue";
</script>
```

React でも同様です(ブランドファイルは `.tsx` / `.jsx` を使用)。

```tsx
import Banner from "@brand-components/Banner";
import Footer from "@brand-components/Footer";
```

### 5. ブランドを切り替えて起動

```bash
pnpm brand switch client-a   # .env.development の VITE_BRAND を書き換え
pnpm dev                     # client-a ブランドで起動
```

## CLI コマンド

以下の例は `pnpm brand <コマンド>` を使用しています。npm を使う場合は `npm run brand -- <コマンド>` に置き換えてください。

### `switch` — ブランドの切り替え

```bash
pnpm brand switch            # 対話メニュー(現在のブランドは表示のみで選択不可)
pnpm brand switch client-a   # 直接切り替え
```

env ファイル(デフォルト `.env.development`)の `VITE_BRAND` を書き換えます。他の変数はそのまま保持されます。

### `create` — 新しいブランドの作成

```bash
pnpm brand create                        # 対話形式で名前入力・元ブランド選択
pnpm brand create client-b --from base   # 継承モード:config.jsonc のみ作成、差分ファイルは後で追加
pnpm brand create client-b -f base -i    # isolate モード:元ブランドを完全コピー(extends は設定しない)
```

継承モード(デフォルト)で作成されるのは「薄いブランド」——`extends` を指定した `config.jsonc` のみが作られ、上書きしたいファイルを後から追加していく形です。

### `isolate` — 継承ブランドの独立化

```bash
pnpm brand isolate           # 対話メニュー(extends を持つブランドのみ表示)
pnpm brand isolate client-a
```

`extends` 先のブランドの中で、まだ上書きされていないファイルを実体としてコピーし、`extends` 設定を削除して、ブランドを完全に自己完結させます。

### `build` — マルチブランド一括ビルド

```bash
pnpm brand build base client-a     # スペース区切り
pnpm brand build base,client-a     # カンマ区切りも可
```

各ブランドがそれぞれ完全なサイトとして `dist/<brand>/` に出力され、そのまま各クライアントのサイトルートとしてデプロイできます。ブランドは順番にビルドされます(シャドウディレクトリはグローバルなシングルトンのため)が、これは CLI が自動的に処理します。

単一ブランドであれば CLI を使わず、環境変数だけで直接ビルドすることも可能です。

```bash
VITE_BRAND=client-a vite build               # macOS / Linux
$env:VITE_BRAND = "client-a"; pnpm vite build  # Windows PowerShell
```

> 注意:production モードでは `.env.development` を読み込まないため、`vite build` を直接実行する場合はブランドを環境変数で指定する必要があります。指定しない場合は `default` ブランドにフォールバックします。また `vite build <name>` の位置引数は Vite の「プロジェクトルート」であり、ブランド名ではありません——ブランド名を渡せるのは `vite-brand build` のみです。

### 共通オプション

| オプション        | デフォルト         | 説明                                  |
| ----------------- | ------------------ | ------------------------------------- |
| `--dir`           | `./brands`         | brands ディレクトリ                   |
| `--env-file`      | `.env.development` | ブランド環境変数ファイル              |
| `--env-key`       | `VITE_BRAND`       | ブランド環境変数名                    |
| `--out-dir`, `-o` | `dist`             | `build` の出力先ルート                |
| `--config`, `-c`  | 自動検出           | `build` で使用する vite config のパス |

## オプション(`defineBrandConfig` の第一引数)

```ts
export default defineBrandConfig(
  {
    brandsDir: "./brands", // ブランドディレクトリ
    runtimeDir: "./.runtime/brand", // シャドウ合成先ディレクトリ(.gitignore に追加すること)
    envKey: "VITE_BRAND", // 現在のブランドを読み取る環境変数名
    defaultBrand: "default", // 環境変数が未設定の場合のデフォルトブランド
    ignore: [".DS_Store", "public/"], // シャドウに含めないファイル名・パス断片
    tailwind: false, // Tailwind v3 preset の同期(v4 では不要、下記参照)
    aliases: {
      // プロジェクト固有の alias(任意)
      "@stores": "./src/stores",
    },
  },
  ({ mode }) => ({
    plugins: [vue()],
  }),
);
```

すべてのフィールドは省略可能で、上記はデフォルト値を示しています。

### 組み込み alias

| alias               | 参照先                      |
| ------------------- | --------------------------- |
| `@brand`            | `<runtimeDir>`              |
| `@brand-components` | `<runtimeDir>/components`   |
| `@brand-router`     | `<runtimeDir>/extra-router` |
| `@brand-assets`     | `<runtimeDir>/assets`       |

### config.jsonc

各ブランドディレクトリ直下の `config.jsonc`(または `config.json`、コメント対応)。

```jsonc
{
  "title": "Client A", // index.html 内の =VITE_TITLE= プレースホルダーを置換
  "extends": "base", // 継承するブランド名(省略可)
}
```

index.html での使用例:

```html
<title>=VITE_TITLE=</title>
```

### public ディレクトリ

`brands/<brand>/public` は自動的に Vite の `publicDir` として設定されます。public はシャドウに含まれず、継承の対象にもなりません——各ブランドが自身の public を完全な内容として維持する必要があります。

### Tailwind のブランド対応

#### v4(CSS-first)— オプション不要

v4 のテーマ設定は CSS ファイルそのものなので、シャドウディレクトリと継承機構がそのままカバーでき、追加設定は不要です。各ブランドはトークンファイルを1つ用意します。

```css
/* brands/base/tailwind.css */
@theme {
  --color-brand: #2563eb;
}
```

(ここでの `@theme` は Tailwind v4 独自の CSS at-rule であり、本プラグインのブランド概念とは無関係です。構文としては Tailwind によって解釈されます。)

ルート CSS は runtime ディレクトリ内のファイルを相対パスで import します(`@import` は Tailwind が解決するため、alias ではなく相対パスを使用してください)。

```css
/* src/style.css */
@import "tailwindcss";
@import "../.runtime/brand/tailwind.css";
```

クライアントブランドで配色を変えたい場合は、独自の `tailwind.css` を配置すれば上書きされます。配置しなければ `extends` 先のブランドのファイルを自動的に引き継ぎます。トークンの編集も同様に HMR で即座に反映されます。注意:ベースブランドには必ずこのファイルが必要です(import 先が存在している必要があるため)。

#### v3(JS config)— `tailwind` オプション

各ブランドが独自の `tailwind.config.ts` を持つ場合はこちらを有効にします。

```ts
defineBrandConfig({ tailwind: true } /* ... */);
// または出力先を変更:{ tailwind: { presetPath: "./.brand-env/tailwind.preset.ts" } }
```

シャドウの構築後、プラグインが `<runtimeDir>/tailwind.config.ts` を `presetPath` にコピーします(ブランドに存在しない場合は空の preset を書き出します)。ルートの `tailwind.config.ts` からはそれを参照するだけです。

```ts
import brandPreset from "./.brand-env/tailwind.preset";

export default {
  presets: [brandPreset],
  // ...
};
```

### DEV 定数

プラグインはグローバル定数 `DEV`(`mode === "development"`)を注入し、業務コードから直接利用できます。TypeScript プロジェクトでは `env.d.ts` に以下を追加してください。

```ts
declare const DEV: boolean;
```

## 仕組み

起動時に `brands/<brand>` 配下のファイルを **ハードリンク** で `<runtimeDir>` に接続します。ブランドが `extends` を設定している場合、継承先ブランドのファイルは「現在のブランドで上書きされていない」場合にのみリンクされます。`@brand` 系の alias はこの合成後のディレクトリを指すため、業務コードは「現在どのブランドか」を意識する必要がありません。

dev モードでは Vite の `server.watcher` がリンクを維持し、HMR をトリガーします。モジュールグラフが保持しているのは runtime 側のパスなので、`brands/` 配下のファイルイベントが発生してリンクの更新が完了した後、プラグインが対応する runtime モジュールを特定して能動的にリロードします(フレームワーク非依存で `.vue` / `.tsx` / CSS すべてに共通)。エディタがアトミック書き込み(一時ファイルに書いてから rename する方式、例:JetBrains の safe write)で保存すると inode が入れ替わりハードリンクが古い内容を指したままになりますが、プラグインは inode の変化を検知して自動的に再リンクします。

| イベント                         | 動作                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| ブランドにファイルが追加された   | runtime にリンク(元々 extends にリンクされていたファイルを上書き)                          |
| ブランドからファイルが削除された | runtime のファイルを削除。extends に同名ファイルがあればそちらへフォールバックしてリンク   |
| extends にファイルが追加された   | ブランド側に同名ファイルが存在しない場合のみリンクを追加                                   |
| extends からファイルが削除された | ブランド側に同名ファイルが存在しない場合のみリンクを解除                                   |
| ファイル内容が変更された         | 同一 inode であれば自然に反映。アトミック書き込みで inode が変わった場合は自動的に再リンク |

## 制限事項

- `brands/` と `runtimeDir` は **同一のファイルシステムパーティション** 上に存在する必要があります(ハードリンクの制約)。パーティションをまたぐ場合は自動的にコピーへフォールバックしますが、そのモードではファイル内容の変更が自動的に同期されません。
- ブランド継承は1階層のみです。`extends` 先のブランドがさらに `extends` を持っていても再帰的には解決されません。
- `runtimeDir`(デフォルト `.runtime/`)は生成物用のディレクトリです。`.gitignore` に追加してください。

## License

[0BSD](./LICENSE) — 使用・改変・配布(商用および非公開ソースでの利用を含む)を自由に行えます。ライセンス表示の保持義務やその他の付帯条件は一切ありません。
