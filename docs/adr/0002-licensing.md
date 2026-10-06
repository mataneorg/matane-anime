# 2. Licensing

Status: Accepted (2026-10-06)

## Context
The app should stay open. Extension authors should not have to license their work under the app's terms.

## Decision
The application and `packages/shared` are GPL-3.0-only. `packages/extension-sdk` and `packages/extension-runtime` are MIT, so extensions that use them are not bound by the GPL.

## Consequences
- The SDK carries its own `LICENSE`.
- Code moved between `shared` and the MIT packages changes license with it, so that move is a deliberate decision.
