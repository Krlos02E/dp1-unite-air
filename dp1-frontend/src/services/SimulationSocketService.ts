import type { AlmacenContexto, ContextSharedState, SimulationState } from '../types'

export interface ActiveSimulationInfo {
  activa: boolean
  sessionId?: string
  status?: string
  progreso?: number
  startedAt?: string
  simulationStartedAt?: string
  fechaInicio?: string
  elapsedRealtimeSeconds?: number
}

export interface RealtimeEnvelope<T> {
  type: string
  payload: T
}

interface SocketCallbacks<T> {
  onMessage: (payload: T) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: () => void
}

function resolveWebSocketBaseUrl(): string {
  const apiBase = import.meta.env.VITE_API_URL || '/api'
  if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
    const url = new URL(apiBase)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

function openSocket<T>(path: string, callbacks: SocketCallbacks<T>): () => void {
  const socket = new WebSocket(`${resolveWebSocketBaseUrl()}${path}`)

  socket.onopen = () => {
    callbacks.onOpen?.()
  }

  socket.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as RealtimeEnvelope<T>
      callbacks.onMessage(parsed.payload)
    } catch {
      // Ignore malformed frames and keep the connection alive.
    }
  }

  socket.onerror = () => {
    callbacks.onError?.()
  }

  socket.onclose = () => {
    callbacks.onClose?.()
  }

  return () => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close()
    }
  }
}

class SimulationSocketService {
  connectActiveSimulation(callbacks: SocketCallbacks<ActiveSimulationInfo>): () => void {
    return openSocket('/ws/simulacion/activa', callbacks)
  }

  connectSimulationState(sessionId: string, callbacks: SocketCallbacks<SimulationState>): () => void {
    return openSocket(`/ws/simulacion/estado?sessionId=${encodeURIComponent(sessionId)}`, callbacks)
  }

  connectContext(contexto: AlmacenContexto, callbacks: SocketCallbacks<ContextSharedState>): () => void {
    return openSocket(`/ws/contexto?contexto=${encodeURIComponent(contexto)}`, callbacks)
  }
}

export const simulationSocketService = new SimulationSocketService()
