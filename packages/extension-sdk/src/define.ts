import type { ExtensionDefinition } from './types.js';

/**
 * The default export of an extension's entry file:
 *
 *     export default defineExtension({ createSource: (info) => ({ … }) });
 *
 * It returns its argument; it exists so editors check the shape. `ma-ext build` registers the default
 * export with the host.
 */
export function defineExtension(definition: ExtensionDefinition): ExtensionDefinition {
  return definition;
}
