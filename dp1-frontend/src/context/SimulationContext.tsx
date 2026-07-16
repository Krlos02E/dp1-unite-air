import { createContext, useContext, useRef, useState, useCallback, useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { simulationService } from '../services/SimulationService'
import { simulationSocketService, type ActiveSimulationInfo } from '../services/SimulationSocketService'
import type { SimulationState } from '../types'

interface SimulationContextType {
  simulationState: SimulationState | null
  activeSimulation: ActiveSimulationInfo | null
  checkingActiveSimulation: boolean
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
  refreshActiveSimulation: () => Promise<void>
}

const SimulationContext = createContext<SimulationContextType | null>(null)

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [simulationState, setSimulationState] = useState<SimulationState | null>(null)
  const [activeSimulation, setActiveSimulation] = useState<ActiveSimulationInfo | null>(null)
  const [checkingActiveSimulation, setCheckingActiveSimulation] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [pollingInterval, setPollingInterval] = useState(2500)
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingActiveRef = useRef(false)
  const pollErrorCountRef = useRef(0)
  const currentPollingSessionIdRef = useRef<string | null>(null)
  const activeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRefreshInFlightRef = useRef(false)
  const activeSocketCleanupRef = useRef<(() => void) | null>(null)
  const sessionSocketCleanupRef = useRef<(() => void) | null>(null)
  const activeSocketConnectedRef = useRef(false)
  const sessionSocketConnectedRef = useRef(false)
  const sessionSocketFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }
    pollingActiveRef.current = false
    pollErrorCountRef.current = 0
    currentPollingSessionIdRef.current = null
    sessionSocketConnectedRef.current = false
    if (sessionSocketFallbackTimerRef.current) {
      clearTimeout(sessionSocketFallbackTimerRef.current)
      sessionSocketFallbackTimerRef.current = null
    }
    if (sessionSocketCleanupRef.current) {
      sessionSocketCleanupRef.current()
      sessionSocketCleanupRef.current = null
    }
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

  const refreshActiveSimulation = useCallback(async () => {
    if (activeRefreshInFlightRef.current) return
    activeRefreshInFlightRef.current = true
    try {
      const state = await simulationService.activa()
      setActiveSimulation(state)
    } catch {
      setActiveSimulation({ activa: false })
    } finally {
      activeRefreshInFlightRef.current = false
      setCheckingActiveSimulation(false)
    }
  }, [])

  const applySimulationState = useCallback((state: SimulationState) => {
    pollErrorCountRef.current = 0
    if (state.elapsedRealtimeSeconds !== undefined) {
      serverElapsedRef.current = state.elapsedRealtimeSeconds
      serverPollTimeRef.current = performance.now()
      setElapsedRealSeconds(state.elapsedRealtimeSeconds)
    }
    setSimulationState(state)
    setActiveSimulation((current) => ({
      ...(current ?? {}),
      activa: !(state.colapsada || state.status === 'COMPLETADA' || state.status === 'ERROR'),
      sessionId: state.sessionId,
      status: state.status,
      progreso: state.progreso,
      startedAt: state.startedAt,
      simulationStartedAt: current?.simulationStartedAt ?? state.simulationTime,
      fechaInicio: state.simulationTime,
      elapsedRealtimeSeconds: state.elapsedRealtimeSeconds,
    }))
    if (state.colapsada || state.status === 'COMPLETADA' || state.status === 'ERROR') {
      stopPolling()
    }
  }, [stopPolling])

  const startHttpPolling = useCallback((sessionId: string, effectiveInterval: number) => {
    const scheduleNextPoll = () => {
      if (!pollingActiveRef.current || sessionSocketConnectedRef.current) return
      pollTimeoutRef.current = window.setTimeout(() => {
        void poll()
      }, effectiveInterval)
    }

    const poll = async () => {
      if (!pollingActiveRef.current || sessionSocketConnectedRef.current) return
      let shouldScheduleNext = true
      try {
        const state = await simulationService.poll(sessionId)
        if (!pollingActiveRef.current || sessionSocketConnectedRef.current) return
        applySimulationState(state)
        if (state.colapsada || state.status === 'COMPLETADA') {
          shouldScheduleNext = false
        }
      } catch {
        pollErrorCountRef.current += 1
        if (pollErrorCountRef.current >= 3) {
          shouldScheduleNext = false
          stopPolling()
        }
      } finally {
        if (shouldScheduleNext && pollingActiveRef.current && !sessionSocketConnectedRef.current) {
          scheduleNextPoll()
        }
      }
    }

    void poll()
  }, [applySimulationState, stopPolling])

  const connectSessionSocket = useCallback((sessionId: string, effectiveInterval: number) => {
    sessionSocketConnectedRef.current = false
    if (sessionSocketCleanupRef.current) {
      sessionSocketCleanupRef.current()
      sessionSocketCleanupRef.current = null
    }
    if (sessionSocketFallbackTimerRef.current) {
      clearTimeout(sessionSocketFallbackTimerRef.current)
    }

    sessionSocketFallbackTimerRef.current = window.setTimeout(() => {
      if (pollingActiveRef.current && currentPollingSessionIdRef.current === sessionId && !sessionSocketConnectedRef.current) {
        startHttpPolling(sessionId, effectiveInterval)
      }
    }, 2500)

    sessionSocketCleanupRef.current = simulationSocketService.connectSimulationState(sessionId, {
      onOpen: () => {
        sessionSocketConnectedRef.current = true
        if (sessionSocketFallbackTimerRef.current) {
          clearTimeout(sessionSocketFallbackTimerRef.current)
          sessionSocketFallbackTimerRef.current = null
        }
      },
      onMessage: (state) => {
        if (!pollingActiveRef.current || currentPollingSessionIdRef.current !== sessionId) return
        applySimulationState(state)
      },
      onClose: () => {
        const shouldFallback = pollingActiveRef.current && currentPollingSessionIdRef.current === sessionId
        sessionSocketConnectedRef.current = false
        if (shouldFallback) {
          startHttpPolling(sessionId, effectiveInterval)
        }
      },
      onError: () => {
        sessionSocketConnectedRef.current = false
      },
    })
  }, [applySimulationState, startHttpPolling])

  const startPolling = useCallback((sessionId: string, interval?: number, startedAt?: string, initialElapsed?: number) => {
    if (pollingActiveRef.current && currentPollingSessionIdRef.current === sessionId) {
      return
    }
    stopPolling()
    setSimulationState(null)
    setActiveSimulation((current) => ({
      activa: true,
      ...(current ?? {}),
      sessionId,
      startedAt: startedAt ?? current?.startedAt,
      elapsedRealtimeSeconds: initialElapsed ?? current?.elapsedRealtimeSeconds,
    }))
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
    pollErrorCountRef.current = 0
    currentPollingSessionIdRef.current = sessionId

    const effectiveInterval = interval ?? pollingInterval
    connectSessionSocket(sessionId, effectiveInterval)
  }, [connectSessionSocket, pollingInterval, stopPolling])

  useEffect(() => {
    activeSocketCleanupRef.current = simulationSocketService.connectActiveSimulation({
      onOpen: () => {
        activeSocketConnectedRef.current = true
        setCheckingActiveSimulation(false)
      },
      onMessage: (state) => {
        activeSocketConnectedRef.current = true
        setActiveSimulation(state)
        setCheckingActiveSimulation(false)
      },
      onClose: () => {
        activeSocketConnectedRef.current = false
      },
      onError: () => {
        activeSocketConnectedRef.current = false
      },
    })

    return () => {
      if (activeSocketCleanupRef.current) {
        activeSocketCleanupRef.current()
        activeSocketCleanupRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (activeSocketConnectedRef.current) {
      setCheckingActiveSimulation(false)
      return () => {
        cancelled = true
      }
    }

    const scheduleNextRefresh = () => {
      if (cancelled) return
      activeRefreshTimeoutRef.current = window.setTimeout(async () => {
        if (activeSocketConnectedRef.current) return
        await refreshActiveSimulation()
        scheduleNextRefresh()
      }, 5000)
    }

    void refreshActiveSimulation().finally(() => {
      scheduleNextRefresh()
    })

    return () => {
      cancelled = true
      if (activeRefreshTimeoutRef.current) {
        clearTimeout(activeRefreshTimeoutRef.current)
        activeRefreshTimeoutRef.current = null
      }
    }
  }, [refreshActiveSimulation])

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
      activeSimulation,
      checkingActiveSimulation,
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
      refreshActiveSimulation,
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
