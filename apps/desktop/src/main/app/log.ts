import log from 'electron-log/main';

/**
 * File log with rotation (electron-log keeps the previous file as `main.old.log`). Renderer logs are
 * forwarded to main. Nothing leaves the machine: no telemetry (docs/PRD.md §10.3).
 */
export function initLogging(): typeof log {
  log.initialize();
  log.transports.file.maxSize = 2 * 1024 * 1024;
  log.transports.file.level = 'info';
  log.transports.console.level = process.env['ELECTRON_RENDERER_URL'] ? 'debug' : 'warn';
  log.errorHandler.startCatching({ showDialog: false });
  return log;
}

export { log };
