# @matane-anime/extension-cli

`ma-ext`: create, build, test and benchmark extensions for [Matane Anime](https://github.com/SukunDev/matane-anime).

## Install

```sh
npm install --save-dev @matane-anime/extension-cli @matane-anime/extension-sdk
```

Node 22 or newer. Or start from a scaffold, which has both set up:

```sh
npx @matane-anime/extension-cli create my-site --name "My Site" --lang en
cd my-site
npm install
```

## Commands

| Command              | What it does                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ma-ext create <id>` | Scaffolds `./<id>` (`--name`, `--lang`, `--dir`): manifest, `src/index.ts`, tsconfig and package.json            |
| `ma-ext build [dir]` | Bundles `src/index.ts` into `dist/index.js` (+ `manifest.json` and `icon.png`), checking it loads in the sandbox |
| `ma-ext test [dir]`  | Runs popular → search → details → episodes → streams against the real site, with the app's checks                |
| `ma-ext bench [dir]` | Times each call in the sandbox; `--synthetic` runs the built-in worst cases only                                 |

`test` takes `--source <key>`, `--query <text>`, `--pref key=value` (repeatable) and `-v` for the extension's log
output. Exit code is non-zero when a step fails.

The `dist/` folder can be loaded in the app (Settings → Advanced → Load extension from folder).

## License

MIT
