import { useState, useEffect, useCallback, useRef } from 'react'
import { cargaArchivosService } from '../services/CargaArchivosService'
import { simulationSocketService } from '../services/SimulationSocketService'
import MapaAeropuertos from '../components/MapaAeropuertos'
import EnvioListPanel from '../components/EnvioListPanel'
import MaletaListPanel from '../components/MaletaListPanel'
import AlmacenListPanel from '../components/AlmacenListPanel'
import VueloListPanel from '../components/VueloListPanel'
import { AIRPORTS_DATA, getAirportCityCountry } from '../data/airportsData'
import type { VueloDTO, AeropuertoDTO, EnvioEstado, MaletaEstado } from '../types'

const SHARED_OPERATION_POLL_MS = 5000
const TIMEZONE_TO_STATION: Record<string, { oaci: string; offset: number }> = {
  'America/Lima': { oaci: 'SPIM', offset: -300 },
  'America/Argentina/Buenos_Aires': { oaci: 'SABE', offset: -180 },
  'Europe/Copenhagen': { oaci: 'EKCH', offset: 60 },
  'Asia/Kolkata': { oaci: 'VIDP', offset: 330 },
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

function parseUtc(iso: string): Date {
  if (!iso) return new Date(0)
  if (iso.endsWith('Z')) return new Date(iso)
  return new Date(iso + 'Z')
}

function calcularProgreso(vuelo: VueloDTO, now: Date): number {
  const salida = parseUtc(vuelo.salidaUtc)
  const llegada = parseUtc(vuelo.llegadaUtc)
  const totalMs = llegada.getTime() - salida.getTime()
  if (totalMs <= 0) return 0
  const transcurrido = now.getTime() - salida.getTime()
  if (transcurrido < 0) return 0
  if (transcurrido > totalMs) return 100
  return (transcurrido / totalMs) * 100
}

function getDetectedStation() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const station = TIMEZONE_TO_STATION[timezone] ?? null
  return {
    timezone,
    stationCode: station?.oaci ?? null,
    offset: station?.offset ?? 0,
  }
}

function getLocalDateTimeParts(timezone: string): { fecha: string; hora: string; horaConSegundos: string } {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00'
  return {
    fecha: `${get('year')}-${get('month')}-${get('day')}`,
    hora: `${get('hour')}:${get('minute')}`,
    horaConSegundos: `${get('hour')}:${get('minute')}:${get('second')}`,
  }
}

export default function OperacionDiaria() {
  const detectedStation = getDetectedStation()
  const [aeropuertosEstaticos, setAeropuertosEstaticos] = useState<AeropuertoDTO[]>(aeropuertosFallback)
  const [vuelosOriginales, setVuelosOriginales] = useState<VueloDTO[]>([])
  const [vuelos, setVuelos] = useState<VueloDTO[]>([])
  const [clockInfo, setClockInfo] = useState(() => getLocalDateTimeParts(detectedStation.timezone))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)

  const [selectedVuelo, setSelectedVuelo] = useState<VueloDTO | null>(null)
  const [selectedAeropuerto, setSelectedAeropuerto] = useState<AeropuertoDTO | null>(null)
  const [selectedEnvio, setSelectedEnvio] = useState<EnvioEstado | null>(null)
  const [selectedMaleta, setSelectedMaleta] = useState<MaletaEstado | null>(null)
  const [selectedEnvioRouteMode, setSelectedEnvioRouteMode] = useState<'actual' | 'anterior'>('actual')
  const [selectedMaletaRouteMode, setSelectedMaletaRouteMode] = useState<'actual' | 'anterior'>('actual')
  const [mapTz, setMapTz] = useState(detectedStation.offset)
  const [panelMode, setPanelMode] = useState<'envios' | 'maletas' | 'almacenes' | 'aviones'>('aviones')
  const [maletaEnvioFilterId, setMaletaEnvioFilterId] = useState<string | null>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(true)
  const [panelRendered, setPanelRendered] = useState(false)
  const [panelShown, setPanelShown] = useState(false)
  const [simInfoCollapsed, setSimInfoCollapsed] = useState(false)
  const [ocuCollapsed, setOcuCollapsed] = useState(false)
  const [vuelosCollapsed, setVuelosCollapsed] = useState(false)
  const [todosEnvios, setTodosEnvios] = useState<EnvioEstado[]>([])
  const [todasMaletas, setTodasMaletas] = useState<MaletaEstado[]>([])
  const [filteredFlightIds, setFilteredFlightIds] = useState<Set<string> | null>(null)
  const [filteredAirportIds, setFilteredAirportIds] = useState<Set<string> | null>(null)
  const filteredFlightSignatureRef = useRef('')
  const filteredAirportSignatureRef = useRef('')
  const latestContextVersionRef = useRef<number | null>(null)
  const refreshInFlightRef = useRef(false)

  const refreshSharedState = useCallback(async () => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    try {
      const [aeropuertosData, vuelosData, enviosData, maletasData] = await Promise.all([
        cargaArchivosService.obtenerAeropuertos('OPERACION'),
        cargaArchivosService.obtenerVuelos('OPERACION'),
        cargaArchivosService.listarEnvios(undefined, undefined, undefined),
        cargaArchivosService.listarMaletas(undefined, undefined, undefined),
      ])
      setAeropuertosEstaticos(aeropuertosData.length > 0 ? aeropuertosData : aeropuertosFallback)
      setVuelosOriginales(vuelosData)
      setTodosEnvios(enviosData.envios)
      setTodasMaletas(maletasData.maletas)
    } catch {
      // Keep the current snapshot when a sync refresh fails.
    } finally {
      refreshInFlightRef.current = false
    }
  }, [])

  const flightStats = vuelos.reduce((stats, vuelo) => {
    const enVuelo = vuelo.estado !== 'CANCELADO' && vuelo.progresoVuelo > 0 && vuelo.progresoVuelo < 100
    if (enVuelo) {
      stats.enVuelo++
      if (vuelo.cargaActual <= 0) stats.vaciosEnVuelo++
    }
    if (vuelo.estado === 'CULMINADO') stats.culminados++
    else if (vuelo.estado === 'CANCELADO') stats.cancelados++
    return stats
  }, { enVuelo: 0, vaciosEnVuelo: 0, culminados: 0, cancelados: 0 })

  const occupancy = vuelos.reduce((acc, v) => ({
    carga: acc.carga + v.cargaActual,
    capacidad: acc.capacidad + v.capacidad,
  }), { carga: 0, capacidad: 0 })

  const vuelosVaciosEnVueloPct = flightStats.enVuelo > 0
    ? Math.round((flightStats.vaciosEnVuelo / flightStats.enVuelo) * 100)
    : 0

  function ocupColor(ratio: number): string {
    if (ratio <= 0) return 'bg-sky-500'
    if (ratio <= 0.7) return 'bg-emerald-500'
    if (ratio <= 0.9) return 'bg-amber-500'
    return 'bg-red-500'
  }

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
      const vuelo = vueloId ? vuelos.find((v) => v.id === vueloId) : null
      if (vuelo) {
        setSelectedVuelo(vuelo)
        setSelectedAeropuerto(null)
      } else {
        const aeropuerto = aeropuertosEstaticos.find((a) => a.codigoOACI === envio.aeropuertoActual)
        setSelectedVuelo(null)
        setSelectedAeropuerto(aeropuerto || null)
      }
      return envio
    })
  }, [aeropuertosEstaticos, vuelos])

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
      const vuelo = vueloId ? vuelos.find((v) => v.id === vueloId) : null
      if (vuelo) {
        setSelectedVuelo(vuelo)
        setSelectedAeropuerto(null)
      } else {
        const aeropuerto = aeropuertosEstaticos.find((a) => a.codigoOACI === maleta.aeropuertoActual)
        setSelectedVuelo(null)
        setSelectedAeropuerto(aeropuerto || null)
      }
      return maleta
    })
  }, [aeropuertosEstaticos, vuelos])

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
    const vuelo = vuelos.find((v) => v.id === vueloId)
    if (vuelo) {
      setSelectedVuelo(vuelo)
      setSelectedEnvio(null)
      setSelectedMaleta(null)
      setSelectedEnvioRouteMode('actual')
      setSelectedMaletaRouteMode('actual')
      setPanelMode('aviones')
      setPanelCollapsed(false)
    }
  }, [vuelos])

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
    setVuelosOriginales((current) => current.map((flight) => (
      flight.id === flightId ? { ...flight, estado } : flight
    )))
    setVuelos((current) => current.map((flight) => (
      flight.id === flightId ? { ...flight, estado } : flight
    )))
    setSelectedVuelo((current) => (
      current?.id === flightId ? { ...current, estado } : current
    ))
  }, [])

  const refreshOperacionSharedData = useCallback(async () => {
    const [aeropuertosData, vuelosData, enviosData, maletasData] = await Promise.all([
      cargaArchivosService.obtenerAeropuertos('OPERACION'),
      cargaArchivosService.obtenerVuelos('OPERACION'),
      cargaArchivosService.listarEnvios(undefined, undefined, undefined),
      cargaArchivosService.listarMaletas(undefined, undefined, undefined),
    ])
    setAeropuertosEstaticos(aeropuertosData.length > 0 ? aeropuertosData : aeropuertosFallback)
    setVuelosOriginales(vuelosData)
    setTodosEnvios(enviosData.envios)
    setTodasMaletas(maletasData.maletas)
  }, [])

  // Cargar aeropuertos y vuelos del dataset
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const [aeropuertosData, vuelosData, enviosData, maletasData] = await Promise.all([
          cargaArchivosService.obtenerAeropuertos('OPERACION'),
          cargaArchivosService.obtenerVuelos('OPERACION'),
          cargaArchivosService.listarEnvios(undefined, undefined, undefined),
          cargaArchivosService.listarMaletas(undefined, undefined, undefined),
        ])
        if (cancelled) return
        setAeropuertosEstaticos(aeropuertosData.length > 0 ? aeropuertosData : aeropuertosFallback)
        setVuelosOriginales(vuelosData)
        setTodosEnvios(enviosData.envios)
        setTodasMaletas(maletasData.maletas)
        setDataLoaded(true)
        setError(null)
      } catch (err: any) {
        if (!cancelled) {
          setError('Error al cargar datos de operación diaria')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Actualizar reloj local de la estacion cada segundo
  useEffect(() => {
    const tick = () => setClockInfo(getLocalDateTimeParts(detectedStation.timezone))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [detectedStation.timezone])

  // Actualizar progreso de vuelos cada segundo
  useEffect(() => {
    if (!dataLoaded || vuelosOriginales.length === 0) return

    const updateFlights = () => {
      const now = new Date()
      const actualizados = vuelosOriginales.map((v) => ({
        ...v,
        progresoVuelo: calcularProgreso(v, now),
      }))
      setVuelos(actualizados)
    }

    updateFlights()
    const interval = setInterval(updateFlights, 1000)
    return () => clearInterval(interval)
  }, [dataLoaded, vuelosOriginales])

  // Polling de vuelos cada 15 segundos para reflejar cancelaciones y nuevos envíos
  useEffect(() => {
    if (!dataLoaded) return

    let cancelled = false

    const pollSharedState = async () => {
      try {
        const [sharedState, aeropuertosData, vuelosData, enviosData, maletasData] = await Promise.all([
          cargaArchivosService.obtenerEstadoCompartido('OPERACION'),
          cargaArchivosService.obtenerAeropuertos('OPERACION'),
          cargaArchivosService.obtenerVuelos('OPERACION'),
          cargaArchivosService.listarEnvios(undefined, undefined, undefined),
          cargaArchivosService.listarMaletas(undefined, undefined, undefined),
        ])
        if (cancelled) return
        latestContextVersionRef.current = sharedState.version
        setAeropuertosEstaticos(aeropuertosData.length > 0 ? aeropuertosData : aeropuertosFallback)
        setVuelosOriginales(vuelosData)
        setTodosEnvios(enviosData.envios)
        setTodasMaletas(maletasData.maletas)
      } catch {
        // ignore polling errors to keep the current snapshot on screen
      }
    }

    pollSharedState()
    const interval = setInterval(() => {
      void pollSharedState()
    }, SHARED_OPERATION_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [dataLoaded])

  useEffect(() => {
    if (!dataLoaded) return

    return simulationSocketService.connectContext('OPERACION', {
      onMessage: (snapshot) => {
        const incomingVersion = snapshot.version
        const previousVersion = latestContextVersionRef.current
        latestContextVersionRef.current = incomingVersion
        if (previousVersion === null || incomingVersion > previousVersion) {
          void refreshSharedState()
        }
      },
    })
  }, [dataLoaded, refreshSharedState])

  useEffect(() => {
    if (!selectedAeropuerto) return
    const actualizado = aeropuertosEstaticos.find((a) => a.codigoOACI === selectedAeropuerto.codigoOACI)
    if (actualizado && actualizado !== selectedAeropuerto) {
      setSelectedAeropuerto(actualizado)
    }
  }, [aeropuertosEstaticos, selectedAeropuerto])

  useEffect(() => {
    if (!selectedVuelo) return
    const actualizado = vuelos.find((v) => v.id === selectedVuelo.id)
    if (actualizado && actualizado !== selectedVuelo) {
      setSelectedVuelo(actualizado)
    }
  }, [vuelos, selectedVuelo])

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

  const { fecha, hora, horaConSegundos } = clockInfo
  const selectedOperationEntityCount = panelMode === 'envios'
    ? todosEnvios.length
    : panelMode === 'maletas'
      ? todasMaletas.length
      : panelMode === 'almacenes'
        ? aeropuertosEstaticos.length
        : vuelos.length

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex gap-2 flex-1 min-h-0">
        <div className="relative flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60">
              <div className="text-center">
                <div className="w-10 h-10 border-4 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-gray-300 text-sm">Cargando vuelos del dataset...</p>
              </div>
            </div>
          )}
          <MapaAeropuertos
            aeropuertos={aeropuertosEstaticos}
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
            filteredFlightIds={(panelMode === 'aviones' || panelMode === 'envios') && !panelCollapsed ? filteredFlightIds : null}
            filteredAirportIds={panelMode === 'almacenes' && !panelCollapsed ? filteredAirportIds : null}
          />

          <div className="absolute left-3 top-3 z-[1001] w-[min(22rem,calc(100%-1.5rem))] rounded-xl border border-gray-600/55 bg-gray-900/70 shadow-lg shadow-black/20 backdrop-blur-[3px]">
            <button
              type="button"
              onClick={() => setSimInfoCollapsed((value) => !value)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left cursor-pointer"
            >
              <div className="min-w-0">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200">Operacion Diaria</h4>
                <p className="truncate text-[11px] text-gray-300">{fecha.split('-').reverse().join('/')} {hora}</p>
              </div>
              <span className={`shrink-0 text-xs text-gray-400 transition-transform ${simInfoCollapsed ? '' : 'rotate-180'}`}>v</span>
            </button>

            {simInfoCollapsed && (
              <div className="flex items-center gap-2 px-3 pb-3">
                <span className="font-mono text-xs font-semibold text-white shrink-0">{horaConSegundos}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-800">
                  <div
                    className={`h-full rounded-full transition-all ${loading ? 'bg-sky-400' : error ? 'bg-rose-500' : 'bg-emerald-500'}`}
                    style={{ width: `${loading ? 55 : error ? 100 : 100}%` }}
                  />
                </div>
                <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-gray-300 shrink-0">
                  {loading ? 'Sync' : error ? 'Error' : 'OK'}
                </span>
              </div>
            )}

            {(!simInfoCollapsed) && (
              <div className="space-y-2 px-3 pb-3">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg border border-gray-700/55 bg-gray-950/65 px-2.5 py-2">
                    <span className="block text-[9px] uppercase tracking-wide text-gray-500">Hora Local PC</span>
                    <span className="font-mono font-semibold text-gray-100">{horaConSegundos}</span>
                  </div>
                  <div className="rounded-lg border border-gray-700/55 bg-gray-950/65 px-2.5 py-2">
                    <span className="block text-[9px] uppercase tracking-wide text-gray-500">Fecha</span>
                    <span className="font-mono font-semibold text-gray-100">{fecha.split('-').reverse().join('/')}</span>
                  </div>
                  <div className="rounded-lg border border-gray-700/55 bg-gray-950/65 px-2.5 py-2">
                    <span className="block text-[9px] uppercase tracking-wide text-gray-500">Zona Horaria</span>
                    <span className="font-mono font-semibold text-gray-100">{detectedStation.timezone}</span>
                  </div>
                  <div className="rounded-lg border border-gray-700/55 bg-gray-950/65 px-2.5 py-2">
                    <span className="block text-[9px] uppercase tracking-wide text-gray-500">Sede Detectada</span>
                    <span className="font-mono font-semibold text-gray-100">
                      {detectedStation.stationCode ? `${detectedStation.stationCode} - ${getAirportCityCountry(detectedStation.stationCode)}` : 'No valida'}
                    </span>
                  </div>
                  <div className="rounded-lg border border-gray-700/55 bg-gray-950/65 px-2.5 py-2">
                    <span className="block text-[9px] uppercase tracking-wide text-gray-500">Vuelos Activos</span>
                    <span className="font-mono font-semibold text-gray-100">{flightStats.enVuelo}</span>
                  </div>
                  <div className="rounded-lg border border-gray-700/55 bg-gray-950/65 px-2.5 py-2">
                    <span className="block text-[9px] uppercase tracking-wide text-gray-500">Panel Actual</span>
                    <span className="font-mono font-semibold text-gray-100">{selectedOperationEntityCount}</span>
                  </div>
                </div>
                {error && <p className="text-xs font-medium text-red-400">{error}</p>}
                {loading ? (
                  <div className="rounded-lg border border-sky-800/70 bg-sky-950/35 px-3 py-2 text-[11px] text-sky-200">
                    Actualizando vuelos, envios y almacenes del contexto operativo...
                  </div>
                ) : (
                  <div className="rounded-lg border border-emerald-800/70 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-200">
                    Vista sincronizada con la operacion actual y refresco automatico cada {SHARED_OPERATION_POLL_MS / 1000}s.
                  </div>
                )}
              </div>
            )}
          </div>

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
                      <span className="text-base font-bold text-white">{occupancy.capacidad > 0 ? (occupancy.carga / occupancy.capacidad * 100).toFixed(2) : '0.00'}%</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-gray-100">{occupancy.carga.toLocaleString('fr-FR')}/{occupancy.capacidad.toLocaleString('fr-FR')}</span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${ocupColor(occupancy.capacidad > 0 ? occupancy.carga / occupancy.capacidad : 0)}`} />
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                      <div className={`h-full rounded-full transition-all ${ocupColor(occupancy.capacidad > 0 ? occupancy.carga / occupancy.capacidad : 0)}`} style={{ width: `${Math.min(occupancy.capacidad > 0 ? occupancy.carga / occupancy.capacidad * 100 : 0, 100)}%` }} />
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
                    <div className="mt-0.5 text-sm font-bold text-gray-100">{flightStats.enVuelo}</div>
                  </div>
                  <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-violet-300">Vacíos en vuelo</span>
                      <span className="text-xs font-bold text-gray-100">{vuelosVaciosEnVueloPct}%</span>
                    </div>
                    <div className="mt-0.5 text-xs font-mono text-gray-200">{flightStats.vaciosEnVuelo}/{flightStats.enVuelo}</div>
                  </div>
                  <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-violet-300">Culminados</span>
                    <div className="mt-0.5 text-sm font-bold text-gray-100">{flightStats.culminados}</div>
                  </div>
                  <div className="rounded-lg border border-gray-700/50 bg-gray-900/55 px-2 py-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-violet-300">Cancelados</span>
                    <div className="mt-0.5 text-sm font-bold text-gray-100">{flightStats.cancelados}</div>
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
              aeropuertos={aeropuertosEstaticos}
              vuelos={vuelos}
              envios={todosEnvios}
              onEnvioSelect={handleEnvioSelect}
              selectedEnvioId={selectedEnvio?.id}
              onAlmacenSelect={handleAeropuertoClick}
              selectedAlmacenId={selectedAeropuerto?.codigoOACI}
              selectedAlmacen={selectedAeropuerto}
              onVueloSelect={handleVueloClick}
              contexto="OPERACION"
              onDataChanged={handleAeropuertosContextoChanged}
              onVisibleAirportsChange={handleVisibleAirportsChange}
              tzOffset={mapTz}
              onSelectedAlmacenClear={() => setSelectedAeropuerto(null)}
            />
          ) : panelMode === 'aviones' ? (
            <VueloListPanel
              vuelos={vuelos}
              contexto="OPERACION"
              aeropuertosDisponibles={aeropuertosEstaticos}
              envios={todosEnvios}
              onEnvioSelect={handleEnvioSelect}
              selectedEnvioId={selectedEnvio?.id}
              onVueloSelect={handleVueloClick}
              selectedVueloId={selectedVuelo?.id}
              selectedVuelo={selectedVuelo}
              includeCompleted
              includeProgrammed
              onVisibleFlightsChange={handleVisibleFlightsChange}
              onDataChanged={refreshOperacionSharedData}
              onFlightStatusChanged={handleFlightStatusChanged}
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
              maletasExternas={todasMaletas}
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
              enviosExternos={todosEnvios}
              onVisibleFlightsChange={handleVisibleFlightsChange}
              onViewMaletasForEnvio={handleViewMaletasForEnvio}
              onIrAVuelo={handleIrAVueloDesdeEnvio}
              maletasExternas={todasMaletas}
              selectedMaletaId={selectedMaleta?.id}
              onMaletaSelect={handleMaletaSelectFromEnvio}
            />
          )}
        </div>
        )}
      </div>

    </div>
  )
}
