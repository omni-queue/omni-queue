export interface GracefulShutdownOptions {
  label: string;
  timeoutMs?: number;
  onShutdown: () => Promise<void>;
}

export function registerGracefulShutdown(options: GracefulShutdownOptions): void {
  const timeoutMs = options.timeoutMs ?? 5_000;
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`\n[${options.label}] shutting down ...`);

    const forceExitTimer = setTimeout(() => {
      console.error(`[${options.label}] forcing shutdown after timeout`);
      process.exit(1);
    }, timeoutMs);

    forceExitTimer.unref();

    try {
      await options.onShutdown();
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExitTimer);
      console.error(
        `[${options.label}] shutdown failed:`,
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void shutdown();
  });

  process.once('SIGTERM', () => {
    void shutdown();
  });
}
