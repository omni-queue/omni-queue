import { useCallback, useEffect, useRef, useState } from 'react';
import type { OverviewResponse, WsMessage } from '../types';
import { API_BASE, DASHBOARD_TRANSPORT } from '../types';

function resolveWsUrl(): string {
  const httpBase = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`;
  return httpBase.replace(/^http/, 'ws') + '/ws';
}

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

export function useWebSocket(onOverview: (data: OverviewResponse) => void) {
  const [status, setStatus] = useState<WsStatus>(
    DASHBOARD_TRANSPORT === 'polling' ? 'disconnected' : 'connecting'
  );
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const onOverviewRef = useRef(onOverview);
  onOverviewRef.current = onOverview;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (DASHBOARD_TRANSPORT === 'polling') {
      setStatus('disconnected');
      return;
    }

    setStatus('connecting');
    const ws = new WebSocket(resolveWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setStatus('connected');
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        if (msg.type === 'overview') onOverviewRef.current(msg.data as OverviewResponse);
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus('disconnected');
      retryRef.current = setTimeout(() => { connect(); }, 3000);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (DASHBOARD_TRANSPORT === 'polling') {
      setStatus('disconnected');
      return () => {
        mountedRef.current = false;
      };
    }

    connect();
    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return status;
}
