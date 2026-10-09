# For extension authors

Sources in Matane Anime are **extensions**: one JavaScript file that tells the app how to read a site. The app does everything else (network, player, library, downloads, updates). The SDK, runtime and CLI are MIT-licensed npm packages (`@matane-anime/extension-sdk`, `@matane-anime/extension-runtime`, `@matane-anime/extension-cli`), so your extension is not bound by the app's GPL.

- [Writing an extension](/authors/writing-extensions): the manifest, the source, the sandbox, building, testing, developer mode.
- [Extension repositories](/authors/repositories): how to publish a signed repository that people add by address, what users see and what the app checks.

Requests for a particular site or source belong to the extension repositories, not to the app's issue tracker. Matane Anime ships no extensions, repositories or keys and does not suggest any.

These two guides are adapted from [`docs/extensions.md`](https://github.com/mataneorg/matane-anime/blob/main/docs/extensions.md) and [`docs/repositories.md`](https://github.com/mataneorg/matane-anime/blob/main/docs/repositories.md) in the repository.
