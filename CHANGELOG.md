# Changelog

## 0.1.1

**Fixed**

- Clearing `runtimeDir` deleted the ownership marker first; if the clear was interrupted (overlapping dev-server restarts, transient `ENOTEMPTY`/`EPERM` on Windows), the leftover files without a marker made every later start fail with "refusing to delete". The marker is now kept while the rest is cleared, with retries on transient errors

## 0.1.0

**Breaking**

- `vite` peer dependency raised from `>=5` to `>=6` (Vite 5 could not be verified by the test suite; the declared range now matches what's tested)
- Brand names must match `^[a-z0-9][a-z0-9-]*$` — uppercase letters and underscores are now rejected by the CLI and `defineBrandConfig`
- `vite-brand build --out-dir` can no longer resolve outside the project root

**Fixed**

- Path escape: a brand name or `--out-dir` could resolve outside `brandsDir`/the project root, and `build`'s `emptyOutDir: true` would then wipe an arbitrary directory (e.g. `vite-brand build ../src`)
- `envKey` option was silently ignored unless it started with `VITE_`, because `loadEnv` was never given it as a prefix; `vite-brand build` also hardcoded `VITE_BRAND` regardless of `--env-key`
- `ignore` patterns were matched against absolute paths, so a project located under a path containing `public/` would have its entire brand silently filtered out of the shadow directory
- `vite-brand switch` rewrote the whole env file from a parsed key/value map, destroying comments, blank lines, key order, and truncating any unquoted value containing `#`
- Watcher events were not serialized, so an editor's atomic save (unlink+add in quick succession) could race with the shadow link maintenance
- Editing a brand's `config.jsonc` (title, `extends`) had no effect until the dev server was restarted
- Tailwind preset sync only watched the current brand's `tailwind.config.ts`, so changes to an inherited (`extends`) config were ignored, and the preset was read from the shadow directory — a source of races with the watcher
- `runtimeDir` was deleted unconditionally on every start; a misconfigured path (or a stray directory sharing that name) would be wiped without warning
- `config.jsonc` `title` was interpolated into `index.html` without HTML-escaping
- `shadowReady` had no rejection path, so a failed shadow build could leave the Tailwind plugin waiting forever

**Added**

- `defineDev` option to opt out of the injected `DEV` global constant
- `%VITE_TITLE%` accepted alongside the existing `=VITE_TITLE=` placeholder
- CLI warns when `isolate`/`create --isolate` overwrites a `config.jsonc` that contains comments (JSON.stringify cannot preserve them)
- `.github/workflows/ci.yml`: push/PR checks against Vite 6/7/8

## 0.0.13 and earlier

See git history.
