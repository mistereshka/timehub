import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { HOST_METHODS, IPC_CHANGED, IPC_INVOKE, SERVICE_METHODS } from '@shared/api'
import type { ChangeTopic } from '@shared/types'

const api: Record<string, unknown> = {}
for (const method of [...SERVICE_METHODS, ...HOST_METHODS]) {
  api[method] = (...args: unknown[]) => ipcRenderer.invoke(IPC_INVOKE, method, args)
}
api.onChange = (listener: (topic: ChangeTopic) => void) => {
  const handler = (_event: IpcRendererEvent, topic: ChangeTopic): void => listener(topic)
  ipcRenderer.on(IPC_CHANGED, handler)
  return () => {
    ipcRenderer.removeListener(IPC_CHANGED, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
