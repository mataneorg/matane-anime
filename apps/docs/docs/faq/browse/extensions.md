# Extensions

## What is an extension?

A small program that turns a website into one or more **sources**. It runs in a sandbox with no network or file access of its own; everything goes through the app. See [Extensions and repositories](/docs/guides/extensions).

## Where do I get extensions?

From a **repository** whose address someone publishes. Matane Anime ships none and suggests none. See [Adding sources](/docs/guides/getting-started#adding-sources).

## What does "trust the key" mean?

Repositories are signed. If you trust the key, the app holds the repository to it from then on. If you do not, you can still add it as an unverified repository, and you get a warning each time you install from it. A repository with an invalid signature cannot be added.

## Is it safe?

Extensions are sandboxed and checked (size, SHA-256, contents) before anything is written, and the install dialog shows what it will install. But an extension decides what a source shows you, so add only repositories you trust. The details are in [the repository guide](/extensions/repository#what-the-app-checks).

## How do I update an extension?

**Browse, Extensions, Updates** (**Update all** for everything). Updates come from the repository the extension was installed from, and only to a strictly newer version.

## What happens to my library if I uninstall an extension?

Nothing is deleted: the anime stay in your library and show as "not installed" until you install the extension again.

## A source stopped working. What do I do?

See [Troubleshooting](/docs/guides/troubleshooting/common-issues#a-source-shows-an-error-or-no-episodes). Short version: update the extension.

## Can I limit sources by language?

Yes: **Settings, General, Content language**, and **Show 18+ sources** for adult ones.

## How do I write my own extension?

Read [Writing extensions](/extensions/), and use [Developer mode](/docs/guides/extensions#developer-mode) to load it from a folder.

## Why can't I install an extension from a second repository?

If the same extension id is already installed from another repository, uninstall that copy first. A folder loaded in Developer mode also takes priority over an installed copy.
