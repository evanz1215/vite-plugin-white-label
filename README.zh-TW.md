# vite-plugin-white-label

繁體中文 | [English](./README.md) | [日本語](./README.ja.md)

Vite 白牌(white-label / multi-brand)系統,框架無關(Vue / React 皆可)。以 **hard link 合成的 shadow 目錄** 實現:

- 🏷️ **品牌切換** — 一個環境變數決定當前品牌,業務程式碼零改動
- 🧬 **品牌繼承(`extends`)** — 客戶品牌只放差異檔,其餘自動沿用基底品牌
- ⚡ **即時 HMR** — 編輯 `brands/` 檔案即時熱更新,自動處理編輯器原子寫入造成的斷鏈
- 📦 **多品牌批次打包** — 一個指令把每個品牌各自輸出成可獨立部署的完整站點
- 🔧 **CLI 管理工具** — 互動式切換、建立、獨立化品牌

> 需求:Node >= 20.12、Vite >= 5。除 `json5` 外零依賴。

## 安裝

```bash
npm install -D vite-plugin-white-label
# 或
pnpm add -D vite-plugin-white-label
```

## 快速開始

### 1. 設定 vite.config.ts

```ts
import vue from "@vitejs/plugin-vue";
import { defineBrandConfig } from "vite-plugin-white-label";

export default defineBrandConfig(
  {}, // 品牌選項(見下方「選項」)
  ({ mode }) => ({
    plugins: [vue()],
  }),
);
```

React 專案只是換掉框架 plugin,其餘完全相同:

```ts
import react from "@vitejs/plugin-react";
import { defineBrandConfig } from "vite-plugin-white-label";

export default defineBrandConfig({}, { plugins: [react()] });
```

### 2. 在 package.json 加入 CLI script

```json
{
  "scripts": {
    "dev": "vite",
    "brand": "vite-brand"
  }
}
```

之後所有品牌操作都透過這個 script:

```bash
pnpm brand switch            # pnpm / yarn:參數直接接在後面
npm run brand -- switch      # npm:記得加 -- 才能傳參數
```

### 3. 建立品牌目錄

```
brands/
├── base/                     # 基底品牌(完整)
│   ├── config.jsonc          # { "title": "Base App" }
│   ├── components/
│   │   ├── Banner.vue
│   │   └── Footer.vue
│   └── assets/
└── client-a/                 # 客戶品牌(只放差異檔)
    ├── config.jsonc          # { "title": "Client A", "extends": "base" }
    └── components/
        └── Banner.vue        # 覆蓋 base 的 Banner,Footer 自動沿用 base
```

### 4. 業務程式碼透過 alias 引用品牌

```vue
<script setup lang="ts">
// 永遠 import @brand,不需要知道當前是哪個品牌
import Banner from "@brand-components/Banner.vue";
import Footer from "@brand-components/Footer.vue";
</script>
```

React 同理(品牌檔放 `.tsx` / `.jsx`):

```tsx
import Banner from "@brand-components/Banner";
import Footer from "@brand-components/Footer";
```

### 5. 切換品牌並啟動

```bash
pnpm brand switch client-a   # 改寫 .env.development 的 VITE_BRAND
pnpm dev                     # 以 client-a 品牌啟動
```

## CLI 指令

以下範例用 `pnpm brand <指令>`;npm 使用者請改成 `npm run brand -- <指令>`。

### `switch` — 切換品牌

```bash
pnpm brand switch            # 互動選單(當前品牌會標示且不可選)
pnpm brand switch client-a   # 直接切換
```

改寫 env 檔(預設 `.env.development`)的 `VITE_BRAND`,其他變數保留不動。

### `create` — 建立新品牌

```bash
pnpm brand create                        # 互動輸入名稱、選擇來源
pnpm brand create client-b --from base   # 繼承模式:只建 config.jsonc,差異檔之後再加
pnpm brand create client-b -f base -i    # isolate 模式:完整複製來源(不設 extends)
```

繼承模式(預設)建立的是「薄品牌」——只有一個 `config.jsonc` 標記 `extends`,之後把要覆蓋的檔案放進去即可。

### `isolate` — 繼承品牌獨立化

```bash
pnpm brand isolate           # 互動選單(只列出有 extends 的品牌)
pnpm brand isolate client-a
```

把 `extends` 品牌中未被覆蓋的檔案實體複製進來,並移除 `extends` 設定,讓品牌完全自包含。

### `build` — 多品牌批次打包

```bash
pnpm brand build base client-a     # 空白分隔
pnpm brand build base,client-a     # 逗號分隔亦可
```

每個品牌各自輸出完整站點到 `dist/<brand>/`,可直接部署為各客戶的站台根目錄。品牌間依序打包(shadow 目錄是全域單例),CLI 已處理。

單一品牌也可以不走 CLI,直接用環境變數:

```bash
VITE_BRAND=client-a vite build               # macOS / Linux
$env:VITE_BRAND = "client-a"; pnpm vite build  # Windows PowerShell
```

> 注意:production 模式不會讀 `.env.development`,所以裸跑 `vite build` 時品牌必須由環境變數指定;沒指定會 fallback 到 `default` 品牌。另外 `vite build <name>` 的位置參數是 Vite 的「專案根目錄」而不是品牌名稱——品牌名稱只能給 `vite-brand build`。

### 通用選項

| 選項              | 預設               | 說明                          |
| ----------------- | ------------------ | ----------------------------- |
| `--dir`           | `./brands`         | brands 目錄                   |
| `--env-file`      | `.env.development` | 品牌環境變數檔                |
| `--env-key`       | `VITE_BRAND`       | 品牌環境變數名                |
| `--out-dir`, `-o` | `dist`             | `build` 的輸出根目錄          |
| `--config`, `-c`  | 自動尋找           | `build` 用的 vite config 路徑 |

## 選項(`defineBrandConfig` 第一個參數)

```ts
export default defineBrandConfig(
  {
    brandsDir: "./brands", // 品牌目錄
    runtimeDir: "./.runtime/brand", // shadow 合成目錄(記得加進 .gitignore)
    envKey: "VITE_BRAND", // 讀取當前品牌的環境變數名
    defaultBrand: "default", // 環境變數未設定時的預設品牌
    ignore: [".DS_Store", "public/"], // 不進 shadow 的檔名/路徑片段
    tailwind: false, // Tailwind v3 preset 同步(v4 不需要,見下方)
    aliases: {
      // 專案私有 alias(可選)
      "@stores": "./src/stores",
    },
  },
  ({ mode }) => ({
    plugins: [vue()],
  }),
);
```

所有欄位皆可省略,上面即預設值。

### 內建 alias

| alias               | 指向                        |
| ------------------- | --------------------------- |
| `@brand`            | `<runtimeDir>`              |
| `@brand-components` | `<runtimeDir>/components`   |
| `@brand-router`     | `<runtimeDir>/extra-router` |
| `@brand-assets`     | `<runtimeDir>/assets`       |

### config.jsonc

每個品牌目錄下的 `config.jsonc`(或 `config.json`,支援註解):

```jsonc
{
  "title": "Client A", // 取代 index.html 中的 =VITE_TITLE= 佔位符
  "extends": "base", // 繼承的品牌名稱(可省略)
}
```

index.html 用法:

```html
<title>=VITE_TITLE=</title>
```

### public 目錄

`brands/<brand>/public` 會自動設為 Vite 的 `publicDir`。public 不進 shadow、也不參與繼承——每個品牌的 public 需自行維護完整內容。

### Tailwind 品牌化

#### v4(CSS-first)— 不需要任何選項

v4 的主題設定就是 CSS 檔,shadow 目錄與繼承機制直接涵蓋,零設定。每個品牌放一份 token 檔:

```css
/* brands/base/tailwind.css */
@theme {
  --color-brand: #2563eb;
}
```

(這裡的 `@theme` 是 Tailwind v4 自己的 CSS at-rule,跟本套件的品牌概念無關,語法上由 Tailwind 解析。)

根 CSS 以相對路徑 import runtime 目錄那份(`@import` 由 Tailwind 解析,請用相對路徑而非 alias):

```css
/* src/style.css */
@import "tailwindcss";
@import "../.runtime/brand/tailwind.css";
```

客戶品牌要換色就放一份自己的 `tailwind.css` 覆蓋;沒放就自動沿用 `extends` 品牌的。編輯 token 一樣走 HMR 即時生效。注意:基底品牌必須有這個檔案(import 目標要存在)。

#### v3(JS config)— `tailwind` 選項

品牌各自帶 `tailwind.config.ts` 時開啟:

```ts
defineBrandConfig({ tailwind: true } /* ... */);
// 或自訂輸出位置:{ tailwind: { presetPath: "./.brand-env/tailwind.preset.ts" } }
```

plugin 會在 shadow 建好後,把 `<runtimeDir>/tailwind.config.ts` 複製到 `presetPath`(品牌沒有時寫入空 preset),根目錄的 `tailwind.config.ts` 引用它即可:

```ts
import brandPreset from "./.brand-env/tailwind.preset";

export default {
  presets: [brandPreset],
  // ...
};
```

### DEV 常數

plugin 會注入全域常數 `DEV`(`mode === "development"`),可在業務程式碼直接使用;TypeScript 專案可在 `env.d.ts` 補上:

```ts
declare const DEV: boolean;
```

## 運作原理

啟動時將 `brands/<brand>` 的檔案以 **hard link** 連進 `<runtimeDir>`;若品牌設定 `extends`,繼承品牌的檔案僅在「未被當前品牌覆蓋」時補鏈。`@brand` 系列 alias 指向合成後的目錄,業務程式碼因此對「當前是哪個品牌」無感。

dev 模式下由 Vite server.watcher 維護連結並觸發 HMR:模組圖裡掛的是 runtime 路徑,`brands/` 的檔案事件在連結維護完成後,由 plugin 對應到 runtime 模組主動 reload(框架無關,`.vue`/`.tsx`/CSS 通用)。編輯器以原子寫入存檔(先寫暫存檔再 rename,如 JetBrains 的 safe write)會換掉 inode 造成 hard link 指向舊內容,plugin 會比對 inode 自動重連。

| 事件             | 行為                                                  |
| ---------------- | ----------------------------------------------------- |
| 品牌新增檔案     | 連進 runtime(覆蓋原本連到 extends 的檔)               |
| 品牌刪除檔案     | 移除 runtime 檔;extends 有同名檔則回退連 extends 版本 |
| extends 新增檔案 | 僅當品牌沒有同名檔時補鏈                              |
| extends 刪除檔案 | 僅當品牌沒有同名檔時斷鏈                              |
| 檔案內容變更     | 同 inode 天然生效;原子寫入換 inode 時自動重連         |

## 限制

- `brands/` 與 `runtimeDir` 必須位於**同一磁碟分割區**(hard link 限制);跨分割區時自動 fallback 為 copy,但該模式下內容修改不會自動同步。
- 品牌繼承只有一層:`extends` 指向的品牌自己的 `extends` 不會被遞迴解析。
- `runtimeDir`(預設 `.runtime/`)是產物目錄,請加進 `.gitignore`。

## License

[0BSD](./LICENSE) — 可自由使用、修改、散布(含商用與閉源),無需保留授權聲明,無任何附帶條件。
