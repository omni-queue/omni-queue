import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { DashboardAuthOptions } from '@omni-queue/core';
import { buildCorsMiddleware } from '../middleware/cors';
import { buildDashboardRouter } from '../routes/dashboard';
import { attachWebSocket } from './websocket';
import type { APIAdapterOptions, CorsOptions } from '../types';
import { normalizeBase } from '../utils/http';

export class APIAdapter {
  private readonly host: string;
  private readonly port: number;
  private readonly apiBase: string;
  private readonly legacyApiBase: string | undefined;
  private readonly uiBase: string;
  private readonly uiDir: string | undefined;
  private readonly auth: DashboardAuthOptions;
  private readonly streamIntervalMs: number;
  private readonly signals: boolean;
  private readonly appInstance: express.Application;
  private serverInstance: http.Server | undefined;
  private webSocketServer = undefined as ReturnType<typeof attachWebSocket> | undefined;

  constructor(private readonly options: APIAdapterOptions) {
    const configured = options.supervisor.getDashboardOptions();
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 3210;
    this.apiBase = normalizeBase(options.apiBase, '/api/dashboard');
    this.legacyApiBase = this.apiBase === '/dashboard' ? undefined : '/dashboard';
    this.uiBase = options.uiBase ? normalizeBase(options.uiBase, '/') : '/';
    this.uiDir = options.uiDir;
    this.auth = options.auth ?? configured?.auth ?? { type: 'none' };
    this.streamIntervalMs = options.streamIntervalMs ?? configured?.streamIntervalMs ?? 2000;
    this.signals = options.signals !== false;
    this.appInstance = express();
    this.configureApp(options.cors);
  }

  get express(): express.Application {
    return this.appInstance;
  }

  get server(): http.Server | undefined {
    return this.serverInstance;
  }

  private configureApp(cors: boolean | CorsOptions | undefined): void {
    const corsMiddleware = buildCorsMiddleware(cors);
    if (corsMiddleware) this.appInstance.use(corsMiddleware);

    const router = buildDashboardRouter(this.options.supervisor, this.auth, this.streamIntervalMs);

    this.appInstance.use(this.apiBase, router);
    if (this.legacyApiBase) {
      this.appInstance.use(this.legacyApiBase, router);
    }

    this.appInstance.options(`${this.apiBase}/*`, (_req, res) => {
      res.sendStatus(204);
    });
    if (this.legacyApiBase) {
      this.appInstance.options(`${this.legacyApiBase}/*`, (_req, res) => {
        res.sendStatus(204);
      });
    }

    if (this.uiDir && fs.existsSync(this.uiDir)) {
      this.appInstance.use(this.uiBase, express.static(this.uiDir, { maxAge: '1d' }));
      this.appInstance.use((_req: Request, res: Response, next: NextFunction) => {
        const indexPath = path.join(this.uiDir!, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
          return;
        }
        next();
      });
    }
  }

  async start(): Promise<void> {
    if (this.serverInstance) return;

    this.serverInstance = http.createServer(this.appInstance);
    this.webSocketServer = attachWebSocket(
      this.serverInstance,
      this.legacyApiBase ? [`${this.apiBase}/ws`, `${this.legacyApiBase}/ws`] : `${this.apiBase}/ws`,
      this.options.supervisor,
      this.auth,
      this.streamIntervalMs
    );

    if (this.signals) {
      const shutdown = () => {
        void this.stopAsync().finally(() => process.exit(0));
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    }

    await new Promise<void>((resolve) => {
      this.serverInstance!.listen(this.port, this.host, resolve);
    });

    console.log(`[omni-queue/dashboard-api] listening  → http://${this.host}:${this.port}${this.apiBase}`);
    console.log(`[omni-queue/dashboard-api] websocket  → ws://${this.host}:${this.port}${this.apiBase}/ws`);
    if (this.legacyApiBase) {
      console.log(`[omni-queue/dashboard-api] legacy API → http://${this.host}:${this.port}${this.legacyApiBase}`);
      console.log(`[omni-queue/dashboard-api] legacy WS  → ws://${this.host}:${this.port}${this.legacyApiBase}/ws`);
    }
    if (this.uiDir) {
      console.log(`[omni-queue/dashboard-api] dashboard UI → http://${this.host}:${this.port}${this.uiBase}`);
    }
  }

  async stopAsync(): Promise<void> {
    this.webSocketServer?.close();

    await new Promise<void>((resolve, reject) => {
      if (!this.serverInstance) {
        resolve();
        return;
      }

      this.serverInstance.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.serverInstance = undefined;
    this.webSocketServer = undefined;
    console.log('[omni-queue/dashboard-api] stopped');
  }

  stop(): void {
    void this.stopAsync();
  }
}
