/** How long a stream may take to deliver its first data before it counts as stuck. Slower than any healthy start. */
export const START_TIMEOUT_MS = 25_000;

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: below it the element has nothing to show yet. */
const HAVE_CURRENT_DATA = 2;

/**
 * A server can answer the probe and still never send the video (a file host that stalls, a link that hangs after the
 * first bytes): the element then waits for ever and no error is raised, so main would never move to another server.
 * After `ms` with no data at all, `stalled` is called once. A stream that has data but is paused (autoplay refused
 * until the user clicks) is not stuck and is left alone. Returns the function that stops the watch.
 */
export function watchStart(
  media: { readonly readyState: number },
  stalled: () => void,
  ms: number = START_TIMEOUT_MS,
): () => void {
  const timer = setTimeout(() => {
    if (media.readyState < HAVE_CURRENT_DATA) stalled();
  }, ms);
  return () => clearTimeout(timer);
}
