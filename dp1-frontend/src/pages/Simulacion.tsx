import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSimulation } from '../context/SimulationContext'
import { simulationService } from '../services/SimulationService'
import { cargaArchivosService } from '../services/CargaArchivosService'
import { simulationSocketService } from '../services/SimulationSocketService'
import MapaAeropuertos from '../components/MapaAeropuertos'
import EnvioListPanel from '../components/EnvioListPanel'
import MaletaListPanel from '../components/MaletaListPanel'
import AlmacenListPanel from '../components/AlmacenListPanel'
import VueloListPanel from '../components/VueloListPanel'
import ResultadosModal from '../components/ResultadosModal'
import { formatDateTime } from '../utils/dateFormat'
import { AIRPORTS_DATA } from '../data/airportsData'
import type { VueloDTO, AeropuertoDTO, SimulationState, EnvioEstado, MaletaEstado } from '../types'
import { hasSharedVersionChanged } from '../utils/sharedSync'
import { broadcastSimMessage, listenSimMessages } from '../utils/broadcast'

const SIM_CONFIG_KEY = 'uniteair_simConfig'
const SIM_ACTIVE_CONFIG_KEY = 'uniteair_activeSimConfig'
const SIM_LAST_REPORT_KEY = 'uniteair_lastSimReport'
const SIM_DISMISSED_REPORT_KEY = 'uniteair_dismissedReportSessionId'
const DURACION_FIJA = 5
const EMPTY_FLIGHTS: VueloDTO[] = []
const EMPTY_AIRPORTS: AeropuertoDTO[] = []
const SHARED_SIMULATION_CONTEXT_POLL_MS = 10000

function isFinishedSimulationState(state: SimulationState | null | undefined): state is SimulationState {
  return Boolean(
    state
    && (
      state.status === 'COMPLETADA'
      || state.status === 'COLAPSADA'
      || state.status === 'ERROR'
      || state.progreso >= 100
    )
  )
}

const aeropuertosFallback: AeropuertoDTO[] = Object.values(AIRPORTS_DATA).map((a) => ({
  codigoOACI: a.codigoOACI,
  latitud: a.latitud,
  longitud: a.longitud,
  ciudad: a.ciudad,
  capacidadMaxima: a.capacidad,
  ocupacionActual: 0,
  vuelosEntrantes: [],
  vuelosSalientes: [],
  vuelosCanceladosSalientes: [],
}))

export default function Simulacion() {
  const {
    simulationState,
    activeSimulation,
    isRunning,
    startPolling,
    resetSimulation,
    elapsedRealSeconds,
    setIsPaused,
    setSimulationState,
    resetElapsedTimer,
    refreshActiveSimulation,
  } = useSimulation()
  const [sessionId, setSessionId] = useState<string>('')
  const [aeropuertosEstaticos, setAeropuertosEstaticos] = useState<AeropuertoDTO[]>(aeropuertosFallback)
  const [vuelosEstaticos, setVuelosEstaticos] = useState<VueloDTO[]>([])

  // Config state
  const [fechaInicio, setFechaInicio] = useState('')
  const [horaInicio, setHoraInicio] = useState('')
  const algoritmo = 'ALNS'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fechaHoraActual, setFechaHoraActual] = useState('')

  // Modals
  const [selectedVuelo, setSelectedVuelo] = useState<VueloDTO | null>(null)
  const [selectedAeropuerto, setSelectedAeropuerto] = useState<AeropuertoDTO | null>(null)
  const [selectedEnvio, setSelectedEnvio] = useState<EnvioEstado | null>(null)
  const [selectedMaleta, setSelectedMaleta] = useState<MaletaEstado | null>(null)
  const [selectedEnvioRouteMode, setSelectedEnvioRouteMode] = useState<'actual' | 'anterior'>('actual')
  const [selectedMaletaRouteMode, setSelectedMaletaRouteMode] = useState<'actual' | 'anterior'>('actual')
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [isStoppingSimulation, setIsStoppingSimulation] = useState(false)
  const [mapTz, setMapTz] = useState(0)
  const [simInfoCollapsed, setSimInfoCollapsed] = useState(false)
  const [ocuCollapsed, setOcuCollapsed] = useState(false)
  const [vuelosCollapsed, setVuelosCollapsed] = useState(false)
  const [panelMode, setPanelMode] = useState<'envios' | 'maletas' | 'almacenes' | 'aviones'>('aviones')
  const [maletaEnvioFilterId, setMaletaEnvioFilterId] = useState<string | null>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(true)
  const [panelRendered, setPanelRendered] = useState(false)
  const [panelShown, setPanelShown] = useState(false)
  const [filteredFlightIds, setFilteredFlightIds] = useState<Set<string> | null>(null)
  const [filteredAirportIds, setFilteredAirportIds] = useState<Set<string> | null>(null)
  const filteredFlightSignatureRef = useRef('')
  const filteredAirportSignatureRef = useRef('')
  const sharedSimulationVersionRef = useRef<number | null>(null)
  const sharedContextSocketConnectedRef = useRef(false)

  const handleVueloClick = useCallback((v: VueloDTO) => {
    setSelectedVuelo((prev) => (prev?.id === v.id ? null : v))
    setSelectedAeropuerto(null)
    setSelectedEnvio(null)
    setSelectedMaleta(null)
    setMaletaEnvioFilterId(null)
    setSelectedEnvioRouteMode('actual')
    setSelectedMaletaRouteMode('actual')
    setPanelMode('aviones')
    setPanelCollapsed(false)
  }, [])

  const handleAeropuertoClick = useCallback((a: AeropuertoDTO) => {
    setSelectedAeropuerto((prev) => (prev?.codigoOACI === a.codigoOACI ? null : a))
    setSelectedVuelo(null)
    setSelectedEnvio(null)
    setSelectedMaleta(null)
    setMaletaEnvioFilterId(null)
    setSelectedEnvioRouteMode('actual')
    setSelectedMaletaRouteMode('actual')
    setPanelMode('almacenes')
    setPanelCollapsed(false)
  }, [])

  const handleEnvioSelect = useCallback((envio: EnvioEstado) => {
    setSelectedEnvio((prev) => {
      if (prev?.id === envio.id) {
        setSelectedVuelo(null)
        setSelectedAeropuerto(null)
        setSelectedMaleta(null)
        setMaletaEnvioFilterId(null)
        setSelectedEnvioRouteMode('actual')
        return null
      }

      setPanelMode('envios')
      setPanelCollapsed(false)
      setMaletaEnvioFilterId(null)
      setSelectedEnvioRouteMode('actual')
      setSelectedMaleta(null)
      setSelectedMaletaRouteMode('actual')
      const vueloId = envio.vueloActual || envio.vueloEsperado || envio.ultimoVuelo
      const vuelo = vueloId ? simulationState?.vuelos.find((v) => v.id === vueloId) : null
      if (vuelo) {
        setSelectedVuelo(vuelo)
        setSelectedAeropuerto(null)
      } else {
        const aeropuertosDisponibles = simulationState?.aeropuertos?.length ? simulationState.aeropuertos : aeropuertosEstaticos
        const aeropuerto = aeropuertosDisponibles.find((a) => a.codigoOACI === envio.aeropuertoActual)
        setSelectedVuelo(null)
        setSelectedAeropuerto(aeropuerto || null)
      }
      return envio
    })
  }, [aeropuertosEstaticos, simulationState?.aeropuertos, simulationState?.vuelos])

  const handleMaletaSelect = useCallback((maleta: MaletaEstado) => {
    setSelectedMaleta((prev) => {
      if (prev?.id === maleta.id) {
        setSelectedVuelo(null)
        setSelectedAeropuerto(null)
        setPanelMode('maletas')
        setPanelCollapsed(false)
        setSelectedMaletaRouteMode('actual')
        return null
      }

      setPanelMode('maletas')
      setPanelCollapsed(false)
      setSelectedEnvio(null)
      setSelectedEnvioRouteMode('actual')
      setSelectedMaletaRouteMode('actual')
      const vueloId = maleta.vueloActual || maleta.vueloEsperado || maleta.ultimoVuelo
      const vuelo = vueloId ? simulationState?.vuelos.find((v) => v.id === vueloId) : null
      if (vuelo) {
        setSelectedVuelo(vuelo)
        setSelectedAeropuerto(null)
      } else {
        const aeropuertosDisponibles = simulationState?.aeropuertos?.length ? simulationState.aeropuertos : aeropuertosEstaticos
        const aeropuerto = aeropuertosDisponibles.find((a) => a.codigoOACI === maleta.aeropuertoActual)
        setSelectedVuelo(null)
        setSelectedAeropuerto(aeropuerto || null)
      }
      return maleta
    })
  }, [aeropuertosEstaticos, simulationState?.aeropuertos, simulationState?.vuelos])

  const handleViewMaletasForEnvio = useCallback((envioId: string) => {
    setMaletaEnvioFilterId(envioId)
    setPanelMode('maletas')
    setPanelCollapsed(false)
  }, [])

  const handleMaletaSelectFromEnvio = useCallback((maleta: MaletaEstado) => {
    setMaletaEnvioFilterId(maleta.envioId)
    setPanelMode('maletas')
    setPanelCollapsed(false)
    handleMaletaSelect(maleta)
  }, [handleMaletaSelect])

  const clearSelectedEnvio = useCallback(() => {
    setSelectedEnvio(null)
    setSelectedMaleta(null)
    setSelectedVuelo(null)
    setSelectedAeropuerto(null)
    setMaletaEnvioFilterId(null)
    setSelectedEnvioRouteMode('actual')
    setSelectedMaletaRouteMode('actual')
  }, [])

  const clearSelectedMaleta = useCallback(() => {
    setSelectedMaleta(null)
    setSelectedVuelo(null)
    setSelectedAeropuerto(null)
    setSelectedMaletaRouteMode('actual')
  }, [])

  const handleIrAVueloDesdeEnvio = useCallback((vueloId: string) => {
    const vuelo = simulationState?.vuelos.find((v) => v.id === vueloId)
    if (vuelo) {
      setSelectedVuelo(vuelo)
      setSelectedEnvio(null)
      setSelectedMaleta(null)
      setSelectedEnvioRouteMode('actual')
      setSelectedMaletaRouteMode('actual')
      setPanelMode('aviones')
      setPanelCollapsed(false)
    }
  }, [simulationState])

  const handleVisibleFlightsChange = useCallback((ids: string[] | null) => {
    if (!ids) {
      if (filteredFlightSignatureRef.current === '') return
      filteredFlightSignatureRef.current = ''
      setFilteredFlightIds(null)
      return
    }
    const signature = ids.join('|')
    if (signature === filteredFlightSignatureRef.current) return
    filteredFlightSignatureRef.current = signature
    setFilteredFlightIds(new Set(ids))
  }, [])

  const handleVisibleAirportsChange = useCallback((codes: string[] | null) => {
    if (!codes) {
      if (filteredAirportSignatureRef.current === '') return
      filteredAirportSignatureRef.current = ''
      setFilteredAirportIds(null)
      return
    }
    const signature = codes.join('|')
    if (signature === filteredAirportSignatureRef.current) return
    filteredAirportSignatureRef.current = signature
    setFilteredAirportIds(new Set(codes))
  }, [])

  const handleAeropuertosContextoChanged = useCallback((aeropuertos: AeropuertoDTO[]) => {
    setAeropuertosEstaticos(aeropuertos.length > 0 ? aeropuertos : aeropuertosFallback)
  }, [])

  const handleFlightStatusChanged = useCallback((flightId: string, estado: 'CANCELADO' | 'PROGRAMADO') => {
    setSimulationState((current) => {
      if (!current) return current
      return {
        ...current,
        vuelos: current.vuelos.map((flight) => (
          flight.id === flightId ? { ...flight, estado } : flight
        )),
      }
    })
    setSelectedVuelo((current) => (
      current?.id === flightId ? { ...current, estado } : current
    ))
  }, [setSimulationState])

  const refreshSimulacionContextData = useCallback(async () => {
    const [aeropuertosData, vuelosData] = await Promise.all([
      cargaArchivosService.obtenerAeropuertos('SIMULACION'),
      cargaArchivosService.obtenerVuelos('SIMULACION'),
    ])
    setAeropuertosEstaticos(aeropuertosData.length > 0 ? aeropuertosData : aeropuertosFallback)
    setVuelosEstaticos(vuelosData)
  }, [])

  const refreshSimulationSharedVersion = useCallback(async () => {
    const sharedState = await cargaArchivosService.obtenerEstadoCompartido('SIMULACION')
    sharedSimulationVersionRef.current = sharedState.version
  }, [])

  const [showResultados, setShowResultados] = useState(false)
  const [resultSnapshot, setResultSnapshot] = useState<SimulationState | null>(null)
  const hasShownResults = useRef(false)
  const lastConsumedReportAtRef = useRef(0)
  const lockedReportSessionIdRef = useRef<string | null>(null)

  const hasSimulationStarted = Boolean(sessionId || simulationState)
  const hasSimulationFlightSnapshot = (simulationState?.vuelos?.length ?? 0) > 0

  const aeropuertos = useMemo(() => {
    const map = new Map<string, AeropuertoDTO>()

    simulationState?.aeropuertos?.forEach((a) => {
      map.set(a.codigoOACI, a)
    })

    aeropuertosEstaticos.forEach((a) => {
      const current = map.get(a.codigoOACI)
      if (!current) {
        map.set(a.codigoOACI, a)
        return
      }
      map.set(a.codigoOACI, {
        ...current,
        latitud: a.latitud,
        longitud: a.longitud,
        ciudad: a.ciudad ?? current.ciudad,
        pais: a.pais ?? current.pais,
        capacidadMaxima: a.capacidadMaxima,
        editable: a.editable ?? current.editable,
      })
    })

    return map.size > 0 ? Array.from(map.values()) : aeropuertosFallback
  }, [simulationState?.aeropuertos, aeropuertosEstaticos])

  useEffect(() => {
    if (!selectedAeropuerto) return
    const actualizado = aeropuertos.find((a) => a.codigoOACI === selectedAeropuerto.codigoOACI)
    if (actualizado && actualizado !== selectedAeropuerto) {
      setSelectedAeropuerto(actualizado)
    }
  }, [aeropuertos, selectedAeropuerto])

  const isCompleted = simulationState?.status === 'COMPLETADA' || (simulationState && simulationState.progreso >= 100)
  const isColapsada = simulationState?.status === 'COLAPSADA'
  const isError = simulationState?.status === 'ERROR'

  const saveConfigToStorage = (cfg: { fechaInicio: string; horaInicio: string }) => {
    sessionStorage.setItem(SIM_CONFIG_KEY, JSON.stringify(cfg))
  }

  const saveActiveConfigToStorage = (cfg: { sessionId: string; fechaInicio: string; horaInicio: string }) => {
    localStorage.setItem(SIM_ACTIVE_CONFIG_KEY, JSON.stringify(cfg))
  }

  const getActiveConfigFromStorage = (): { sessionId: string; fechaInicio: string; horaInicio: string } | null => {
    const saved = localStorage.getItem(SIM_ACTIVE_CONFIG_KEY)
    if (!saved) return null
    try {
      const cfg = JSON.parse(saved)
      if (!cfg?.sessionId || !cfg?.fechaInicio || !cfg?.horaInicio) return null
      return cfg
    } catch {
      return null
    }
  }

  const clearConfigStorage = () => {
    sessionStorage.removeItem(SIM_CONFIG_KEY)
  }

  const clearActiveConfigStorage = () => {
    localStorage.removeItem(SIM_ACTIVE_CONFIG_KEY)
  }

  const clearSimulationViewState = useCallback(() => {
    resetSimulation()
    setSessionId('')
    setIsPaused(false)
    resetElapsedTimer()
    clearConfigStorage()
    clearActiveConfigStorage()
  }, [resetElapsedTimer, resetSimulation, setIsPaused])

  const saveLastReportToStorage = useCallback((state: SimulationState) => {
    const payload = {
      sessionId: state.sessionId,
      savedAt: Date.now(),
    }
    try {
      localStorage.setItem(SIM_LAST_REPORT_KEY, JSON.stringify(payload))
    } catch {
      // Ignore storage quota issues; the backend remains the source of truth.
    }
    return payload
  }, [])

  const clearLastReportStorage = useCallback(() => {
    localStorage.removeItem(SIM_LAST_REPORT_KEY)
    lastConsumedReportAtRef.current = 0
    lockedReportSessionIdRef.current = null
  }, [])

  const getDismissedReportSessionId = useCallback((): string | null => {
    return localStorage.getItem(SIM_DISMISSED_REPORT_KEY)
  }, [])

  const clearDismissedReportSessionId = useCallback(() => {
    localStorage.removeItem(SIM_DISMISSED_REPORT_KEY)
  }, [])

  const dismissReportSession = useCallback((sessionId: string) => {
    localStorage.setItem(SIM_DISMISSED_REPORT_KEY, sessionId)
  }, [])

  const showReportSnapshot = useCallback((state: SimulationState, savedAt?: number) => {
    if (getDismissedReportSessionId() === state.sessionId) return
    if (lockedReportSessionIdRef.current === state.sessionId) return
    if (savedAt && savedAt <= lastConsumedReportAtRef.current) return
    if (savedAt) {
      lastConsumedReportAtRef.current = savedAt
    }
    lockedReportSessionIdRef.current = state.sessionId
    hasShownResults.current = true
    setResultSnapshot({ ...state })
    setShowResultados(true)
  }, [getDismissedReportSessionId])

  const tryConsumeStoredReport = useCallback(async (rawValue: string | null) => {
    if (activeSimulation?.activa || isRunning || sessionId) return false
    if (!rawValue) return false
    try {
      const parsed = JSON.parse(rawValue) as { sessionId?: string; savedAt?: number }
      if (!parsed.sessionId || !parsed.savedAt) return false
      if (parsed.savedAt <= lastConsumedReportAtRef.current) return true

      let state: SimulationState | null = null
      if (activeSimulation?.latestFinishedState?.sessionId === parsed.sessionId) {
        state = activeSimulation.latestFinishedState
      } else if (simulationState?.sessionId === parsed.sessionId
        && (simulationState.status === 'COMPLETADA' || simulationState.progreso >= 100)) {
        state = simulationState
      } else {
        try {
          const fetched = await simulationService.estado(parsed.sessionId)
          if (fetched.status === 'COMPLETADA' || fetched.progreso >= 100) {
            state = fetched
          }
        } catch {
          return false
        }
      }

      if (!state) return false
      if (getDismissedReportSessionId() === state.sessionId) return true
      showReportSnapshot(state, parsed.savedAt)
      return true
    } catch {
      return false
    }
  }, [
    activeSimulation?.activa,
    activeSimulation?.latestFinishedState,
    getDismissedReportSessionId,
    isRunning,
    sessionId,
    showReportSnapshot,
    simulationState,
  ])

  // Restore config from sessionStorage on mount
  useEffect(() => {
    refreshSimulacionContextData().catch(() => {})
    refreshSimulationSharedVersion().catch(() => {})

    const saved = sessionStorage.getItem(SIM_CONFIG_KEY)
    if (saved) {
      try {
        const cfg = JSON.parse(saved)
        if (cfg.fechaInicio) setFechaInicio(cfg.fechaInicio)
        if (cfg.horaInicio) setHoraInicio(cfg.horaInicio)
      } catch {
        // ignore parse errors
      }
    }
  }, [refreshSimulacionContextData, refreshSimulationSharedVersion])

  useEffect(() => {
    const disconnect = simulationSocketService.connectContext('SIMULACION', {
      onOpen: () => {
        sharedContextSocketConnectedRef.current = true
      },
      onMessage: (sharedState) => {
        sharedContextSocketConnectedRef.current = true
        if (!hasSharedVersionChanged(sharedSimulationVersionRef.current, sharedState.version)) return
        sharedSimulationVersionRef.current = sharedState.version
        void refreshSimulacionContextData()
      },
      onClose: () => {
        sharedContextSocketConnectedRef.current = false
      },
      onError: () => {
        sharedContextSocketConnectedRef.current = false
      },
    })

    return () => {
      disconnect()
      sharedContextSocketConnectedRef.current = false
    }
  }, [refreshSimulacionContextData])

  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const pollSharedSimulationContext = async () => {
      try {
        if (sharedContextSocketConnectedRef.current) return
        if (activeSimulation?.activa) return
        const sharedState = await cargaArchivosService.obtenerEstadoCompartido('SIMULACION')
        if (cancelled) return
        if (!hasSharedVersionChanged(sharedSimulationVersionRef.current, sharedState.version)) return
        sharedSimulationVersionRef.current = sharedState.version
        await refreshSimulacionContextData()
      } catch {
        // ignore polling errors to keep the current shared snapshot on screen
      }
    }

    const scheduleNextPoll = () => {
      if (cancelled) return
      timeoutId = window.setTimeout(async () => {
        await pollSharedSimulationContext()
        scheduleNextPoll()
      }, SHARED_SIMULATION_CONTEXT_POLL_MS)
    }

    void pollSharedSimulationContext().finally(() => {
      scheduleNextPoll()
    })

    return () => {
      cancelled = true
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [activeSimulation?.activa, refreshSimulacionContextData])

  // Detectar simulación activa al montar (permite ver simulación en otros clientes)
  useEffect(() => {
    let cancelled = false
    const syncFromActiveSimulation = async () => {
      if (cancelled) return
      if (activeSimulation?.activa && activeSimulation.sessionId) {
        setSessionId(activeSimulation.sessionId)
        if (
          !isRunning
          || sessionId !== activeSimulation.sessionId
          || simulationState?.sessionId !== activeSimulation.sessionId
        ) {
          startPolling(
            activeSimulation.sessionId,
            undefined,
            activeSimulation.startedAt,
            activeSimulation.elapsedRealtimeSeconds,
          )
        }
        if (activeSimulation.simulationStartedAt) {
          const parts = activeSimulation.simulationStartedAt.split('T')
          if (parts.length === 2) {
            setFechaInicio(parts[0])
            setHoraInicio(parts[1].substring(0, 5))
          }
        } else if (activeSimulation.fechaInicio) {
          const parts = activeSimulation.fechaInicio.split('T')
          if (parts.length === 2) {
            setFechaInicio(parts[0])
            setHoraInicio(parts[1].substring(0, 5))
          }
        } else {
          const activeCfg = getActiveConfigFromStorage()
          if (activeCfg?.sessionId === activeSimulation.sessionId) {
            setFechaInicio(activeCfg.fechaInicio)
            setHoraInicio(activeCfg.horaInicio)
          }
        }
      } else if (sessionId && !isCompleted && !isColapsada && !isError) {
        try {
          const latestState = await simulationService.estado(sessionId)
          if (cancelled) return

          const finished =
            latestState.status === 'COMPLETADA'
            || latestState.status === 'COLAPSADA'
            || latestState.status === 'ERROR'
            || latestState.progreso >= 100

          if (finished) {
            setSimulationState(latestState)
            return
          }
        } catch {
          // If the session is no longer available, fall through and clear the local state.
        }

        resetSimulation()
        setSessionId('')
      }
    }
    void syncFromActiveSimulation()
    return () => { cancelled = true }
  }, [activeSimulation, isRunning, sessionId, simulationState?.sessionId, startPolling, resetSimulation, isCompleted, isColapsada, isError, setSimulationState])

  useEffect(() => {
    const syncWhenVisible = () => {
      if (document.visibilityState !== 'visible') return
      void refreshActiveSimulation()
      void tryConsumeStoredReport(localStorage.getItem(SIM_LAST_REPORT_KEY))
    }

    const syncWhenFocused = () => {
      void refreshActiveSimulation()
      void tryConsumeStoredReport(localStorage.getItem(SIM_LAST_REPORT_KEY))
    }

    document.addEventListener('visibilitychange', syncWhenVisible)
    window.addEventListener('focus', syncWhenFocused)

    return () => {
      document.removeEventListener('visibilitychange', syncWhenVisible)
      window.removeEventListener('focus', syncWhenFocused)
    }
  }, [refreshActiveSimulation, tryConsumeStoredReport])

  useEffect(() => {
    let cancelled = false
    const latestFinishedState = activeSimulation?.latestFinishedState
    if (activeSimulation?.activa) return
    if (!latestFinishedState) return
    if (!isFinishedSimulationState(latestFinishedState)) return

    const showAuthoritativeReport = async () => {
      let authoritativeState = latestFinishedState
      try {
        const fetchedState = await simulationService.estado(latestFinishedState.sessionId)
        if (!cancelled && isFinishedSimulationState(fetchedState)) {
          authoritativeState = fetchedState
        }
      } catch {
        // Fall back to the latest finished state announced by the backend active channel.
      }

      if (cancelled) return
      const reportPayload = saveLastReportToStorage(authoritativeState)
      showReportSnapshot(authoritativeState, reportPayload.savedAt)
    }

    void showAuthoritativeReport()
    if (!activeSimulation?.activa) {
      clearSimulationViewState()
      void refreshSimulacionContextData()
    }

    return () => {
      cancelled = true
    }
  }, [
    activeSimulation?.activa,
    activeSimulation?.latestFinishedState,
    clearSimulationViewState,
    refreshSimulacionContextData,
    saveLastReportToStorage,
    showReportSnapshot,
  ])

  useEffect(() => {
    if (!isFinishedSimulationState(simulationState)) return

    const reportPayload = saveLastReportToStorage(simulationState)
    showReportSnapshot(simulationState, reportPayload.savedAt)
  }, [saveLastReportToStorage, showReportSnapshot, simulationState])

  // Sincronización local entre pestañas del mismo navegador.
  // El backend sigue siendo la fuente de verdad para estado compartido real.
  useEffect(() => {
    const unlisten = listenSimMessages((msg) => {
      if (msg.type === 'STARTED') {
        clearLastReportStorage()
        void refreshActiveSimulation()
      }
      if (msg.type === 'STOPPED') {
        void refreshActiveSimulation()
        void tryConsumeStoredReport(localStorage.getItem(SIM_LAST_REPORT_KEY))
      }
    })

    return () => {
      unlisten()
    }
  }, [clearLastReportStorage, refreshActiveSimulation, tryConsumeStoredReport])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SIM_LAST_REPORT_KEY) {
        void tryConsumeStoredReport(event.newValue)
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [tryConsumeStoredReport])

  const vuelos = useMemo(() => {
    if (!hasSimulationFlightSnapshot) return EMPTY_FLIGHTS

    const combinados = new Map<string, VueloDTO>()
    simulationState?.vuelos?.forEach((vuelo) => {
      combinados.set(vuelo.id, vuelo)
    })
    vuelosEstaticos.forEach((vuelo) => {
      const current = combinados.get(vuelo.id)
      if (!current) return
      combinados.set(vuelo.id, {
        ...current,
        latOrigen: vuelo.latOrigen,
        lonOrigen: vuelo.lonOrigen,
        latDestino: vuelo.latDestino,
        lonDestino: vuelo.lonDestino,
        capacidad: vuelo.capacidad,
        programacionId: vuelo.programacionId ?? current.programacionId,
        editable: vuelo.editable ?? current.editable,
        recurrente: vuelo.recurrente ?? current.recurrente,
        estado: vuelo.estado === 'CANCELADO' ? 'CANCELADO' : current.estado,
      })
    })
    return Array.from(combinados.values())
  }, [hasSimulationFlightSnapshot, simulationState?.vuelos, vuelosEstaticos])

  // Keep selected flight info synced with latest poll data
  useEffect(() => {
    if (!selectedVuelo) return
    const updated = vuelos.find((v) => v.id === selectedVuelo.id)
    if (updated) {
      setSelectedVuelo(updated)
    } else if (simulationState?.status === 'COMPLETADA') {
      setSelectedVuelo((prev) => (prev ? { ...prev, progresoVuelo: 100 } : prev))
    }
  }, [vuelos, simulationState?.status, selectedVuelo])

  // (eliminado: beforeunload ya no detiene la simulación, para permitir multi-pestaña)
  function formatElapsed(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  function formatCurrentDateTime(date: Date): string {
    const d = date.getDate().toString().padStart(2, '0')
    const mo = (date.getMonth() + 1).toString().padStart(2, '0')
    const y = date.getFullYear()
    const h = date.getHours().toString().padStart(2, '0')
    const min = date.getMinutes().toString().padStart(2, '0')
    return `${d}/${mo}/${y} ${h}:${min}`
  }

  // Reloj actual a nivel de minuto
  useEffect(() => {
    const tick = () => setFechaHoraActual(formatCurrentDateTime(new Date()))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [])

  const simulatedElapsedSeconds = useMemo(() => {
    if (!simulationState?.simulationTime || !fechaInicio || !horaInicio) return 0
    const simulationNowMs = Date.parse(`${simulationState.simulationTime}Z`)
    const simulationStartMs = Date.parse(`${fechaInicio}T${horaInicio}:00Z`)
    if (Number.isNaN(simulationNowMs) || Number.isNaN(simulationStartMs)) return 0
    return Math.max(0, Math.floor((simulationNowMs - simulationStartMs) / 1000))
  }, [simulationState?.simulationTime, fechaInicio, horaInicio])

  const handleIniciar = async () => {
    if (!fechaInicio || !horaInicio) {
      setError('Complete todos los campos')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const state = await simulationService.iniciar({
        duracionDias: DURACION_FIJA,
        fechaInicio,
        horaInicio,
        algoritmo,
        velocidad: 1,
      })
      if (state.status === 'ERROR') {
        setError(state.logs?.[0]?.mensaje || 'Error al iniciar simulación')
        setLoading(false)
        return
      }
      saveConfigToStorage({ fechaInicio, horaInicio })
      saveActiveConfigToStorage({ sessionId: state.sessionId, fechaInicio, horaInicio })
      clearLastReportStorage()
      clearDismissedReportSessionId()
      hasShownResults.current = false
      setResultSnapshot(null)
      setShowResultados(false)
      setSessionId(state.sessionId)
      startPolling(state.sessionId, undefined, state.startedAt, state.elapsedRealtimeSeconds)
      await refreshActiveSimulation()
      broadcastSimMessage('STARTED', {
        sessionId: state.sessionId,
        startedAt: state.startedAt,
        elapsedRealtimeSeconds: state.elapsedRealtimeSeconds,
      })
    } catch (err: any) {
      const msg = err?.response?.data?.logs?.[0]?.mensaje
        || err?.response?.data?.message
        || err?.message
        || 'Error al iniciar la simulación'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (showResultados || resultSnapshot) return
    if (!activeSimulation?.activa && !isRunning && !sessionId) return
    setShowResultados(false)
    setResultSnapshot(null)
    hasShownResults.current = false
  }, [activeSimulation?.activa, isRunning, resultSnapshot, sessionId, showResultados])

  const handleDetenerConfirmado = async () => {
    if (!sessionId || isStoppingSimulation) return
    const stoppingSessionId = sessionId
    setIsStoppingSimulation(true)
    setShowStopConfirm(false)
    let stoppedState: SimulationState | null = null
    try {
      stoppedState = await simulationService.detener(stoppingSessionId)
    } catch {
      try {
        const recoveredState = await simulationService.estado(stoppingSessionId)
        if (isFinishedSimulationState(recoveredState)) {
          stoppedState = recoveredState
        }
      } catch {
        // ignore
      }
    }
    try {
      clearDismissedReportSessionId()
      clearSimulationViewState()
      broadcastSimMessage('STOPPED', { sessionId: stoppingSessionId })
      await refreshActiveSimulation()

      if (!isFinishedSimulationState(stoppedState)) {
        try {
          const recoveredState = await simulationService.estado(stoppingSessionId)
          if (isFinishedSimulationState(recoveredState)) {
            stoppedState = recoveredState
          }
        } catch {
          // ignore
        }
      }

      if (isFinishedSimulationState(stoppedState)) {
        const reportPayload = saveLastReportToStorage(stoppedState)
        showReportSnapshot(stoppedState, reportPayload.savedAt)
      } else {
        await tryConsumeStoredReport(localStorage.getItem(SIM_LAST_REPORT_KEY))
      }
    } finally {
      setIsStoppingSimulation(false)
    }
  }

  const handleNuevaSimulacion = () => {
    clearSimulationViewState()
    clearLastReportStorage()
    hasShownResults.current = false
    setResultSnapshot(null)
    setShowResultados(false)
    refreshSimulacionContextData().catch(() => {})
    void refreshActiveSimulation()
  }

  const showActionButton = sessionId && !isColapsada && !isError
  const simulationProgress = simulationState?.progreso ?? 0
  const scenarioDateTime = fechaInicio && horaInicio ? `${fechaInicio.split('-').reverse().join('/')} ${horaInicio}` : 'Sin definir'

  useEffect(() => {
    if (!panelCollapsed) {
      setPanelRendered(true)
      const frameId = window.requestAnimationFrame(() => setPanelShown(true))
      return () => window.cancelAnimationFrame(frameId)
    }
    setPanelShown(false)
    const timeoutId = window.setTimeout(() => setPanelRendered(false), 180)
    return () => window.clearTimeout(timeoutId)
  }, [panelCollapsed])

  const idleAirports = useMemo(
    () => aeropuertosFallback.map((airport) => ({
      ...airport,
      ocupacionActual: 0,
      vuelosEntrantes: [],
      vuelosSalientes: [],
      vuelosCanceladosSalientes: [],
    })),
    [],
  )

  const displayAirports = hasSimulationStarted ? aeropuertos : idleAirports
  const displayFlights = hasSimulationStarted ? vuelos : EMPTY_FLIGHTS
  const enviosActivos = hasSimulationStarted ? (simulationState?.envios || []) : []
  const maletasActivas = hasSimulationStarted ? (simulationState?.maletas || []) : []

  const rawSimulationFlights = hasSimulationStarted ? (simulationState?.vuelos ?? EMPTY_FLIGHTS) : EMPTY_FLIGHTS
  const rawSimulationAirports = hasSimulationStarted ? (simulationState?.aeropuertos ?? EMPTY_AIRPORTS) : EMPTY_AIRPORTS

  const flightStats = useMemo(() => rawSimulationFlights.reduce((stats, vuelo) => {
    if (vuelo.estado === 'ACTIVO' && vuelo.cargaActual <= 0) stats.vaciosEnTransito++
    return stats
  }, { vaciosEnTransito: 0 }), [rawSimulationFlights])

  const vuelosCulminados = simulationState?.vuelosCulminados ?? 0
  const vuelosEnTransitoCount = simulationState?.vuelosEnTransito ?? 0
  const vuelosCancelados = simulationState?.vuelosCancelados ?? 0
  const vuelosVaciosEnTransito = flightStats.vaciosEnTransito
  const vuelosVaciosEnTransitoPct = vuelosEnTransitoCount > 0
    ? ((vuelosVaciosEnTransito / vuelosEnTransitoCount) * 100).toFixed(2)
    : '0.00'

  const occupancy = useMemo(() => {
    const flota = rawSimulationFlights.reduce((acc, v) => ({
      carga: acc.carga + v.cargaActual,
      capacidad: acc.capacidad + v.capacidad,
    }), { carga: 0, capacidad: 0 })
    const aeropuertosOcu = rawSimulationAirports.reduce((acc, a) => ({
      ocupacion: acc.ocupacion + a.ocupacionActual,
      capacidad: acc.capacidad + a.capacidadMaxima,
    }), { ocupacion: 0, capacidad: 0 })
    return { flota, aeropuertos: aeropuertosOcu }
  }, [rawSimulationFlights, rawSimulationAirports])

  function ocupColor(ratio: number): string {
    if (ratio <= 0) return 'bg-sky-500'
    if (ratio <= 0.7) return 'bg-emerald-500'
    if (ratio <= 0.9) return 'bg-amber-500'
    return 'bg-red-500'
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Mapa + Panel lateral (como OperacionDiaria) */}
      <div className="flex gap-2 flex-1 min-h-0">
        <div className="relative flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <MapaAeropuertos
            aeropuertos={displayAirports}
            vuelos={displayFlights}
            selectedVueloId={selectedVuelo?.id || null}
            selectedAeropuertoId={selectedAeropuerto?.codigoOACI || null}
            selectedEnvio={selectedMaleta ?? selectedEnvio}
            selectedEnvioRouteMode={selectedMaleta ? selectedMaletaRouteMode : selectedEnvioRouteMode}
            velocidad={1}
            onAeropuertoClick={handleAeropuertoClick}
            onVueloClick={handleVueloClick}
            mapTz={mapTz}
            onMapTzChange={setMapTz}
            simulationMode={true}
            simulationTime={simulationState?.simulationTime ?? null}
            filteredFlightIds={hasSimulationStarted && (panelMode === 'aviones' || panelMode === 'envios') && !panelCollapsed ? filteredFlightIds : null}
            filteredAirportIds={panelMode === 'almacenes' && !panelCollapsed ? filteredAirportIds : null}
          />

          <div className="absolute left-3 top-3 z-[1001] w-[min(22rem,calc(100%-1.5rem))] rounded-xl border border-gray-600/55 bg-gray-900/70 shadow-lg shadow-black/20 backdrop-blur-[3px]">
            <button
              type="button"
              onClick={() => setSimInfoCollapsed((value) => !value)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left cursor-pointer"
            >
              <div className="min-w-0">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200">Simulacion</h4>
                <p className="truncate text-[11px] text-gray-300">{fechaHoraActual}</p>
              </div>
              <span className={`shrink-0 text-xs text-gray-400 transition-transform ${simInfoCollapsed ? '' : 'rotate-180'}`}>v</span>
            </button>

            {simInfoCollapsed && simulationState && (
              <div className="flex items-center gap-2 px-3 pb-3">
                <span className="font-mono text-xs font-semibold text-white shrink-0">Dia {Math.min(DURACION_FIJA, Math.floor(simulatedElapsedSeconds / 86400) + 1)}/{DURACION_FIJA}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-800">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${simulationProgress}%` }} />
                </div>
                <span className="w-10 text-right font-mono text-xs font-bold text-white shrink-0">{simulationProgress}%</span>
              </div>
            )}

            {(!simInfoCollapsed || !simulationState) && (
              <div className="space-y-2 px-3 pb-3">
                {!simulationState ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                        Fecha
                        <input
                          type="date"
                          value={fechaInicio}
                          onChange={(e) => setFechaInicio(e.target.value)}
                          disabled={loading}
                          className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-800/90 px-2 py-1.5 text-xs text-gray-100 transition-colors hover:bg-gray-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                        />
                      </label>
                      <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                        Hora
                        <input
                          type="time"
                          value={horaInicio}
                          onChange={(e) => setHoraInicio(e.target.value)}
                          disabled={loading}
                          className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-800/90 px-2 py-1.5 text-xs text-gray-100 transition-colors hover:bg-gray-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                        />
                      </label>
                    </div>
                    {error && <p className="text-xs font-medium text-red-400">{error}</p>}
                    {loading && (
                      <div className="rounded-lg border border-sky-800/70 bg-sky-950/35 px-3 py-2 text-[11px] text-sky-200">
                        Preparando la simulación inicial y calculando el primer estado...
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleIniciar}
                      disabled={loading}
                      className="w-full rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-wait disabled:bg-sky-900"
                    >
                      {loading ? 'Iniciando simulación...' : 'Iniciar'}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg border border-gray-700/55 bg-gray-950/65 px-2.5 py-2">
                        <span className="block text-[9px] uppercase tracking-wide text-gray-500">Inicio</span>
                        <span className="font-mono font-semibold text-gray-100">{scenarioDateTime}</span>
                      </div>
                      <div className="rounded-lg border border-gray-700/55 bg-gray-950/65 px-2.5 py-2">
                        <span className="block text-[9px] uppercase tracking-wide text-gray-500">Fecha Simulacion</span>
                        <span className="font-mono font-semibold text-gray-100">{formatDateTime(simulationState.simulationTime)}</span>
                      </div>
                      <div className="rounded-lg border border-gray-700/55 bg-gray-950/65 px-2.5 py-2">
                        <span className="block text-[9px] uppercase tracking-wide text-gray-500">Simulado Transcurrido</span>
                        <span className="font-mono font-semibold text-gray-100">{formatElapsed(simulatedElapsedSeconds)}</span>
                      </div>
                      <div className="rounded-lg border border-gray-700/55 bg-gray-950/65 px-2.5 py-2">
<span className="block text-[9px] uppercase tracking-wide text-gray-500">Real Transcurrido</span>
                        <span className="font-mono font-semibold text-gray-100">{formatElapsed(elapsedRealSeconds)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-white">Dia {Math.min(DURACION_FIJA, Math.floor(simulatedElapsedSeconds / 86400) + 1)}/{DURACION_FIJA}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-800">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${simulationProgress}%` }} />
                      </div>
                      <span className="w-10 text-right font-mono text-xs font-bold text-white">{simulationProgress}%</span>
                    </div>
                    {showActionButton && !isCompleted && (
                      <button
                        type="button"
                        onClick={() => setShowStopConfirm(true)}
                        disabled={isStoppingSimulation}
                        className="w-full rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-wait disabled:bg-red-800"
                      >
                        {isStoppingSimulation ? 'Generando reporte...' : 'Detener'}
                      </button>
                    )}
                    {isCompleted && (
                      <button
                        type="button"
                        onClick={handleNuevaSimulacion}
                        className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
                      >
                        Nueva Simulacion
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Indicadores flotantes - inferior izquierda */}
          <div className="absolute bottom-3 left-3 z-[999] flex flex-col gap-1.5">
            <div className="min-w-[238px] bg-gray-900/50 border border-gray-600/45 rounded-xl backdrop-blur-[2px] shadow-md shadow-black/15">
              <button onClick={() => setOcuCollapsed((v) => !v)} className="flex w-full items-center justify-between gap-2 p-2.5 cursor-pointer">
                <h4 className="text-[13px] font-semibold text-gray-300">Ocupación Global</h4>
                <span className={`text-gray-500 text-xs transition-transform ${ocuCollapsed ? '' : 'rotate-180'}`}>▼</span>
              </button>
              {!ocuCollapsed && (
                <div className="grid grid-cols-1 gap-1.5 px-2.5 pb-2.5">
                  <div className="rounded-lg border border-gray-600/55 bg-gray-950/65 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Flota</span>
                      <span className="text-base font-bold text-white">{occupancy.flota.capacidad > 0 ? (occupancy.flota.carga / occupancy.flota.capacidad * 100).toFixed(2) : '0.00'}%</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-gray-100">{occupancy.flota.carga.toLocaleString('fr-FR')}/{occupancy.flota.capacidad.toLocaleString('fr-FR')}</span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${ocupColor(occupancy.flota.capacidad > 0 ? occupancy.flota.carga / occupancy.flota.capacidad : 0)}`} />
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                      <div className={`h-full rounded-full transition-all ${ocupColor(occupancy.flota.capacidad > 0 ? occupancy.flota.carga / occupancy.flota.capacidad : 0)}`} style={{ width: `${Math.min(occupancy.flota.capacidad > 0 ? occupancy.flota.carga / occupancy.flota.capacidad * 100 : 0, 100)}%` }} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-600/55 bg-gray-950/65 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Aeropuertos</span>
                      <span className="text-base font-bold text-white">{occupancy.aeropuertos.capacidad > 0 ? (occupancy.aeropuertos.ocupacion / occupancy.aeropuertos.capacidad * 100).toFixed(2) : '0.00'}%</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-gray-100">{occupancy.aeropuertos.ocupacion.toLocaleString('fr-FR')}/{occupancy.aeropuertos.capacidad.toLocaleString('fr-FR')}</span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${ocupColor(occupancy.aeropuertos.capacidad > 0 ? occupancy.aeropuertos.ocupacion / occupancy.aeropuertos.capacidad : 0)}`} />
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                      <div className={`h-full rounded-full transition-all ${ocupColor(occupancy.aeropuertos.capacidad > 0 ? occupancy.aeropuertos.ocupacion / occupancy.aeropuertos.capacidad : 0)}`} style={{ width: `${Math.min(occupancy.aeropuertos.capacidad > 0 ? occupancy.aeropuertos.ocupacion / occupancy.aeropuertos.capacidad * 100 : 0, 100)}%` }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="min-w-[210px] bg-gray-900/38 border border-gray-700/38 rounded-xl backdrop-blur-[2px]">
              <button onClick={() => setVuelosCollapsed((v) => !v)} className="flex w-full items-center justify-between gap-2 p-2.5 cursor-pointer">
                <h4 className="text-[13px] font-semibold text-gray-300">Estado de Vuelos</h4>
                <span className={`text-gray-500 text-xs transition-transform ${vuelosCollapsed ? '' : 'rotate-180'}`}>▼</span>
              </button>
              {!vuelosCollapsed && (
                <div className="grid grid-cols-1 gap-1.5 px-2.5 pb-2.5">
                  <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-violet-300">En vuelo</span>
                    <div className="mt-0.5 text-sm font-bold text-gray-100">{vuelosEnTransitoCount}</div>
                  </div>
                  <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-violet-300">Vacíos en vuelo</span>
                      <span className="text-xs font-bold text-gray-100">{vuelosVaciosEnTransitoPct}%</span>
                    </div>
                    <div className="mt-0.5 text-xs font-mono text-gray-200">{vuelosVaciosEnTransito}/{vuelosEnTransitoCount}</div>
                  </div>
                  <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-violet-300">Culminados</span>
                    <div className="mt-0.5 text-sm font-bold text-gray-100">{vuelosCulminados}</div>
                  </div>
                  <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-violet-300">Cancelados</span>
                    <div className="mt-0.5 text-sm font-bold text-gray-100">{vuelosCancelados}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {panelCollapsed && (
            <button
              onClick={() => setPanelCollapsed(false)}
              className="absolute top-4 right-4 z-[1001] bg-gray-800/95 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white hover:bg-gray-700 transition-colors cursor-pointer shadow-lg"
            >
              ▶ Panel
            </button>
          )}

        </div>

        {panelRendered && (
        <div
          className={`flex flex-col gap-2 transition-[transform,opacity] duration-200 ease-out will-change-transform ${
            panelShown ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex bg-gray-900/95 border border-gray-700/80 rounded-lg overflow-hidden">
            <button
              onClick={() => setPanelMode('envios')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                panelMode === 'envios'
                  ? 'bg-sky-600 text-white'
                  : 'text-violet-300 hover:text-violet-100 bg-gray-800'
              }`}
            >
              📦 Envíos
            </button>
            <button
              onClick={() => setPanelMode('maletas')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                panelMode === 'maletas'
                  ? 'bg-sky-600 text-white'
                  : 'text-violet-300 hover:text-violet-100 bg-gray-800'
              }`}
            >
              🧳 Maletas
            </button>
            <button
              onClick={() => setPanelMode('almacenes')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                panelMode === 'almacenes'
                  ? 'bg-sky-600 text-white'
                  : 'text-violet-300 hover:text-violet-100 bg-gray-800'
              }`}
            >
              🏢 Almacenes
            </button>
            <button
              onClick={() => setPanelMode('aviones')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                panelMode === 'aviones'
                  ? 'bg-sky-600 text-white'
                  : 'text-violet-300 hover:text-violet-100 bg-gray-800'
              }`}
            >
              ✈️ Aviones
            </button>
            <button
              onClick={() => setPanelCollapsed(true)}
              className="px-2 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors cursor-pointer"
              title="Contraer panel"
            >
              ◀
            </button>
          </div>
          {panelMode === 'almacenes' ? (
            <AlmacenListPanel
              aeropuertos={displayAirports}
              vuelos={displayFlights}
              envios={enviosActivos}
              onEnvioSelect={handleEnvioSelect}
              selectedEnvioId={selectedEnvio?.id}
              onAlmacenSelect={handleAeropuertoClick}
              selectedAlmacenId={selectedAeropuerto?.codigoOACI}
              selectedAlmacen={selectedAeropuerto}
              onVueloSelect={handleVueloClick}
              contexto="SIMULACION"
              onDataChanged={handleAeropuertosContextoChanged}
              onVisibleAirportsChange={handleVisibleAirportsChange}
              tzOffset={mapTz}
              onSelectedAlmacenClear={() => setSelectedAeropuerto(null)}
            />
          ) : panelMode === 'aviones' ? (
            <VueloListPanel
              vuelos={displayFlights}
              contexto="SIMULACION"
              aeropuertosDisponibles={displayAirports}
              envios={enviosActivos}
              onEnvioSelect={handleEnvioSelect}
              selectedEnvioId={selectedEnvio?.id}
              onVueloSelect={handleVueloClick}
              selectedVueloId={selectedVuelo?.id}
              selectedVuelo={selectedVuelo}
              includeCompleted
              includeProgrammed
              onVisibleFlightsChange={handleVisibleFlightsChange}
              onDataChanged={refreshSimulacionContextData}
              onFlightStatusChanged={handleFlightStatusChanged}
              simulationSessionId={sessionId || null}
              tzOffset={mapTz}
              onSelectedVueloClear={() => setSelectedVuelo(null)}
            />
          ) : panelMode === 'maletas' ? (
            <MaletaListPanel
              onMaletaSelect={handleMaletaSelect}
              selectedMaletaId={selectedMaleta?.id}
              selectedMaleta={selectedMaleta}
              selectedMaletaRouteMode={selectedMaletaRouteMode}
              onSelectedMaletaRouteModeChange={setSelectedMaletaRouteMode}
              onClearSelectedMaleta={clearSelectedMaleta}
              maletasExternas={maletasActivas}
              currentTime={simulationState?.simulationTime}
              filterEnvioId={maletaEnvioFilterId}
              onClearEnvioFilter={() => setMaletaEnvioFilterId(null)}
              onIrAVuelo={handleIrAVueloDesdeEnvio}
            />
          ) : (
            <EnvioListPanel
              onEnvioSelect={handleEnvioSelect}
              selectedEnvioId={selectedEnvio?.id}
              selectedEnvio={selectedEnvio}
              selectedEnvioRouteMode={selectedEnvioRouteMode}
              onSelectedEnvioRouteModeChange={setSelectedEnvioRouteMode}
              onClearSelectedEnvio={clearSelectedEnvio}
              enviosExternos={enviosActivos}
              currentTime={simulationState?.simulationTime}
              onVisibleFlightsChange={handleVisibleFlightsChange}
              onViewMaletasForEnvio={handleViewMaletasForEnvio}
              onIrAVuelo={handleIrAVueloDesdeEnvio}
              maletasExternas={maletasActivas}
              selectedMaletaId={selectedMaleta?.id}
              onMaletaSelect={handleMaletaSelectFromEnvio}
            />
          )}
        </div>
        )}
      </div>

  <ResultadosModal
        state={resultSnapshot ?? simulationState}
        isOpen={showResultados}
        onClose={() => {
          if (resultSnapshot?.sessionId) {
            dismissReportSession(resultSnapshot.sessionId)
          }
          setShowResultados(false)
          setResultSnapshot(null)
          handleNuevaSimulacion()
        }}
      />

      {isStoppingSimulation && (
        <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/65 px-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-950 p-6 shadow-2xl">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-sky-500/25 border-t-sky-400" />
              <div>
                <h3 className="text-base font-semibold text-gray-100">Deteniendo simulación</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Estamos cerrando la ejecución y generando el reporte final.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && !simulationState && (
        <div className="fixed inset-0 z-[2050] flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-950 p-6 shadow-2xl">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-sky-500/25 border-t-sky-400" />
              <div>
                <h3 className="text-base font-semibold text-gray-100">Iniciando simulación</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Estamos cargando los datos y generando la planificación inicial.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmación detener */}
      {showStopConfirm && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-100 mb-2">Detener simulación</h3>
            <p className="text-gray-300 text-sm mb-6">¿Estás seguro de detener la simulación?</p>
            <div className="flex gap-3">
              <button
                onClick={handleDetenerConfirmado}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                Sí, detener
              </button>
              <button
                onClick={() => setShowStopConfirm(false)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
