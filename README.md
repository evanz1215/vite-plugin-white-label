# vite-plugin-white-label

[繁體中文](./README.zh-TW.md) | English | [日本語](./README.ja.md)

A framework-agnostic (Vue / React) white-label / multi-brand system for Vite, built on a **shadow directory composed with hard links**:

- 🏷️ **Brand switching** — one environment variable decides the active brand, zero changes to business code
- 🧬 **Brand inheritance (`extends`)** — a client brand only needs to ship the files that differ; everything else falls back to the base brand
- ⚡ **Instant HMR** — editing files under `brands/` hot-reloads immediately, with automatic relinking when editors break hard links via atomic writes
- 📦 **Batch multi-brand build** — one command outputs every brand as its own fully deployable site
- 🔧 **CLI management tool** — interactive switching, creation, and isolation of brands

> Requirements: Node >= 20.12, Vite >= 5. Zero dependencies except `json5`.

## Install

```bash
npm install -D vite-plugin-white-label
# or
pnpm add -D vite-plugin-white-label
```

## Quick start

### 1. Configure vite.config.ts

```ts
import vue from "@vitejs/plugin-vue";
import { defineBrandConfig } from "vite-plugin-white-label";

export default defineBrandConfig(
  {}, // brand options (see "Options" below)
  ({ mode }) => ({
    plugins: [vue()],
  }),
);
```

For React projects, just swap the framework plugin — everything else stays the same:

```ts
import react from "@vitejs/plugin-react";
import { defineBrandConfig } from "vite-plugin-white-label";

export default defineBrandConfig({}, { plugins: [react()] });
```

### 2. Add a CLI script to package.json

```json
{
  "scripts": {
    "dev": "vite",
    "brand": "vite-brand"
  }
}
```

All brand operations go through this script:

```bash
pnpm brand switch            # pnpm / yarn: pass args directly
npm run brand -- switch      # npm: remember the -- to pass args
```

### 3. Create the brand directories

```
brands/
├── base/                     # base brand (complete)
│   ├── config.jsonc          # { "title": "Base App" }
│   ├── components/
│   │   ├── Banner.vue
│   │   └── Footer.vue
│   └── assets/
└── client-a/                 # client brand (only the diff files)
    ├── config.jsonc          # { "title": "Client A", "extends": "base" }
    └── components/
        └── Banner.vue        # overrides base's Banner; Footer falls back to base
```

### 4. Reference the brand from business code via the alias

```vue
<script setup lang="ts">
// always import @brand, no need to know which brand is active
import Banner from "@brand-components/Banner.vue";
import Footer from "@brand-components/Footer.vue";
</script>
```

Same for React (brand files use `.tsx` / `.jsx`):

```tsx
import Banner from "@brand-components/Banner";
import Footer from "@brand-components/Footer";
```

### 5. Switch brand and start

```bash
pnpm brand switch client-a   # rewrites VITE_BRAND in .env.development
pnpm dev                     # starts with the client-a brand
```

## CLI commands

Examples below use `pnpm brand <command>`; npm users should use `npm run brand -- <command>`.

### `switch` — switch brand

```bash
pnpm brand switch            # interactive menu (current brand is marked and unselectable)
pnpm brand switch client-a   # switch directly
```

Rewrites `VITE_BRAND` in the env file (default `.env.development`); other variables are left untouched.

### `create` — create a new brand

```bash
pnpm brand create                        # interactive: enter name, choose source
pnpm brand create client-b --from base   # inheritance mode: only creates config.jsonc, add diff files later
pnpm brand create client-b -f base -i    # isolate mode: fully copies the source (no extends set)
```

Inheritance mode (default) creates a "thin brand" — just a `config.jsonc` marking `extends`; add whichever files you need to override afterward.

### `isolate` — detach an inherited brand

```bash
pnpm brand isolate           # interactive menu (lists only brands with extends)
pnpm brand isolate client-a
```

Physically copies in the files from the `extends` brand that weren't already overridden, then removes the `extends` setting, making the brand fully self-contained.

### `build` — batch multi-brand build

```bash
pnpm brand build base client-a     # space-separated
pnpm brand build base,client-a     # comma-separated also works
```

Each brand outputs a complete site to `dist/<brand>/`, ready to deploy as-is as each client's site root. Brands are built sequentially (the shadow directory is a global singleton) — the CLI handles this for you.

A single brand can also be built without the CLI, using the environment variable directly:

```bash
VITE_BRAND=client-a vite build               # macOS / Linux
$env:VITE_BRAND = "client-a"; pnpm vite build  # Windows PowerShell
```

> Note: production mode does not read `.env.development`, so when running bare `vite build` the brand must be given via the environment variable — omitting it falls back to the `default` brand. Also, the positional argument of `vite build <name>` is Vite's "project root", not the brand name — the brand name can only be passed to `vite-brand build`.

### Common options

| Option            | Default            | Description                         |
| ----------------- | ------------------ | ----------------------------------- |
| `--dir`           | `./brands`         | brands directory                    |
| `--env-file`      | `.env.development` | brand env file                      |
| `--env-key`       | `VITE_BRAND`       | env variable name holding the brand |
| `--out-dir`, `-o` | `dist`             | output root for `build`             |
| `--config`, `-c`  | auto-detected      | vite config path used by `build`    |

## Options (`defineBrandConfig` first argument)

```ts
export default defineBrandConfig(
  {
    brandsDir: "./brands", // brands directory
    runtimeDir: "./.runtime/brand", // shadow composition directory (add to .gitignore)
    envKey: "VITE_BRAND", // env variable name that holds the active brand
    defaultBrand: "default", // fallback brand when the env variable isn't set
    ignore: [".DS_Store", "public/"], // filenames/path fragments excluded from the shadow
    tailwind: false, // Tailwind v3 preset sync (not needed for v4, see below)
    aliases: {
      // project-specific aliases (optional)
      "@stores": "./src/stores",
    },
  },
  ({ mode }) => ({
    plugins: [vue()],
  }),
);
```

All fields are optional; the above shows the defaults.

### Built-in aliases

| Alias               | Points to                   |
| ------------------- | --------------------------- |
| `@brand`            | `<runtimeDir>`              |
| `@brand-components` | `<runtimeDir>/components`   |
| `@brand-router`     | `<runtimeDir>/extra-router` |
| `@brand-assets`     | `<runtimeDir>/assets`       |

### config.jsonc

Each brand directory has a `config.jsonc` (or `config.json`, comments supported):

```jsonc
{
  "title": "Client A", // replaces the =VITE_TITLE= placeholder in index.html
  "extends": "base", // name of the inherited brand (optional)
}
```

Usage in index.html:

```html
<title>=VITE_TITLE=</title>
```

### public directory

`brands/<brand>/public` is automatically set as Vite's `publicDir`. `public` is excluded from the shadow and does not participate in inheritance — each brand must maintain its own complete `public` contents.

### Tailwind branding

#### v4 (CSS-first) — no options needed

v4's theme configuration is just a CSS file, so the shadow directory and inheritance mechanism cover it directly with zero setup. Each brand ships a token file:

```css
/* brands/base/tailwind.css */
@theme {
  --color-brand: #2563eb;
}
```

(The `@theme` here is Tailwind v4's own CSS at-rule, unrelated to this plugin's brand concept — it's parsed by Tailwind.)

The root CSS imports the runtime directory's copy using a relative path (`@import` is resolved by Tailwind, so use a relative path, not an alias):

```css
/* src/style.css */
@import "tailwindcss";
@import "../.runtime/brand/tailwind.css";
```

A client brand that wants different colors just ships its own `tailwind.css` to override; if it doesn't, it automatically falls back to the `extends` brand's file. Editing tokens is hot-reloaded the same way. Note: the base brand must have this file (the import target must exist).

#### v3 (JS config) — `tailwind` option

Enable this when each brand ships its own `tailwind.config.ts`:

```ts
defineBrandConfig({ tailwind: true } /* ... */);
// or customize the output path: { tailwind: { presetPath: "./.brand-env/tailwind.preset.ts" } }
```

Once the shadow is built, the plugin copies `<runtimeDir>/tailwind.config.ts` to `presetPath` (writing an empty preset if the brand doesn't have one). Reference it from the root `tailwind.config.ts`:

```ts
import brandPreset from "./.brand-env/tailwind.preset";

export default {
  presets: [brandPreset],
  // ...
};
```

### DEV constant

The plugin injects a global constant `DEV` (`mode === "development"`) that can be used directly in business code; TypeScript projects can declare it in `env.d.ts`:

```ts
declare const DEV: boolean;
```

## How it works

On startup, the files under `brands/<brand>` are **hard-linked** into `<runtimeDir>`; if the brand sets `extends`, files from the inherited brand are linked in only where the current brand hasn't overridden them. The `@brand` family of aliases point at this composed directory, so business code stays unaware of which brand is currently active.

In dev mode, Vite's `server.watcher` maintains the links and drives HMR: the module graph holds runtime paths, so once a link update for a file under `brands/` is finished, the plugin maps it to the corresponding runtime module and triggers a reload (framework-agnostic — works uniformly for `.vue`/`.tsx`/CSS). Editors that save via atomic writes (write to a temp file, then rename — e.g. JetBrains' safe write) swap out the inode, breaking the hard link; the plugin detects the inode change and relinks automatically.

| Event                       | Behavior                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| File added in a brand       | Linked into runtime (overrides any file linked from `extends`)                                     |
| File removed from a brand   | Runtime file removed; if `extends` has a file of the same name, falls back to linking that         |
| File added in `extends`     | Linked in only if the brand has no file of the same name                                           |
| File removed from `extends` | Unlinked only if the brand has no file of the same name                                            |
| File content changed        | Same inode takes effect naturally; an inode swap from an atomic write triggers automatic relinking |

## Limitations

- `brands/` and `runtimeDir` must be on the **same filesystem partition** (a hard-link constraint); across partitions it automatically falls back to copying, but in that mode content changes are not automatically synced.
- Brand inheritance is only one level deep: an `extends` brand's own `extends` is not resolved recursively.
- `runtimeDir` (default `.runtime/`) is a build artifact directory — add it to `.gitignore`.

## License

[0BSD](./LICENSE) — free to use, modify, and distribute (including commercial and closed-source use), with no requirement to retain the license notice and no other conditions attached.
