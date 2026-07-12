import { useState, useEffect, useCallback, useRef } from 'react'
import { cargaArchivosService } from '../services/CargaArchivosService'
import MapaAeropuertos from '../components/MapaAeropuertos'
import EnvioListPanel from '../components/EnvioListPanel'
import MaletaListPanel from '../components/MaletaListPanel'
import AlmacenListPanel from '../components/AlmacenListPanel'
import VueloListPanel from '../components/VueloListPanel'
import { AIRPORTS_DATA } from '../data/airportsData'
import type { VueloDTO, AeropuertoDTO, EnvioEstado, MaletaEstado } from '../types'

const SHARED_OPERATION_POLL_MS = 5000

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

function getPeruTimeString(): string {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return formatter.format(now)
}

function getPeruDateParts(): { fecha: string; hora: string } {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00'
  return {
    fecha: `${get('year')}-${get('month')}-${get('day')}`,
    hora: `${get('hour')}:${get('minute')}`,
  }
}

export default function OperacionDiaria() {
  const [aeropuertosEstaticos, setAeropuertosEstaticos] = useState<AeropuertoDTO[]>(aeropuertosFallback)
  const [vuelosOriginales, setVuelosOriginales] = useState<VueloDTO[]>([])
  const [vuelos, setVuelos] = useState<VueloDTO[]>([])
  const [horaPeru, setHoraPeru] = useState(getPeruTimeString())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)

  const [selectedVuelo, setSelectedVuelo] = useState<VueloDTO | null>(null)
  const [selectedAeropuerto, setSelectedAeropuerto] = useState<AeropuertoDTO | null>(null)
  const [selectedEnvio, setSelectedEnvio] = useState<EnvioEstado | null>(null)
  const [selectedMaleta, setSelectedMaleta] = useState<MaletaEstado | null>(null)
  const [selectedEnvioRouteMode, setSelectedEnvioRouteMode] = useState<'actual' | 'anterior'>('actual')
  const [selectedMaletaRouteMode, setSelectedMaletaRouteMode] = useState<'actual' | 'anterior'>('actual')
  const [mapTz, setMapTz] = useState(0)
  const [panelMode, setPanelMode] = useState<'envios' | 'maletas' | 'almacenes' | 'aviones'>('aviones')
  const [maletaEnvioFilterId, setMaletaEnvioFilterId] = useState<string | null>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(true)
  const [panelRendered, setPanelRendered] = useState(false)
  const [panelShown, setPanelShown] = useState(false)
  const [todosEnvios, setTodosEnvios] = useState<EnvioEstado[]>([])
  const [todasMaletas, setTodasMaletas] = useState<MaletaEstado[]>([])
  const [filteredFlightIds, setFilteredFlightIds] = useState<Set<string> | null>(null)
  const [filteredAirportIds, setFilteredAirportIds] = useState<Set<string> | null>(null)
  const filteredFlightSignatureRef = useRef('')
  const filteredAirportSignatureRef = useRef('')

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

  // Actualizar reloj peruano cada segundo
  useEffect(() => {
    const tick = () => setHoraPeru(getPeruTimeString())
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [])

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

  const { fecha } = getPeruDateParts()

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Barra superior: hora actual y fecha — centrada, sin recuadros */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Hora Perú</span>
          <span className="text-sm font-mono font-bold text-white">{horaPeru}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Fecha</span>
          <span className="text-sm font-mono font-bold text-white">{fecha.split('-').reverse().join('/')}</span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {loading && (
            <span className="text-xs text-gray-400 flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin inline-block" />
              Cargando datos...
            </span>
          )}
          {error && (
            <span className="text-xs text-red-400 font-medium">{error}</span>
          )}
        </div>
      </div>

      {/* Mapa + Panel de envíos/almacenes */}
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
          <button
            onClick={() => setPanelCollapsed((current) => !current)}
            className="absolute top-4 right-4 z-[1001] bg-gray-800/95 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white hover:bg-gray-700 transition-colors cursor-pointer shadow-lg"
            title={panelCollapsed ? 'Abrir panel' : 'Contraer panel'}
          >
            {panelCollapsed ? '▶ Panel' : '◀ Panel'}
          </button>

          <div className="absolute bottom-4 left-4 z-[999] flex flex-col gap-2">
            <div className="bg-gray-900/40 border border-gray-700/40 rounded-xl p-3 backdrop-blur-[2px]">
              <h4 className="text-xs font-semibold text-gray-300 mb-2 pb-1 border-b border-gray-700/50">Ocupación Global</h4>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                    <span className="truncate">Flota: {occupancy.carga}/{occupancy.capacidad}</span>
                    <span className="shrink-0 ml-1">{occupancy.capacidad > 0 ? Math.round(occupancy.carga / occupancy.capacidad * 100) : 0}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${ocupColor(occupancy.capacidad > 0 ? occupancy.carga / occupancy.capacidad : 0)}`}
                      style={{ width: `${Math.min(occupancy.capacidad > 0 ? occupancy.carga / occupancy.capacidad * 100 : 0, 100)}%` }}
                    />
                  </div>
                </div>
                <span className={`w-2 h-2 rounded-full shrink-0 ${ocupColor(occupancy.capacidad > 0 ? occupancy.carga / occupancy.capacidad : 0)}`} />
              </div>
            </div>
            <div className="bg-gray-900/40 border border-gray-700/40 rounded-xl p-3 backdrop-blur-[2px]">
              <h4 className="text-xs font-semibold text-gray-300 mb-2 pb-1 border-b border-gray-700/50">Estado de Vuelos</h4>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 bg-violet-900/35 border border-violet-700/55 rounded-lg px-2 py-1">
                  <span className="text-[10px] text-violet-400 font-medium">En Vuelo</span>
                  <span className="text-xs font-bold text-violet-300 bg-violet-800/55 px-1.5 py-0.5 rounded">{flightStats.enVuelo}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-sky-950/55 border border-sky-800/70 rounded-lg px-2 py-1">
                  <span className="text-[10px] text-sky-300 font-medium">Vacíos en vuelo</span>
                  <span className="text-xs font-bold text-sky-200 bg-sky-900/70 px-1.5 py-0.5 rounded">
                    {flightStats.vaciosEnVuelo}/{flightStats.enVuelo}
                  </span>
                  <span className="text-[10px] text-sky-400 font-medium">({vuelosVaciosEnVueloPct}%)</span>
                </div>
                <div className="flex items-center gap-1.5 bg-violet-900/20 border border-violet-700/40 rounded-lg px-2 py-1">
                  <span className="text-[10px] text-violet-300 font-medium">Culminados</span>
                  <span className="text-xs font-bold text-violet-200 bg-violet-700/40 px-1.5 py-0.5 rounded">{flightStats.culminados}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-violet-950/55 border border-violet-800/70 rounded-lg px-2 py-1">
                  <span className="text-[10px] text-violet-500 font-medium">Cancelados</span>
                  <span className="text-xs font-bold text-violet-400 bg-violet-950/80 px-1.5 py-0.5 rounded">{flightStats.cancelados}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {panelRendered && (
        <div
          className={`flex flex-col gap-2 transition-[transform,opacity] duration-200 ease-out will-change-transform ${
            panelShown ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <button
              onClick={() => setPanelMode('envios')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                panelMode === 'envios'
                  ? 'bg-sky-600 text-white'
                  : 'text-gray-400 hover:text-gray-200 bg-gray-800'
              }`}
            >
              📦 Envíos
            </button>
            <button
              onClick={() => setPanelMode('maletas')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                panelMode === 'maletas'
                  ? 'bg-sky-600 text-white'
                  : 'text-gray-400 hover:text-gray-200 bg-gray-800'
              }`}
            >
              🧳 Maletas
            </button>
            <button
              onClick={() => setPanelMode('almacenes')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                panelMode === 'almacenes'
                  ? 'bg-sky-600 text-white'
                  : 'text-gray-400 hover:text-gray-200 bg-gray-800'
              }`}
            >
              🏢 Almacenes
            </button>
            <button
              onClick={() => setPanelMode('aviones')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                panelMode === 'aviones'
                  ? 'bg-sky-600 text-white'
                  : 'text-gray-400 hover:text-gray-200 bg-gray-800'
              }`}
            >
              ✈️ Aviones
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
