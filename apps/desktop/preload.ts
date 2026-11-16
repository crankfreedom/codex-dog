import { contextBridge, ipcRenderer } from 'electron';
import type { OperationName, Response } from '../../packages/contracts/protocol.ts';

const bridge = Object.freeze({
  request: (operation: OperationName, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<Response> => ipcRenderer.invoke('dog:request', { operation, params, ...(idempotencyKey ? { idempotencyKey } : {}) }),
});
contextBridge.exposeInMainWorld('codexDog', bridge);
if (process.argv.includes('--g03-test-hooks')) contextBridge.exposeInMainWorld('codexDogTest', Object.freeze({
  fixture: (params: Record<string, unknown>) => ipcRenderer.invoke('dog:test:g03', params),
}));
