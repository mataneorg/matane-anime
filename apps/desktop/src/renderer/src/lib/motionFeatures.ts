// `domMax` (not `domAnimation`) because shared-element indicators use `layoutId`. It sits in its own file so
// <MotionProvider> loads it with a dynamic import and the first paint does not wait for it.
export { domMax as default } from 'motion/react';
