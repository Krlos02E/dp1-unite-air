import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSimulation } from '../context/SimulationContext'
import { simulationService } from '../services/SimulationService'
import { cargaArchivosService } from '../services/CargaArchivosService'
import MapaAeropuertos from '../components/MapaAeropuertos'
import EnvioListPanel from '../components/EnvioListPanel'
import MaletaListPanel from '../components/MaletaListPanel'
import AlmacenListPanel from '../components/AlmacenListPanel'
import VueloListPanel from '../components/VueloListPanel'
import ResultadosModal from '../components/ResultadosModal'
import { formatDateTime } from '../utils/dateFormat'
import { AIRPORTS_DATA } from '../data/airportsData'
import type { VueloDTO, AeropuertoDTO, SimulationState, EnvioEstado, MaletaEstado } from '../types'
import { shouldDisplayFlight } from '../utils/flightVisibility'

const SIM_CONFIG_KEY = 'uniteair_simConfig'
const SIM_STOPPED_KEY = 'uniteair_simStopped'
const DURACION_FIJA = 5
const EMPTY_FLIGHTS: VueloDTO[] = []

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
    startPolling,
    resetSimulation,
    elapsedRealSeconds,
    setIsPaused,
    setSimulationState,
    resetElapsedTimer,
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

  // Modals
  const [selectedVuelo, setSelectedVuelo] = useState<VueloDTO | null>(null)
  const [selectedAeropuerto, setSelectedAeropuerto] = useState<AeropuertoDTO | null>(null)
  const [selectedEnvio, setSelectedEnvio] = useState<EnvioEstado | null>(null)
  const [selectedMaleta, setSelectedMaleta] = useState<MaletaEstado | null>(null)
  const [selectedEnvioRouteMode, setSelectedEnvioRouteMode] = useState<'actual' | 'anterior'>('actual')
  const [selectedMaletaRouteMode, setSelectedMaletaRouteMode] = useState<'actual' | 'anterior'>('actual')
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [mapTz, setMapTz] = useState(0)
  const [panelMode, setPanelMode] = useState<'envios' | 'maletas' | 'almacenes' | 'aviones'>('aviones')
  const [maletaEnvioFilterId, setMaletaEnvioFilterId] = useState<string | null>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(true)
  const [panelRendered, setPanelRendered] = useState(false)
  const [panelShown, setPanelShown] = useState(false)
  const [filteredFlightIds, setFilteredFlightIds] = useState<Set<string> | null>(null)
  const [filteredAirportIds, setFilteredAirportIds] = useState<Set<string> | null>(null)
  const filteredFlightSignatureRef = useRef('')
  const filteredAirportSignatureRef = useRef('')

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

  const [showResultados, setShowResultados] = useState(false)
  const hasShownResults = useRef(false)
  const [resultSnapshot, setResultSnapshot] = useState<SimulationState | null>(null)

  const hasSimulationStarted = Boolean(sessionId || simulationState)

  const aeropuertos = useMemo(() => {
    const base = simulationState?.aeropuertos?.length ? simulationState.aeropuertos : []
    const map = new Map<string, AeropuertoDTO>()

    aeropuertosEstaticos.forEach((a) => {
      map.set(a.codigoOACI, a)
    })

    base.forEach((a) => {
      map.set(a.codigoOACI, a)
    })

    return Array.from(map.values())
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

  // Restore config from sessionStorage on mount
  useEffect(() => {
    refreshSimulacionContextData().catch(() => {})

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
  }, [refreshSimulacionContextData])

  // Detectar simulación activa al montar (permite ver simulación en otras pestañas)
  useEffect(() => {
    const wasStopped = localStorage.getItem(SIM_STOPPED_KEY)
    if (wasStopped) {
      // El usuario detuvo manualmente: limpiar estado residual y no restaurar nunca
      resetSimulation()
      setSessionId('')
      setResultSnapshot(null)
      hasShownResults.current = false
      return
    }
    let cancelled = false
    simulationService.activa().then((res) => {
      if (cancelled) return
      if (res.activa && res.sessionId) {
        setSessionId(res.sessionId)
        startPolling(res.sessionId, undefined, res.startedAt, res.elapsedRealtimeSeconds)
        if (res.startedAt) {
          const parts = res.startedAt.split('T')
          if (parts.length === 2) {
            setFechaInicio(parts[0])
            setHoraInicio(parts[1].substring(0, 5))
          }
        }
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [startPolling, resetSimulation])

  const vuelos = useMemo(() => {
    if (!hasSimulationStarted) return EMPTY_FLIGHTS

    const combinados = new Map<string, VueloDTO>()
    vuelosEstaticos.forEach((vuelo) => {
      combinados.set(vuelo.id, vuelo)
    })
    simulationState?.vuelos?.forEach((vuelo) => {
      combinados.set(vuelo.id, vuelo)
    })
    return Array.from(combinados.values())
  }, [hasSimulationStarted, simulationState?.vuelos, vuelosEstaticos])

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

  // Show results modal when simulation completes
  useEffect(() => {
    const shouldShow = simulationState && (simulationState.status === 'COMPLETADA' || simulationState.progreso >= 100)
    if (shouldShow && !hasShownResults.current) {
      hasShownResults.current = true
      setResultSnapshot({ ...simulationState })
      setShowResultados(true)
    }
  }, [simulationState])

  // Detener simulación al cerrar la pestaña
  useEffect(() => {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    const handleBeforeUnload = () => {
      if (sessionId) {
        const url = `${API_BASE}/simulacion/detener/${sessionId}`
        navigator.sendBeacon?.(url)
        try {
          fetch(url, { method: 'POST', keepalive: true, mode: 'no-cors' })
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [sessionId])

  function formatElapsed(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const simulatedElapsedSeconds = useMemo(() => {
    if (!simulationState?.simulationTime || !fechaInicio || !horaInicio) return 0
    const simulationNowMs = Date.parse(`${simulationState.simulationTime}Z`)
    const simulationStartMs = Date.parse(`${fechaInicio}T${horaInicio}:00Z`)
    if (Number.isNaN(simulationNowMs) || Number.isNaN(simulationStartMs)) return 0
    return Math.max(0, Math.floor((simulationNowMs - simulationStartMs) / 1000))
  }, [simulationState?.simulationTime, fechaInicio, horaInicio])

  const saveConfigToStorage = (cfg: { fechaInicio: string; horaInicio: string }) => {
    sessionStorage.setItem(SIM_CONFIG_KEY, JSON.stringify(cfg))
  }

  const clearConfigStorage = () => {
    sessionStorage.removeItem(SIM_CONFIG_KEY)
  }

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
      localStorage.removeItem(SIM_STOPPED_KEY)
      hasShownResults.current = false
      setResultSnapshot(null)
      setSessionId(state.sessionId)
      startPolling(state.sessionId, undefined, state.startedAt, state.elapsedRealtimeSeconds)
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

  const handleDetenerConfirmado = async () => {
    if (!sessionId) return
    try {
      await simulationService.detener(sessionId)
    } catch {
      // ignore
    }
    resetSimulation()
    setSessionId('')
    setIsPaused(false)
    resetElapsedTimer()
    clearConfigStorage()
    localStorage.setItem(SIM_STOPPED_KEY, '1')
    hasShownResults.current = false
    setResultSnapshot(null)
    setShowResultados(false)
    setShowStopConfirm(false)
  }

  const handleNuevaSimulacion = () => {
    resetSimulation()
    setSessionId('')
    setIsPaused(false)
    resetElapsedTimer()
    clearConfigStorage()
    localStorage.removeItem(SIM_STOPPED_KEY)
    hasShownResults.current = false
    setResultSnapshot(null)
    setShowResultados(false)
    refreshSimulacionContextData().catch(() => {})
  }

  const showActionButton = sessionId && !isColapsada && !isError

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

  const enviosActivos = hasSimulationStarted ? (simulationState?.envios || []) : []
  const maletasActivas = hasSimulationStarted ? (simulationState?.maletas || []) : []

  const flightStats = useMemo(() => vuelos.reduce((stats, vuelo) => {
    const visibleInSample = Boolean(vuelo.editable) || shouldDisplayFlight(vuelo.id) || vuelo.id === selectedVuelo?.id
    if (vuelo.estado === 'CULMINADO' && visibleInSample) stats.culminados++
    else if (vuelo.estado === 'ACTIVO' && visibleInSample) stats.enTransito++
    else if (vuelo.estado === 'CANCELADO') stats.cancelados++
    if (vuelo.estado === 'ACTIVO' && visibleInSample && vuelo.cargaActual <= 0) stats.vaciosEnTransito++
    return stats
  }, { culminados: 0, enTransito: 0, cancelados: 0, vaciosEnTransito: 0 }), [vuelos, selectedVuelo?.id])

  const vuelosCulminados = flightStats.culminados
  const vuelosEnTransitoCount = flightStats.enTransito
  const vuelosCancelados = flightStats.cancelados
  const vuelosVaciosEnTransito = flightStats.vaciosEnTransito
  const vuelosVaciosEnTransitoPct = vuelosEnTransitoCount > 0
    ? Math.round((vuelosVaciosEnTransito / vuelosEnTransitoCount) * 100)
    : 0

  const occupancy = useMemo(() => {
    const flota = vuelos.reduce((acc, v) => ({
      carga: acc.carga + v.cargaActual,
      capacidad: acc.capacidad + v.capacidad,
    }), { carga: 0, capacidad: 0 })
    const aeropuertosOcu = aeropuertos.reduce((acc, a) => ({
      ocupacion: acc.ocupacion + a.ocupacionActual,
      capacidad: acc.capacidad + a.capacidadMaxima,
    }), { ocupacion: 0, capacidad: 0 })
    return { flota, aeropuertos: aeropuertosOcu }
  }, [vuelos, aeropuertos])

  function ocupColor(ratio: number): string {
    if (ratio <= 0) return 'bg-sky-500'
    if (ratio <= 0.7) return 'bg-emerald-500'
    if (ratio <= 0.9) return 'bg-amber-500'
    return 'bg-red-500'
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Barra superior de parámetros + tiempos */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-gray-400 font-medium">Escenario:</span>
          <span className="text-[13px] text-gray-200 font-semibold">{DURACION_FIJA} días</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[13px] text-gray-400 font-medium">Fecha inicio:</label>
          <input
            type="date"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-0.5 text-[13px] text-gray-200 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            disabled={!!sessionId && !isError}
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[13px] text-gray-400 font-medium">Hora inicio:</label>
          <input
            type="time"
            value={horaInicio}
            onChange={(e) => setHoraInicio(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-0.5 text-[13px] text-gray-200 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            disabled={!!sessionId && !isError}
          />
        </div>

        {/* Tiempos de simulación */}
        {simulationState && (
          <div className="flex items-center gap-1.5 ml-0.5">
            <div className="flex flex-col bg-sky-950/40 border border-sky-800/40 rounded-lg px-2 py-0.5">
              <span className="text-[10px] text-sky-300/80 leading-tight">Tiempo real transcurrido</span>
              <span className="font-mono text-xs text-sky-200 leading-tight">{formatElapsed(elapsedRealSeconds)}</span>
            </div>
            <div className="flex flex-col bg-sky-950/40 border border-sky-800/40 rounded-lg px-2 py-0.5">
              <span className="text-[10px] text-sky-300/80 leading-tight">Tiempo simulado transcurrido</span>
              <span className="font-mono text-xs text-sky-200 leading-tight">{formatElapsed(simulatedElapsedSeconds)}</span>
            </div>
            <div className="flex flex-col bg-sky-950/40 border border-sky-800/40 rounded-lg px-2 py-0.5">
              <span className="text-[10px] text-sky-300/80 leading-tight">Fecha actual simulación</span>
              <span className="font-mono text-xs text-sky-200 leading-tight">{formatDateTime(simulationState?.simulationTime)}</span>
            </div>
            <div className="flex flex-col bg-sky-950/40 border border-sky-800/40 rounded-lg px-2 py-0.5">
              <span className="text-[10px] text-sky-300/80 leading-tight">Día</span>
              <span className="font-mono text-xs text-sky-200 leading-tight">{Math.ceil((simulationState.progreso / 100) * DURACION_FIJA)}</span>
            </div>
            <div className="flex flex-col w-[220px]">
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all"
                  style={{ width: `${simulationState.progreso}%` }}
                />
              </div>
              <p className="text-right text-[10px] text-gray-500 mt-0.5">{simulationState.progreso}%</p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 ml-1">
          {error && (
            <span className="text-xs text-red-400 font-medium">{error}</span>
          )}
          {showActionButton ? (
            <div className="flex items-center gap-2">
              {!isCompleted && (
                <button
                  onClick={() => setShowStopConfirm(true)}
                  className="px-3 py-1.5 rounded-lg font-medium text-sm bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer"
                >
                  Detener
                </button>
              )}
              {isCompleted && (
                <button
                  onClick={handleNuevaSimulacion}
                  className="px-3 py-1.5 rounded-lg font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                >
                  Nueva Simulación
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={handleIniciar}
              disabled={loading}
              className="px-5 py-1.5 rounded-lg font-medium text-sm bg-sky-600 hover:bg-sky-700 text-white transition-colors disabled:bg-gray-600 cursor-pointer"
            >
              {loading ? 'Iniciando...' : 'Iniciar'}
            </button>
          )}
        </div>
      </div>

      {/* Mapa + Panel lateral (como OperacionDiaria) */}
      <div className="flex gap-2 h-[calc(100vh-10rem)]">
        <div className="relative flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <MapaAeropuertos
            aeropuertos={aeropuertos}
            vuelos={vuelos}
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

          {/* Indicadores flotantes - inferior izquierda */}
          <div className="absolute bottom-3 left-3 z-[999] flex flex-col gap-1.5">
            <div className="min-w-[238px] bg-gray-900/50 border border-gray-600/45 rounded-xl p-2.5 backdrop-blur-[2px] shadow-md shadow-black/15">
              <h4 className="text-[11px] font-semibold text-gray-300 mb-1.5 pb-1 border-b border-gray-700/50">Ocupación Global</h4>
              <div className="grid grid-cols-1 gap-1.5">
                <div className="rounded-lg border border-gray-600/55 bg-gray-950/65 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-200">Flota</span>
                    <span className="text-base font-bold text-white">{occupancy.flota.capacidad > 0 ? Math.round(occupancy.flota.carga / occupancy.flota.capacidad * 100) : 0}%</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-[12px] text-gray-100">{occupancy.flota.carga}/{occupancy.flota.capacidad}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${ocupColor(occupancy.flota.capacidad > 0 ? occupancy.flota.carga / occupancy.flota.capacidad : 0)}`} />
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                    <div className={`h-full rounded-full transition-all ${ocupColor(occupancy.flota.capacidad > 0 ? occupancy.flota.carga / occupancy.flota.capacidad : 0)}`} style={{ width: `${Math.min(occupancy.flota.capacidad > 0 ? occupancy.flota.carga / occupancy.flota.capacidad * 100 : 0, 100)}%` }} />
                  </div>
                </div>
                <div className="rounded-lg border border-gray-600/55 bg-gray-950/65 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-200">Aeropuertos</span>
                    <span className="text-base font-bold text-white">{occupancy.aeropuertos.capacidad > 0 ? Math.round(occupancy.aeropuertos.ocupacion / occupancy.aeropuertos.capacidad * 100) : 0}%</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-[12px] text-gray-100">{occupancy.aeropuertos.ocupacion}/{occupancy.aeropuertos.capacidad}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${ocupColor(occupancy.aeropuertos.capacidad > 0 ? occupancy.aeropuertos.ocupacion / occupancy.aeropuertos.capacidad : 0)}`} />
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                    <div className={`h-full rounded-full transition-all ${ocupColor(occupancy.aeropuertos.capacidad > 0 ? occupancy.aeropuertos.ocupacion / occupancy.aeropuertos.capacidad : 0)}`} style={{ width: `${Math.min(occupancy.aeropuertos.capacidad > 0 ? occupancy.aeropuertos.ocupacion / occupancy.aeropuertos.capacidad * 100 : 0, 100)}%` }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="min-w-[210px] bg-gray-900/38 border border-gray-700/38 rounded-xl p-2.5 backdrop-blur-[2px]">
              <h4 className="text-[11px] font-semibold text-gray-300 mb-1.5 pb-1 border-b border-gray-700/50">Estado de Vuelos</h4>
              <div className="grid grid-cols-1 gap-1.5">
                <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-violet-300">En vuelo</span>
                  <div className="mt-0.5 text-sm font-bold text-gray-100">{vuelosEnTransitoCount}</div>
                </div>
                <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-violet-300">Vacíos en vuelo</span>
                    <span className="text-xs font-bold text-gray-100">{vuelosVaciosEnTransitoPct}%</span>
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono text-gray-200">{vuelosVaciosEnTransito}/{vuelosEnTransitoCount}</div>
                </div>
                <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-violet-300">Culminados</span>
                  <div className="mt-0.5 text-sm font-bold text-gray-100">{vuelosCulminados}</div>
                </div>
                <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-violet-300">Cancelados</span>
                  <div className="mt-0.5 text-sm font-bold text-gray-100">{vuelosCancelados}</div>
                </div>
              </div>
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
              aeropuertos={aeropuertos}
              vuelos={vuelos}
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
              vuelos={vuelos}
              contexto="SIMULACION"
              aeropuertosDisponibles={aeropuertos}
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
        state={resultSnapshot}
        isOpen={showResultados}
        onClose={() => setShowResultados(false)}
        onNuevaSimulacion={() => {
          setShowResultados(false)
          handleNuevaSimulacion()
        }}
      />

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
                Sí
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
