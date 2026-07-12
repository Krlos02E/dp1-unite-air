import { createContext, useContext, useRef, useState, useCallback, useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { simulationService } from '../services/SimulationService'
import type { SimulationState } from '../types'

interface SimulationContextType {
  simulationState: SimulationState | null
  isRunning: boolean
  pollingInterval: number
  elapsedRealSeconds: number
  isPaused: boolean
  setSimulationState: Dispatch<SetStateAction<SimulationState | null>>
  setIsRunning: (running: boolean) => void
  setPollingInterval: (ms: number) => void
  setIsPaused: (paused: boolean) => void
  resetElapsedTimer: () => void
  startPolling: (sessionId: string, interval?: number, startedAt?: string, initialElapsed?: number) => void
  stopPolling: () => void
  resetSimulation: () => void
}

const SimulationContext = createContext<SimulationContextType | null>(null)

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [simulationState, setSimulationState] = useState<SimulationState | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [pollingInterval, setPollingInterval] = useState(2500)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollingActiveRef = useRef(false)

  const [elapsedRealSeconds, setElapsedRealSeconds] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const serverElapsedRef = useRef(0)
  const serverPollTimeRef = useRef(0)

  const resetElapsedTimer = useCallback(() => {
    setElapsedRealSeconds(0)
    serverElapsedRef.current = 0
    serverPollTimeRef.current = 0
  }, [])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    pollingActiveRef.current = false
    setIsRunning(false)
  }, [])

  const resetSimulation = useCallback(() => {
    stopPolling()
    setSimulationState(null)
    setIsPaused(false)
    setElapsedRealSeconds(0)
    serverElapsedRef.current = 0
    serverPollTimeRef.current = 0
  }, [stopPolling])

  const startPolling = useCallback((sessionId: string, interval?: number, startedAt?: string, initialElapsed?: number) => {
    stopPolling()
    setSimulationState(null)
    setIsRunning(true)
    setIsPaused(false)
    if (initialElapsed !== undefined) {
      serverElapsedRef.current = initialElapsed
      serverPollTimeRef.current = performance.now()
      setElapsedRealSeconds(initialElapsed)
    } else if (startedAt) {
      const parsed = Date.parse(startedAt)
      if (!isNaN(parsed)) {
        const elapsed = Math.max(0, Math.floor((Date.now() - parsed) / 1000))
        serverElapsedRef.current = elapsed
        serverPollTimeRef.current = performance.now()
        setElapsedRealSeconds(elapsed)
      }
    } else {
      setElapsedRealSeconds(0)
      serverElapsedRef.current = 0
      serverPollTimeRef.current = performance.now()
    }
    pollingActiveRef.current = true

    const effectiveInterval = interval ?? pollingInterval

    const poll = async () => {
      if (!pollingActiveRef.current) return
      try {
        const state = await simulationService.poll(sessionId)
        if (!pollingActiveRef.current) return
        if (state.elapsedRealtimeSeconds !== undefined) {
          serverElapsedRef.current = state.elapsedRealtimeSeconds
          serverPollTimeRef.current = performance.now()
        }
        setSimulationState(state)
        if (state.colapsada || state.status === 'COMPLETADA') {
          stopPolling()
        }
      } catch {
        stopPolling()
      }
    }

    poll()
    intervalRef.current = setInterval(poll, effectiveInterval)
  }, [pollingInterval, stopPolling])

  // Timer: uses server elapsedRealtimeSeconds as base and interpolates between polls
  useEffect(() => {
    const isFinished = simulationState?.status === 'COMPLETADA' || simulationState?.status === 'COLAPSADA' || simulationState?.status === 'ERROR' || (simulationState && simulationState.progreso >= 100)
    const isSimActive = isRunning && !isFinished
    const shouldTick = isSimActive && !isPaused

    if (shouldTick) {
      if (!timerIntervalRef.current) {
        timerIntervalRef.current = setInterval(() => {
          const delta = Math.floor((performance.now() - serverPollTimeRef.current) / 1000)
          setElapsedRealSeconds(serverElapsedRef.current + delta)
        }, 1000)
      }
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
    }
  }, [isRunning, isPaused, simulationState?.status, simulationState?.progreso])

  return (
    <SimulationContext.Provider value={{
      simulationState,
      isRunning,
      pollingInterval,
      elapsedRealSeconds,
      isPaused,
      setSimulationState,
      setIsRunning,
      setPollingInterval,
      setIsPaused,
      resetElapsedTimer,
      startPolling,
      stopPolling,
      resetSimulation,
    }}>
      {children}
    </SimulationContext.Provider>
  )
}

export function useSimulation(): SimulationContextType {
  const ctx = useContext(SimulationContext)
  if (!ctx) throw new Error('useSimulation must be used within SimulationProvider')
  return ctx
}
