# Diagnosis

Work from the outside in. Each step tells you which part is to blame: your network, the extension, or the app.

## 1. Is it the network?

Open **Settings, Network** and choose **Test connection**. It loads a small test address with the settings **currently on the page, even before you save them**, and tells you whether it worked and how long it took.

- **Fails:** set **Proxy** to **System settings** and **DNS over HTTPS** to **Off**, then test again. If that works, the setting you turned off was the problem.
- **Works but one source does not:** the network is fine. If the source works on another network, it is probably blocked by DNS: try DNS over HTTPS on **Automatic**.

## 2. Is it the extension?

- Does the same anime work on another source? Then the first source's extension is the problem.
- **Update the extension** from **Browse, Extensions, Updates**. Sites change often and the fix ships in the extension.
- Is the extension from a trusted repository and not marked "needs reinstall"? ([Common issues](/docs/guides/troubleshooting/common-issues#an-extension-says-needs-reinstall))

### Read the extension log

**Settings, Advanced, Extension logs** records what extensions did. Pick the extension under **Show the log of**, and choose which levels to show (errors, warnings, info, debug). **Developer mode** adds the extended log. **Copy** puts the log on your clipboard; **Clear** empties it. When playback fails, the error names each server that failed and why.

## 3. Is it the app?

- Look at the version under **Settings, About**, and check [Changelogs](/changelogs) for a fix. A newer version may already solve it ([Updating](/docs/guides/install#updating)); on the **Beta** channel you also get pre-releases.
- Try a clean profile: start the app with `--user-data-dir=<an empty folder>`. If the problem disappears, it is in your data or settings. Do not delete your real data folder before you made a [backup](/docs/guides/backups).

## Reporting a bug

Open an issue on [GitHub](https://github.com/mataneorg/matane-anime/issues) and include:

- The app version and your operating system (Settings, About shows both).
- What you did, what you expected and what happened instead.
- The relevant extension log lines, and the extension's name and version.
- Whether it also fails with a clean profile and **Test connection** passing.

Do not paste passwords, proxy credentials or private addresses. If the problem is a **vulnerability**, report it privately as described in [SECURITY.md](https://github.com/mataneorg/matane-anime/blob/main/SECURITY.md).

A source that breaks because its website changed is not a bug in Matane Anime. Report it to the repository of the extension that provides it.
