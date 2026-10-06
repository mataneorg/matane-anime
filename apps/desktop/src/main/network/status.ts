import { net } from 'electron';

/** Tells the app when the machine goes on or offline. Electron has no main-process event, so it polls. */
export class NetworkStatus {
  private online = net.online;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly onChange: (online: boolean) => void) {}

  get isOnline(): boolean {
    return net.online;
  }

  start(intervalMs = 3000): void {
    this.timer = setInterval(() => {
      const now = net.online;
      if (now === this.online) return;
      this.online = now;
      this.onChange(now);
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
