import { Outlet, useRouterState } from '@tanstack/react-router';
import { CommandPalette } from '@renderer/features/palette/CommandPalette';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/* Keyed by the path so a new page starts at the top; pages that restore a position (useScrollRestoration) do it after they mount. */}
        <main key={pathname} className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
