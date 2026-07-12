const CHANNEL_NAME = 'uniteair_simulation'

export type BroadcastMessageType = 'STARTED' | 'STOPPED' | 'PAUSED' | 'RESUMED'

export interface BroadcastMessage {
  type: BroadcastMessageType
  payload?: Record<string, any>
  timestamp: number
}

export function broadcastSimMessage(type: BroadcastMessageType, payload?: Record<string, any>) {
  try {
    const bc = new BroadcastChannel(CHANNEL_NAME)
    bc.postMessage({ type, payload, timestamp: Date.now() } as BroadcastMessage)
    bc.close()
  } catch {
    // BroadcastChannel not supported (e.g. older browsers or cross-origin iframes)
  }
}

export function listenSimMessages(handler: (msg: BroadcastMessage) => void): () => void {
  try {
    const bc = new BroadcastChannel(CHANNEL_NAME)
    bc.onmessage = (ev: MessageEvent<BroadcastMessage>) => {
      handler(ev.data)
    }
    return () => bc.close()
  } catch {
    return () => {}
  }
}
