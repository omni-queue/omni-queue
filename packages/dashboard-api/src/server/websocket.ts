import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import type { DashboardAuthOptions } from '@vasto-queue/core';
import {
  authenticateDashboardRequest,
  hasDashboardPermissionForContext,
  resolveDashboardChallenge,
} from '../middleware/auth';
import { buildOverview } from '../services/overview';
import type { DashboardApiOptions, DashboardWebSocketController } from '../types';

const require = createRequire(import.meta.url);

function loadWebSocketRuntime(): { WebSocket: any; WebSocketServer: any } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws');
  return { WebSocket: ws.WebSocket, WebSocketServer: ws.WebSocketServer };
}

function getAllowedQueues(context: { allowedQueues?: string[] }): Set<string> | null {
  if (!context.allowedQueues || context.allowedQueues.length === 0) {
    return null;
  }

  return new Set(context.allowedQueues);
}

function filterOverviewByQueues(
  overview: Awaited<ReturnType<typeof buildOverview>>,
  allowedQueues: Set<string> | null
) {
  if (!allowedQueues) {
    return overview;
  }

  const filteredQueues = overview.queues.filter((queue) => allowedQueues.has(queue.queue));
  const totals = filteredQueues.reduce(
    (acc, queue) => {
      acc.depth += queue.depth;
      acc.deferred += queue.deferredCount;
      acc.dlq += queue.dlqCount;
      acc.completed += queue.completedCount ?? 0;
      return acc;
    },
    { depth: 0, deferred: 0, dlq: 0, completed: 0 }
  );

  const reliabilityQueues = (overview.reliability?.queues ?? []).filter((queue) =>
    allowedQueues.has(queue.queueName)
  );

  return {
    ...overview,
    totals: {
      ...totals,
      load: totals.depth,
    },
    queues: filteredQueues,
    reliability: {
      openCircuits: reliabilityQueues.filter((queue) => queue.circuitState === 'open').length,
      halfOpenCircuits: reliabilityQueues.filter((queue) => queue.circuitState === 'half-open').length,
      backpressuredQueues: reliabilityQueues.filter((queue) => queue.backpressureActive).length,
      queues: reliabilityQueues,
    },
  };
}

function sendUnauthorized(socket: net.Socket, auth: DashboardAuthOptions): void {
  socket.write(`HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: ${resolveDashboardChallenge(auth)}\r\n\r\n`);
  socket.destroy();
}

export function attachDashboardWebSocket(
  server: http.Server,
  paths: string[],
  options: DashboardApiOptions,
  auth: DashboardAuthOptions,
  streamIntervalMs: number
): DashboardWebSocketController {
  const { WebSocket, WebSocketServer } = loadWebSocketRuntime();
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: any, _req: http.IncomingMessage, authContext: { allowedQueues?: string[] }) => {
    let closed = false;
    const allowedQueues = getAllowedQueues(authContext);

    const sendOverview = async () => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;

      try {
        const overview = await buildOverview(options.supervisor);
        ws.send(JSON.stringify({ type: 'overview', data: filterOverviewByQueues(overview, allowedQueues) }));
      } catch {
        // ignore send failures for closing sockets
      }
    };

    void sendOverview();

    const replay = options.supervisor
      .getRecentLifecycleEvents(100)
      .filter((event) => !allowedQueues || !event.queueName || allowedQueues.has(event.queueName));
    for (const event of replay) {
      ws.send(JSON.stringify({ type: 'lifecycle', data: event }));
    }

    const unsubscribe = options.supervisor.subscribeLifecycleEvents((event) => {
      if (allowedQueues && event.queueName && !allowedQueues.has(event.queueName)) {
        return;
      }

      if (closed || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        ws.send(JSON.stringify({ type: 'lifecycle', data: event }));
      } catch {
        // ignore send failures for closing sockets
      }
    });

    const timer = setInterval(() => {
      void sendOverview();
    }, streamIntervalMs);

    ws.on('close', () => {
      closed = true;
      unsubscribe();
      clearInterval(timer);
    });

    ws.on('error', () => {
      closed = true;
      unsubscribe();
      clearInterval(timer);
      ws.terminate();
    });
  });

  const onUpgrade = async (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const matchesPath = paths.some((path) => req.url === path || req.url?.startsWith(`${path}?`));
    if (!matchesPath) {
      return;
    }

    try {
      const authContext = await authenticateDashboardRequest(req, auth);
      if (!authContext) {
        sendUnauthorized(socket, auth);
        return;
      }

      if (!hasDashboardPermissionForContext(authContext, 'read')) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws: any) => {
        wss.emit('connection', ws, req, authContext);
      });
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  };

  server.on('upgrade', onUpgrade);

  return {
    close: () => {
      server.off('upgrade', onUpgrade);
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          // ignore termination failures during shutdown
        }
      }
      wss.close();
    },
  };
}
