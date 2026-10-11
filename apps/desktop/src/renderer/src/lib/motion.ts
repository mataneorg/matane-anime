import type { Transition, Variants } from 'motion/react';

/*
 * The one place the app's motion lives (docs/ui/design-system.md, "Motion"). Import `m`, `AnimatePresence` and the
 * tokens from here, never from `motion/react` directly: <MotionProvider> runs in `strict` mode, so a plain `motion.div`
 * throws, and only `m.*` components are allowed.
 */
export { AnimatePresence, LayoutGroup, LazyMotion, MotionConfig, m, useReducedMotion } from 'motion/react';

/** Seconds. Short and sharp: this is a desktop app, nothing should make the user wait. */
export const duration = { fast: 0.12, base: 0.18, slow: 0.24 } as const;

/** Ease-out with a soft landing; the same curve for every enter and exit. No springs or bounce. */
export const ease = [0.16, 1, 0.3, 1] as const;

export const transition = {
  fast: { duration: duration.fast, ease },
  base: { duration: duration.base, ease },
  slow: { duration: duration.slow, ease },
  /** A shared-element move (`layoutId`): a slide between two places, so it is a little longer than an enter. */
  layout: { duration: duration.slow, ease },
} as const satisfies Record<string, Transition>;

/*
 * Variants for `initial="hidden" animate="visible" exit="hidden"`, or `exit="exit"` where leaving differs from entering.
 * Only `transform` and `opacity` are animated (compositor only), with one exception: `collapse` animates `height`,
 * for a short list that folds. Never use it on a virtualized or long list.
 */
export const fade = {
  hidden: { opacity: 0, transition: transition.fast },
  visible: { opacity: 1, transition: transition.base },
} as const satisfies Variants;

/** A page arriving: a few pixels of rise, no exit (the router swaps the page at once). */
export const fadeUp = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: transition.base },
} as const satisfies Variants;

/** A side panel (the player's episode and server lists) sliding in from the right edge. */
export const slideInRight = {
  hidden: { opacity: 0, x: 24, transition: transition.fast },
  visible: { opacity: 1, x: 0, transition: transition.base },
} as const satisfies Variants;

/** A floating bar (the episode selection bar) rising from the bottom. */
export const slideUpBar = {
  hidden: { opacity: 0, y: 16, transition: transition.fast },
  visible: { opacity: 1, y: 0, transition: transition.base },
} as const satisfies Variants;

/** A modal: the scrim fades with `fade`, the card scales up from 97% and rises a few pixels. */
export const scaleIn = {
  hidden: { opacity: 0, scale: 0.97, y: 8, transition: transition.fast },
  visible: { opacity: 1, scale: 1, y: 0, transition: transition.base },
} as const satisfies Variants;

/** A fold: put it on an element with `overflow: hidden`. */
export const collapse = {
  hidden: { opacity: 0, height: 0, transition: transition.fast },
  visible: { opacity: 1, height: 'auto', transition: transition.base },
} as const satisfies Variants;
