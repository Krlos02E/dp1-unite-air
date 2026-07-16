import { HttpClient } from './HttpClient'
import type { ActiveSimulationInfo, SimulationState } from '../types'

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

  activa(): Promise<ActiveSimulationInfo> {
    return this.get<ActiveSimulationInfo>(`/simulacion/activa`)
  }

  reiniciarContexto(): Promise<{ success: boolean }> {
    return this.post('/simulacion/reiniciar-contexto', {})
  }
}

export const simulationService = new SimulationService()
