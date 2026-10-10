import logo from '@renderer/assets/logo.png';
import { cn } from '@renderer/lib/utils';

/** The app's icon, for the places that name the app (sidebar, setup, About). It is decoration: the name sits next to it. */
export function AppLogo({ className }: { className?: string }) {
  return <img src={logo} alt="" aria-hidden draggable={false} className={cn('shrink-0 select-none', className)} />;
}
