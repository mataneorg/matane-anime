---
title: Contribute
---

# Contribute

Thanks for wanting to help. The full rules are in [CONTRIBUTING.md](https://github.com/mataneorg/matane-anime/blob/main/CONTRIBUTING.md); this is the short version. Please read the [code of conduct](https://github.com/mataneorg/matane-anime/blob/main/CODE_OF_CONDUCT.md) first.

## Where things belong

| I want to…                                  | Go to                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report a bug or suggest an idea for the app | [GitHub issues](https://github.com/mataneorg/matane-anime/issues), using the templates. Read [Diagnosis](/docs/guides/troubleshooting/diagnosis) first. |
| Report a vulnerability                      | Privately, as described in [SECURITY.md](https://github.com/mataneorg/matane-anime/blob/main/SECURITY.md). Not in a public issue.                       |
| Ask for a site or a source                  | Not here. Matane Anime ships no sources and does not suggest any. The request belongs to the repository of the extension that provides it.              |
| Write a source                              | [Writing extensions](/extensions/) and [Publishing a repository](/extensions/repository).                                                               |
| Fix or improve the docs                     | Use **Help us improve this page** at the bottom of any page, or see below.                                                                              |
| Send a pull request                         | For anything bigger than a fix, open an issue first so the direction can be agreed before you write code.                                               |

## Set up the project

You need **Node 24** and **pnpm 12**. Then:

```sh
pnpm install     # also rebuilds better-sqlite3 for Electron and builds the SDK and the CLI
pnpm dev         # starts the app with hot reload
```

Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` before you push. The full list of commands, the project layout and how testing works are in [DEVELOPMENT.md](https://github.com/mataneorg/matane-anime/blob/main/DEVELOPMENT.md).

## Commits and pull requests

- Use **Conventional Commits**: `feat: ...`, `fix: ...`, `docs: ...`, with an optional scope (`fix(player): ...`).
- Keep a pull request to one change. Say what it does and how you checked it. A UI change needs a screenshot (Mocha and Latte if colors are involved).
- Every user-visible string goes through i18n and lives in both the English and the Indonesian locale.

## Working on these docs

The site is a [VitePress](https://vitepress.dev) project in [`apps/docs`](https://github.com/mataneorg/matane-anime/tree/main/apps/docs). Pages are English Markdown.

```sh
pnpm --filter @matane-anime/docs docs:dev       # dev server with hot reload
pnpm --filter @matane-anime/docs docs:build     # static build, fails on a dead link
```

The extension author guides are adapted from `docs/extensions.md` and `docs/repositories.md`; when you change one, change the other.

## License

The app is **GPL-3.0-only**. The packages extension authors depend on are **MIT**, so extensions are not bound by the GPL. By contributing you agree that your change is licensed under the license of the folder it goes into.
