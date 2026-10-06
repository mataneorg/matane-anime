import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '@renderer/components/shell/AppShell';

// A pathless layout: every page below it gets the title bar and the sidebar. The player does not.
export const Route = createFileRoute('/_app')({ component: AppShell });
