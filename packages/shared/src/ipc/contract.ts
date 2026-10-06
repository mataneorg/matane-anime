import { z } from 'zod';
import { appSettingsSchema, settingsPatchSchema } from '../settings';
import { spikeFixtureSchema, spikeRequestLogSchema, spikeResultSchema, spikeStartResultSchema } from '../spike';
import type { EventChannel, InvokeChannel } from './channels';

const invoke = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output });

const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  platform: z.string(),
  /** The playback spike is switched on (MATANE_SPIKE=1 or a development run). */
  spike: z.boolean(),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

/** Renderer → main request/response channels. Inputs are validated in main. */
export const invokeContract = {
  'app.getInfo': invoke(z.void(), appInfoSchema),
  /** The OS locale, e.g. `en-US`. */
  'app.getLocale': invoke(z.void(), z.string()),
  'window.minimize': invoke(z.void(), z.void()),
  'window.toggleMaximize': invoke(z.void(), z.void()),
  'window.close': invoke(z.void(), z.void()),
  'window.isMaximized': invoke(z.void(), z.boolean()),
  'settings.get': invoke(z.void(), appSettingsSchema),
  /** Merges the patch into the stored settings and returns the result (also sent as `settings.changed`). */
  'settings.set': invoke(settingsPatchSchema, appSettingsSchema),
  'spike.fixtures': invoke(z.void(), z.array(spikeFixtureSchema)),
  'spike.start': invoke(z.object({ id: z.string() }), spikeStartResultSchema),
  /** Every request the fake site has served since the last reset (to check `Range` and `Referer`). */
  'spike.stats': invoke(z.void(), z.array(spikeRequestLogSchema)),
  'spike.reset': invoke(z.void(), z.void()),
  'spike.report': invoke(spikeResultSchema, z.void()),
} satisfies Record<InvokeChannel, { input: z.ZodType; output: z.ZodType }>;

/** Main → renderer events. */
export const eventContract = {
  'window.maximizeChanged': z.boolean(),
  'settings.changed': appSettingsSchema,
} satisfies Record<EventChannel, z.ZodType>;

export type InvokeInput<C extends InvokeChannel> = z.input<(typeof invokeContract)[C]['input']>;
export type InvokeOutput<C extends InvokeChannel> = z.output<(typeof invokeContract)[C]['output']>;
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContract)[C]>;

/** Shape exposed on `window.api` by the preload script. */
export interface IpcApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeInput<C> extends void | undefined
      ? []
      : undefined extends InvokeInput<C>
        ? [input?: InvokeInput<C>]
        : [input: InvokeInput<C>]
  ): Promise<InvokeOutput<C>>;
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void;
}
