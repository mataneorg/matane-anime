import '@matane-anime/extension-sdk/globals';
import { HttpError, ParseError } from '@matane-anime/extension-sdk';
import { assertOk, base } from './site';
import { unescapeHtml } from './text';

// The site is Laravel + Livewire 3. A list is rendered into the page (the first 24 items, as an Alpine `x-data`
// value) and everything after that is a POST to `/livewire/update`: the page's CSRF token, the component's snapshot
// (a `wire:snapshot` attribute) and the session cookie that the page's own GET set. The app keeps cookies per
// extension, so the cookie travels by itself; where no cookie is kept (the `ma-ext` CLI) the POST answers 419.

export interface Component {
  csrf: string;
  /** The component's snapshot, as the JSON text the page carries. */
  snapshot: string;
  /** The address of the page, sent as Referer and Origin. */
  page: string;
}

export interface ListPage {
  items: unknown[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** The snapshot of the component named `name` (`pages.anime-index`), and the page's CSRF token. */
export function findComponent(page: string, name: string, address: string): Component | undefined {
  const csrf = /<meta name="csrf-token" content="([^"]+)"/.exec(page)?.[1];
  if (!csrf) return undefined;
  for (const match of page.matchAll(/wire:snapshot="([^"]*)"/g)) {
    const snapshot = unescapeHtml(match[1] as string);
    if (snapshot.includes(`"name":"${name}"`)) return { csrf, snapshot, page: address };
  }
  return undefined;
}

interface Dispatch {
  name?: string;
  params?: Partial<ListPage>;
}

interface Answer {
  components?: { snapshot?: string; effects?: { dispatches?: Dispatch[] } }[];
}

/**
 * One call of the component: property `updates` and/or method `calls`. The answer's new snapshot replaces the
 * old one; the list the call produced arrives as a dispatched event (`filters-reset` or `items-loaded`).
 */
export async function callComponent(
  component: Component,
  updates: Record<string, string>,
  calls: { path: string; method: string; params: unknown[] }[],
): Promise<{ component: Component; list: ListPage | undefined }> {
  const url = `${base()}/livewire/update`;
  const origin = new URL(component.page).origin;
  const response = await http.post(
    url,
    JSON.stringify({ _token: component.csrf, components: [{ snapshot: component.snapshot, updates, calls }] }),
    {
      headers: {
        'content-type': 'application/json',
        'X-Livewire': 'true',
        'X-CSRF-TOKEN': component.csrf,
        Origin: origin,
        Referer: component.page,
      },
      throwOnError: false,
    },
  );
  if (response.status === 419) throw new HttpError(419, 'The site wants a session cookie for this (page expired)');
  assertOk(response, url);
  let answer: Answer;
  try {
    answer = response.json<Answer>();
  } catch {
    throw new ParseError('Livewire did not answer JSON: the site changed');
  }
  const first = answer.components?.[0];
  if (!first?.snapshot) throw new ParseError('Livewire answered without a snapshot: the site changed');
  const dispatched = (first.effects?.dispatches ?? []).find(
    (d) => d.name === 'filters-reset' || d.name === 'items-loaded',
  );
  const params = dispatched?.params;
  const list =
    params && Array.isArray(params.items)
      ? {
          items: params.items,
          nextCursor: params.nextCursor ?? null,
          hasMore: params.hasMore === true && !!params.nextCursor,
        }
      : undefined;
  return { component: { ...component, snapshot: first.snapshot }, list };
}
