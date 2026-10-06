import { createFileRoute } from '@tanstack/react-router';
import { PlayerView } from '@renderer/features/player/PlayerView';

// Outside `_app`: the player is full screen, with no title bar or sidebar of the shell (docs/PRD.md PLY-1).
export const Route = createFileRoute('/watch/$episodeId')({ component: WatchPage });

function WatchPage() {
  const episodeId = Number(Route.useParams().episodeId);
  // A different episode starts a new playback with fresh state.
  return <PlayerView key={episodeId} episodeId={episodeId} />;
}
