import { WebSocketConnectorConfig } from '../web-socket-connector/types';
import { vi } from 'vitest';
import { WebSocketConnector } from '../web-socket-connector/web-socket-connector';

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
