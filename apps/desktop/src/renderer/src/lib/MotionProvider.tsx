import type { ReactNode } from 'react';
import { LazyMotion, MotionConfig } from './motion';

const loadFeatures = () => import('./motionFeatures').then((module) => module.default);

/**
 * The root of every animation. `reducedMotion="user"` follows the OS setting (UI-5): transform and layout animations
 * are dropped, opacity ones stay. The CSS rule in styles.css cannot reach animations that run from JS.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
