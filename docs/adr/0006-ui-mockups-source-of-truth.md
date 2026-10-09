# 6. UI mockups are the source of truth

Status: Superseded by [ADR 0036](0036-ui-follows-matane.md) (2026-10-09). The mockups and their PNGs are now historical.

## Context
The screens were designed before any code, as 30 Catppuccin artboards in Claude Design, with a Design System holding the tokens.

## Decision
The artboards decide how a screen looks; the PRD decides what it does. Copies are kept in the repo so they survive the design tool: `docs/ui/screens/` (PNG per artboard, Mocha and Latte), `docs/ui/tokens/` (`catppuccin-tokens.css`, `tokens.json`) and `docs/ui/design-system.md`. `docs/ui/MOCKUP_PLAN.md` indexes them and links the originals.

Phase 0 builds the shell and empty states; richer screens follow their phase. A deviation from a mockup is fixed in the mockup first.

## Consequences
- Reviewing UI work means comparing against `docs/ui/screens/`.
- The PNGs are exports; they are replaced when an artboard changes.
