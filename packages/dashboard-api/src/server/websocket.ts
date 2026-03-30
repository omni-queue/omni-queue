import http from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocket, WebSocketServer } from 'ws';
import type { DashboardAuthContext, DashboardAuthDecision, DashboardAuthOptions, Supervisor } from '@omni-queue/core';
import { buildOverview } from '../services/overview';

function normalizeDecision(decision: DashboardAuthDecision): DashboardAuthContext | null {
  if (decision === true) {
    return { role: 'admin' };
  }

  if (!decision) {
    return null;
  }

  return {
    ...decision,
    ...(decision.role ? {} : { role: 'admin' }),
  };
}

function canRead(context: DashboardAuthContext): boolean {
  const role = context.role ?? 'admin';
  if (role === 'viewer' || role === 'operator' || role === 'admin') {
    if (!context.scopes || context.scopes.length === 0) {
      return true;
    }

    return context.scopes.some((scope) => scope === 'dashboard:read' || scope === 'dashboard:operate' || scope === 'dashboard:admin');
  }

  return false;
}

function getAllowedQueues(context: DashboardAuthContext): Set<string> | null {
  if (!context.allowedQueues || context.allowedQueues.length === 0) {
    return null;
  }

  return new Set(context.allowedQueues);
}

function filterOverviewByQueues(overview: Awaited<ReturnType<typeof buildOverview>>, allowedQueues: Set<string> | null) {
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

  const reliabilityQueues = (overview.reliability?.queues ?? []).filter((queue) => allowedQueues.has(queue.queueName));

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

export function attachWebSocket(
  server: http.Server,
  wsPath: string | string[],
  supervisor: Supervisor,
  auth: DashboardAuthOptions,
  streamIntervalMs: number
): WebSocketServer {
  const paths = Array.isArray(wsPath) ? wsPath : [wsPath];

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, authContext: DashboardAuthContext) => {
    let closed = false;
    const allowedQueues = getAllowedQueues(authContext);

    const send = async () => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;

      try {
        const overview = await buildOverview(supervisor);
        ws.send(JSON.stringify({ type: 'overview', data: filterOverviewByQueues(overview, allowedQueues) }));
      } catch {
        // ignore send failures for closing sockets
      }
    };

    void send();

    const replay = supervisor
      .getRecentLifecycleEvents(100)
      .filter((event) => !allowedQueues || !event.queueName || allowedQueues.has(event.queueName));
    for (const event of replay) {
      ws.send(JSON.stringify({ type: 'lifecycle', data: event }));
    }

    const unsubscribe = supervisor.subscribeLifecycleEvents((event) => {
      if (allowedQueues && event.queueName && !allowedQueues.has(event.queueName)) {
        return;
      }
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: 'lifecycle', data: event }));
      } catch {
        // ignore send failures for closing sockets
      }
    });

    const timer = setInterval(() => {
      void send();
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

  server.on('upgrade', async (req, socket, head) => {
    const matchesPath = paths.some((path) => req.url === path || req.url?.startsWith(`${path}?`));
    if (!matchesPath) {
      socket.destroy();
      return;
    }

    let authContext: DashboardAuthContext = { role: 'admin' };

    if (auth.type !== 'none') {
      const header = req.headers.authorization ?? '';
      let allowed = false;

      try {
        if (auth.type === 'bearer' && header.startsWith('Bearer ')) {
          const decision = normalizeDecision(await auth.validator({ token: header.slice(7).trim(), request: req }));
          allowed = Boolean(decision);
          if (decision) authContext = decision;
        } else if (auth.type === 'basic' && header.startsWith('Basic ')) {
          const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
          const separatorIndex = decoded.indexOf(':');
          const decision = normalizeDecision(await auth.validator({
            username: separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded,
            password: separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '',
            request: req,
          }));
          allowed = Boolean(decision);
          if (decision) authContext = decision;
        }
      } catch {
        allowed = false;
      }

      if (!allowed) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    if (!canRead(authContext)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, authContext);
    });
  });

  return wss;
}
