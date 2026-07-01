import { HttpClient } from './HttpClient'
import type { SimulationState } from '../types'

class SimulationService extends HttpClient {
  iniciar(config: { duracionDias: number; fechaInicio: string; horaInicio: string; algoritmo: string; velocidad?: number }): Promise<SimulationState> {
    return this.post<SimulationState>('/simulacion/iniciar', config)
  }

  estado(sessionId: string): Promise<SimulationState> {
    return this.get<SimulationState>(`/simulacion/estado/${sessionId}`)
  }

  detener(sessionId: string): Promise<SimulationState> {
    return this.post<SimulationState>(`/simulacion/detener/${sessionId}`)
  }

  pausar(sessionId: string): Promise<SimulationState> {
    return this.post<SimulationState>(`/simulacion/pausar/${sessionId}`)
  }

  reanudar(sessionId: string): Promise<SimulationState> {
    return this.post<SimulationState>(`/simulacion/reanudar/${sessionId}`)
  }

  poll(sessionId: string): Promise<SimulationState> {
    return this.get<SimulationState>(`/simulacion/${sessionId}/poll`)
  }

  activa(): Promise<{ activa: boolean; sessionId?: string; status?: string; progreso?: number; startedAt?: string; elapsedRealtimeSeconds?: number }> {
    return this.get(`/simulacion/activa`)
  }

  reiniciarContexto(): Promise<{ success: boolean }> {
    return this.post('/simulacion/reiniciar-contexto', {})
  }
}

export const simulationService = new SimulationService()
