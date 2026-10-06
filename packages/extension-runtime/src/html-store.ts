import * as cheerio from 'cheerio';
import type { HtmlLoadOptions } from '@matane-anime/extension-sdk';

/** Any selection: an element, a list of them, or the document root (which supports the same calls). */
type Selection = ReturnType<ReturnType<cheerio.CheerioAPI['root']>['find']>;

interface Handle {
  $: cheerio.CheerioAPI;
  node: Selection;
  baseUrl: string | undefined;
}

/**
 * Parsed documents and their nodes. The DOM stays here, in the host, and the sandbox holds integer handles:
 * QuickJS is far too slow to parse HTML itself (docs/adr/0011). Handles live until `clear()`, which the
 * runtime calls when no call is running any more.
 */
export class HtmlStore {
  private readonly handles = new Map<number, Handle>();
  private next = 1;

  get size(): number {
    return this.handles.size;
  }

  load(body: string, options: HtmlLoadOptions): number {
    const $ = cheerio.load(body, options.xml ? { xml: true } : undefined);
    return this.add({ $, node: $.root() as unknown as Selection, baseUrl: options.baseUrl });
  }

  select(id: number, selector: string): number[] {
    const { $, node, baseUrl } = this.get(id);
    return node
      .find(selector)
      .toArray()
      .map((child) => this.add({ $, node: $(child), baseUrl }));
  }

  selectFirst(id: number, selector: string): number | null {
    const { $, node, baseUrl } = this.get(id);
    const first = node.find(selector).first();
    return first.length === 0 ? null : this.add({ $, node: first, baseUrl });
  }

  text(id: number): string {
    return this.get(id).node.text();
  }

  html(id: number): string {
    return this.get(id).node.html() ?? '';
  }

  attr(id: number, name: string): string | null {
    return this.get(id).node.attr(name) ?? null;
  }

  absUrl(id: number, name: string): string | null {
    const handle = this.get(id);
    const value = handle.node.attr(name);
    if (value === undefined) return null;
    try {
      return new URL(value, handle.baseUrl).href;
    } catch {
      return null;
    }
  }

  clear(): void {
    this.handles.clear();
  }

  private add(handle: Handle): number {
    const id = this.next++;
    this.handles.set(id, handle);
    return id;
  }

  private get(id: number): Handle {
    const handle = this.handles.get(id);
    if (!handle) throw new Error('This HTML node is no longer available: nodes only live for the call that made them');
    return handle;
  }
}
