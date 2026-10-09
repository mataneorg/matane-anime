# 32. Onboarding, What's new and the command palette

Status: Accepted (2026-10-09). The dialogs are only seen running at home.

## Context
docs/PRD.md UI-8 (palette), UI-9 (onboarding), UI-10 (What's new), UI-11 (AMOLED and accents).

## Decision
- **Palette** (`features/palette`): `Ctrl/Cmd+K`, mounted in `AppShell`, so it does not exist in the player (outside the shell, with its own key handler) or during onboarding. Filtering, ranking and grouping are pure (`rank.ts`, tested); the library results use `library.list`'s own search. No `cmdk`: a `Dialog` and a listbox. The title bar button opens it.
- **Onboarding**: four steps (language and theme, content language and 18+, download folder, player basics) that write the real settings as you go; Skip and Start write `onboardingDone`. A profile that already has library anime or any history is marked done once at startup (`markExistingProfileOnboarded`), so an upgrade never shows it. The mockup's "repeat from Settings, About" is not built, so its text says "change it later in Settings".
- **What's new**: a changelog bundled as typed data in main (`main/app/changelog.ts`, English only), `app.changelog`, and `settings.lastSeenVersion`. A first run, or a version with no changelog entry, stores the version silently; an older stored version shows the entries since then once; closing stores the version. Version comparison is pure and handles pre-release tags (`0.1.0-beta.1`). **There is no mockup for this dialog**: it is built from the existing dialog, button and tokens, a deviation from [0006](0006-ui-mockups-source-of-truth.md) to be settled with a mockup. The releases URL is repeated in `lib/version.ts` so the renderer imports no main code.
- **Theme audit**: AMOLED and the 14 accents already existed. On Latte, `base` on 11 of the 14 accents was between 2.3:1 and 3.5:1, so those accents get `#11111b` text (4.7:1 to 7.2:1); the selected accent swatch now shows keyboard focus. Latte accents used as a focus ring or fill against `base` are still about 2.3:1 to 3:1.

## Consequence for tests
A fresh profile now lands on onboarding, so `e2e/support/app.ts` marks it done unless a spec asks for it.
