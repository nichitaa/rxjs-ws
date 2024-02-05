import type { WebSocketConnectorConfig } from '../core/types';
import { vi } from 'vitest';
import { WebSocketConnector } from '../core/web-socket-connector';

export const getMockWebsocketConnector = (params?: Partial<WebSocketConnectorConfig>) => {
  const mockSocket = {
    onmessage: vi.fn(),
    onopen: vi.fn(),
    onclose: vi.fn(),
    onerror: vi.fn(),
    close: vi.fn(),
    send: vi.fn((data: string) => {
      mockSocket.onmessage({ data });
    }),
  };
  const socket = mockSocket as unknown as WebSocket;
  const wsConnector = new WebSocketConnector({
    url: '',
    createWebSocketInstance: () => socket,
    ...params,
  });

  return { socket, wsConnector };
};
