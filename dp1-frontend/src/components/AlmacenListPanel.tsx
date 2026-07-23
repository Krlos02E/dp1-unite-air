import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { cargaArchivosService } from '../services/CargaArchivosService'
import { getAirportCity, getAirportCountry } from '../data/airportsData'
import AlmacenFormModal from './AlmacenFormModal'
import AeropuertoDetailCard from './AeropuertoDetailCard'
import type { AeropuertoDTO, EnvioEstado, AlmacenDTO, AlmacenContexto, VueloDTO } from '../types'
import { formatTimeInTimezone } from '../utils/timezoneFormat'

interface Props {
  aeropuertos: AeropuertoDTO[]
  envios?: EnvioEstado[]
  onEnvioSelect?: (envio: EnvioEstado) => void
  selectedEnvioId?: string | null
  onAlmacenSelect?: (almacen: AeropuertoDTO) => void
  selectedAlmacenId?: string | null
  selectedAlmacen?: AeropuertoDTO | null
  vuelos?: VueloDTO[]
  onVueloSelect?: (vuelo: VueloDTO) => void
  contexto: AlmacenContexto
  onDataChanged?: (aeropuertos: AeropuertoDTO[]) => void | Promise<void>
  onVisibleAirportsChange?: (airportCodes: string[] | null) => void
  tzOffset?: number | string
  onSelectedAlmacenClear?: () => void
}

const DEFAULT_LIMIT = 50
type SearchScope = 'todos' | 'codigo' | 'ciudad' | 'pais'
type OccupationFilter = 'todos' | 'vacio' | 'normal' | 'alerta' | 'critico'
type SortField = 'ocupacion' | 'proxima-salida' | 'proxima-llegada'
type SortDirection = 'asc' | 'desc'

interface CombinedWarehouse extends AeropuertoDTO {
  continente?: string
}

const COUNTRY_TO_CONTINENT: Record<string, string> = {
  colombia: 'AMERICA',
  ecuador: 'AMERICA',
  venezuela: 'AMERICA',
  brasil: 'AMERICA',
  peru: 'AMERICA',
  bolivia: 'AMERICA',
  chile: 'AMERICA',
  argentina: 'AMERICA',
  paraguay: 'AMERICA',
  uruguay: 'AMERICA',
  albania: 'EUROPA',
  alemania: 'EUROPA',
  austria: 'EUROPA',
  belgica: 'EUROPA',
  bielorrusia: 'EUROPA',
  bulgaria: 'EUROPA',
  checa: 'EUROPA',
  croacia: 'EUROPA',
  dinamarca: 'EUROPA',
  holanda: 'EUROPA',
  india: 'ASIA',
  siria: 'ASIA',
  'arabia saudita': 'ASIA',
  afganistan: 'ASIA',
  oman: 'ASIA',
  yemen: 'ASIA',
  azerbaiyan: 'ASIA',
  jordania: 'ASIA',
  'emiratos arabes unidos': 'ASIA',
  pakistan: 'ASIA',
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function createCodePatternMatcher(rawPattern: string): (code: string) => boolean {
  const pattern = normalizeSearch(rawPattern)
  if (!pattern) return () => true

  if (!pattern.includes('*') && !pattern.includes('?')) {
    return (code) => code.includes(pattern)
  }

  const expression = Array.from(pattern).map((character) => {
    if (character === '*') return '.*'
    if (character === '?') return '.'
    return /[a-z0-9_-]/.test(character) ? character : `\\${character}`
  }).join('')

  const regex = new RegExp(`^${expression}$`)
  return (code) => regex.test(code)
}

function inferContinent(almacen?: AlmacenDTO, airport?: AeropuertoDTO): string {
  if (almacen?.continente) return almacen.continente
  const country = normalizeSearch(almacen?.pais || airport?.pais || getAirportCountry(airport?.codigoOACI || '') || '')
  return COUNTRY_TO_CONTINENT[country] || 'OTRO'
}

function occupationCategory(ocupacionActual: number, capacidadMaxima: number): OccupationFilter {
  if (capacidadMaxima <= 0 || ocupacionActual <= 0) return 'vacio'
  const ratio = ocupacionActual / capacidadMaxima
  if (ratio > 0.9) return 'critico'
  if (ratio > 0.7) return 'alerta'
  return 'normal'
}

function isEnvioEnAlmacen(codigoOACI: string, estado: string, aeropuertoActual: string): boolean {
  return aeropuertoActual === codigoOACI
    && estado !== 'EN_VUELO'
    && estado !== 'ENTREGADO'
}

function parseUtc(iso: string): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  const time = date.getTime()
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

function getClosestFlight(
  flightIds: string[],
  flightsMap: Map<string, VueloDTO>,
  type: 'salida' | 'llegada',
  nowMs?: number,
): VueloDTO | null {
  const currentTime = nowMs ?? Date.now()
  let upcomingFlight: VueloDTO | null = null
  let upcomingTimestamp = Number.POSITIVE_INFINITY
  let closestFlight: VueloDTO | null = null
  let closestTimestamp = Number.POSITIVE_INFINITY

  flightIds.forEach((id) => {
    const flight = flightsMap.get(id)
    if (!flight) return
    const timestamp = parseUtc(type === 'salida' ? flight.salidaUtc : flight.llegadaUtc)
    if (timestamp >= currentTime && timestamp < upcomingTimestamp) {
      upcomingTimestamp = timestamp
      upcomingFlight = flight
    }
    if (timestamp < closestTimestamp) {
      closestTimestamp = timestamp
      closestFlight = flight
    }
  })

  return upcomingFlight || closestFlight
}

export default function AlmacenListPanel({
  aeropuertos,
  envios,
  onEnvioSelect,
  selectedEnvioId,
  onAlmacenSelect,
  selectedAlmacenId,
  selectedAlmacen,
  vuelos = [],
  onVueloSelect,
  contexto,
  onDataChanged,
  onVisibleAirportsChange,
  tzOffset = 0,
  onSelectedAlmacenClear,
}: Props) {
  const [search, setSearch] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('todos')
  const [codePatternFilter, setCodePatternFilter] = useState('')
  const [continentFilter, setContinentFilter] = useState('todos')
  const [occupationFilter, setOccupationFilter] = useState<OccupationFilter>('todos')
  const [searchCollapsed, setSearchCollapsed] = useState(false)
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [sortField, setSortField] = useState<SortField>('ocupacion')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [almacenesDB, setAlmacenesDB] = useState<AlmacenDTO[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingAlmacen, setEditingAlmacen] = useState<AlmacenDTO | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [pendingReplanBaseLogId, setPendingReplanBaseLogId] = useState<number | null>(null)
  const [pendingSyncMessage, setPendingSyncMessage] = useState<string | null>(null)

  useEffect(() => {
    cargaArchivosService.obtenerAlmacenes(contexto)
      .then(setAlmacenesDB)
      .catch(() => {})
  }, [contexto])

  useEffect(() => {
    if (contexto !== 'SIMULACION') return

    let cancelled = false
    const refresh = async () => {
      try {
        const latest = await cargaArchivosService.obtenerAlmacenes(contexto)
        if (!cancelled) setAlmacenesDB(latest)
      } catch {
        // ignore transient sync errors
      }
    }

    void refresh()
    const intervalId = window.setInterval(() => {
      void refresh()
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [contexto])

  useEffect(() => {
    if (contexto !== 'OPERACION' || pendingReplanBaseLogId == null || !onDataChanged) return

    let cancelled = false

    const pollForReplan = async () => {
      try {
        const logs = await cargaArchivosService.obtenerLogsPlanificacion()
        const latestLogId = logs[0]?.id ?? 0
        if (latestLogId <= pendingReplanBaseLogId) return

        const refreshedAeropuertos = await cargaArchivosService.obtenerAeropuertos(contexto)
        if (cancelled) return
        await onDataChanged(refreshedAeropuertos)
        if (cancelled) return
        setPendingReplanBaseLogId(null)
        setPendingSyncMessage(null)
      } catch {
        // Keep polling; a transient failure should not drop the pending refresh.
      }
    }

    void pollForReplan()
    const intervalId = window.setInterval(() => {
      void pollForReplan()
    }, 15000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [contexto, pendingReplanBaseLogId, onDataChanged])

  const scheduleOperationalRefresh = async (message: string) => {
    const logs = await cargaArchivosService.obtenerLogsPlanificacion()
    setPendingReplanBaseLogId(logs[0]?.id ?? 0)
    setPendingSyncMessage(message)
  }

  const deferredSearch = useDeferredValue(search)

  const almacenMap = useMemo(() => {
    const map = new Map<string, AlmacenDTO>()
    almacenesDB.forEach(a => map.set(a.codigoOACI, a))
    return map
  }, [almacenesDB])

  const aeropuertosCombinados = useMemo(() => {
    const map = new Map<string, CombinedWarehouse>()

    aeropuertos.forEach((a) => {
      map.set(a.codigoOACI, {
        ...a,
        continente: inferContinent(undefined, a),
      })
    })

    almacenesDB.forEach((almacen) => {
      const actual = map.get(almacen.codigoOACI)
      map.set(almacen.codigoOACI, {
        codigoOACI: almacen.codigoOACI,
        latitud: almacen.latitud,
        longitud: almacen.longitud,
        ciudad: almacen.ciudad || actual?.ciudad,
        pais: almacen.pais || actual?.pais,
        capacidadMaxima: almacen.capacidadMaxima || actual?.capacidadMaxima || 0,
        ocupacionActual: actual?.ocupacionActual || 0,
        vuelosEntrantes: actual?.vuelosEntrantes || [],
        vuelosSalientes: actual?.vuelosSalientes || [],
        vuelosCanceladosSalientes: actual?.vuelosCanceladosSalientes || [],
        editable: almacen.editable,
        continente: inferContinent(almacen, actual),
      })
    })

    return Array.from(map.values())
  }, [aeropuertos, almacenesDB])

  const term = normalizeSearch(deferredSearch)
  const searchCodeMatcher = useMemo(() => createCodePatternMatcher(deferredSearch), [deferredSearch])
  const continentOptions = useMemo(
    () => Array.from(new Set(aeropuertosCombinados.map((a) => a.continente || 'OTRO'))).sort(),
    [aeropuertosCombinados],
  )
  const hasFilters = Boolean(codePatternFilter || continentFilter !== 'todos' || occupationFilter !== 'todos')

  const filtradosPorFiltro = useMemo(() => {
    const codePatternMatcher = createCodePatternMatcher(codePatternFilter)
    return aeropuertosCombinados.filter((a) => {
      if (codePatternFilter && !codePatternMatcher(normalizeSearch(a.codigoOACI))) return false
      if (continentFilter !== 'todos' && (a.continente || 'OTRO') !== continentFilter) return false
      if (occupationFilter !== 'todos' && occupationCategory(a.ocupacionActual, a.capacidadMaxima) !== occupationFilter) return false
      return true
    })
  }, [aeropuertosCombinados, codePatternFilter, continentFilter, occupationFilter])

  const filtradosSinLimite = useMemo(() => {
    const filtered = term
      ? filtradosPorFiltro.filter((a) => {
          const codigo = normalizeSearch(a.codigoOACI)
          const ciudad = normalizeSearch(a.ciudad || getAirportCity(a.codigoOACI) || '')
          const pais = normalizeSearch(a.pais || getAirportCountry(a.codigoOACI) || '')

          if (searchScope === 'codigo') return searchCodeMatcher(codigo)
          if (searchScope === 'ciudad') return ciudad.includes(term)
          if (searchScope === 'pais') return pais.includes(term)
          return searchCodeMatcher(codigo) || ciudad.includes(term) || pais.includes(term)
        })
      : filtradosPorFiltro

    const vuelosMap = new Map(vuelos.map((vuelo) => [vuelo.id, vuelo]))
    const getNextDeparture = (airport: CombinedWarehouse): number => {
      const timestamps = airport.vuelosSalientes
        .map((id) => vuelosMap.get(id))
        .filter((vuelo): vuelo is VueloDTO => Boolean(vuelo))
        .map((vuelo) => parseUtc(vuelo.salidaUtc))
      return timestamps.length ? Math.min(...timestamps) : Number.POSITIVE_INFINITY
    }
    const getNextArrival = (airport: CombinedWarehouse): number => {
      const timestamps = airport.vuelosEntrantes
        .map((id) => vuelosMap.get(id))
        .filter((vuelo): vuelo is VueloDTO => Boolean(vuelo))
        .map((vuelo) => parseUtc(vuelo.llegadaUtc))
      return timestamps.length ? Math.min(...timestamps) : Number.POSITIVE_INFINITY
    }

    return [...filtered].sort((a, b) => {
      let comparison = 0
      if (sortField === 'ocupacion') {
        const aRatio = a.capacidadMaxima > 0 ? a.ocupacionActual / a.capacidadMaxima : 0
        const bRatio = b.capacidadMaxima > 0 ? b.ocupacionActual / b.capacidadMaxima : 0
        comparison = aRatio - bRatio
      } else if (sortField === 'proxima-salida') {
        comparison = getNextDeparture(a) - getNextDeparture(b)
      } else {
        comparison = getNextArrival(a) - getNextArrival(b)
      }

      if (comparison === 0) comparison = a.codigoOACI.localeCompare(b.codigoOACI)
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [filtradosPorFiltro, term, searchScope, searchCodeMatcher, vuelos, sortField, sortDirection])

  const shouldBypassLimit = Boolean(term || hasFilters)
  const filtrados = showAll || shouldBypassLimit ? filtradosSinLimite : filtradosSinLimite.slice(0, DEFAULT_LIMIT)
  const vuelosMap = useMemo(() => new Map(vuelos.map((vuelo) => [vuelo.id, vuelo])), [vuelos])

  useEffect(() => {
    if (!onVisibleAirportsChange) return
    if (!hasFilters) {
      onVisibleAirportsChange(null)
      return
    }

    const timeoutId = window.setTimeout(() => {
      onVisibleAirportsChange(filtradosPorFiltro.map((airport) => airport.codigoOACI))
    }, 120)

    return () => window.clearTimeout(timeoutId)
  }, [filtradosPorFiltro, hasFilters, onVisibleAirportsChange])

  const handleSave = async (data: AlmacenDTO) => {
    if (editingAlmacen) {
      await cargaArchivosService.actualizarAlmacen(data.codigoOACI, data, contexto)
    } else {
      await cargaArchivosService.crearAlmacen(data, contexto)
    }
    const updated = await cargaArchivosService.obtenerAlmacenes(contexto)
    setAlmacenesDB(updated)
    if (onDataChanged) {
      const refreshedAeropuertos = await cargaArchivosService.obtenerAeropuertos(contexto)
      await onDataChanged(refreshedAeropuertos)
      if (contexto === 'OPERACION') {
        await scheduleOperationalRefresh('Cambios guardados. El mapa y el detalle operativo se actualizarán después de la próxima replanificación programada.')
      }
    }
  }

  const handleDelete = async (codigo: string) => {
    try {
      await cargaArchivosService.eliminarAlmacen(codigo, contexto)
      const updated = await cargaArchivosService.obtenerAlmacenes(contexto)
      setAlmacenesDB(updated)
      if (onDataChanged) {
        const refreshedAeropuertos = await cargaArchivosService.obtenerAeropuertos(contexto)
        await onDataChanged(refreshedAeropuertos)
        if (contexto === 'OPERACION') {
          await scheduleOperationalRefresh('El almacén se eliminó. El mapa y el detalle operativo se actualizarán después de la próxima replanificación programada.')
        }
      }
      setDeleteConfirm(null)
      setDeleteError(null)
    } catch (err: any) {
      setDeleteError(err?.response?.data?.error || 'No se pudo eliminar el almacén')
    }
  }

  return (
    <div className="w-96 flex-1 min-h-0 bg-gray-900 border border-gray-800 rounded-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-violet-200">Almacenes</h3>
          <button
            onClick={() => { setEditingAlmacen(null); setShowForm(true) }}
            className="text-[11px] bg-sky-600 hover:bg-sky-500 text-white px-2 py-1 rounded-md font-medium transition-colors"
          >
            + Nuevo
          </button>
        </div>
        <div className="space-y-1.5">
          <div>
            <button onClick={() => setSearchCollapsed((v) => !v)} className="flex w-full items-center justify-between gap-2 mb-1 cursor-pointer">
              <p className="text-[10px] font-medium uppercase tracking-wide text-violet-300">Búsqueda temporal</p>
              <span className={`text-gray-500 text-[10px] transition-transform ${searchCollapsed ? '' : 'rotate-180'}`}>▼</span>
            </button>
            {!searchCollapsed && (
              <div className="flex gap-1.5">
                <select
                  value={searchScope}
                  onChange={(e) => setSearchScope(e.target.value as SearchScope)}
                  className="w-[88px] bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                >
                  <option value="todos">Todo</option>
                  <option value="codigo">Código</option>
                  <option value="ciudad">Ciudad</option>
                  <option value="pais">País</option>
                </select>
                <input
                  type="text"
                  placeholder="Buscar temporalmente..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                />
              </div>
            )}
          </div>
          <div className="pt-2 border-t border-gray-800/80">
            <button onClick={() => setFiltersCollapsed((v) => !v)} className="flex w-full items-center justify-between gap-2 mb-1 cursor-pointer">
              <p className="text-[10px] font-medium uppercase tracking-wide text-violet-300">Filtros persistentes</p>
              <span className={`text-gray-500 text-[10px] transition-transform ${filtersCollapsed ? '' : 'rotate-180'}`}>▼</span>
            </button>
            {!filtersCollapsed && (
              <div className="space-y-1.5">
                {hasFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setCodePatternFilter('')
                      setContinentFilter('todos')
                      setOccupationFilter('todos')
                    }}
                    className="text-[9px] text-sky-400 hover:text-sky-300"
                  >
                    Limpiar filtros
                  </button>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="text"
                    value={codePatternFilter}
                    onChange={(e) => setCodePatternFilter(e.target.value)}
                    placeholder="Filtro código/patrón"
                    className="col-span-2 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                  />
                  <select
                    value={continentFilter}
                    onChange={(e) => setContinentFilter(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                  >
                    <option value="todos">Todos los continentes</option>
                    {continentOptions.map((continent) => (
                      <option key={continent} value={continent}>{continent}</option>
                    ))}
                  </select>
                  <select
                    value={occupationFilter}
                    onChange={(e) => setOccupationFilter(e.target.value as OccupationFilter)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                  >
                    <option value="todos">Todos los semáforos</option>
                    <option value="vacio">Vacío</option>
                    <option value="normal">Estándar</option>
                    <option value="alerta">Alerta</option>
                    <option value="critico">Crítico</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
        {deleteError && (
          <div className="mt-2 rounded-lg border border-red-700 bg-red-900/40 px-3 py-2 text-xs text-red-300">
            {deleteError}
          </div>
        )}
        {pendingSyncMessage && (
          <div className="mt-2 rounded-lg border border-amber-700 bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
            {pendingSyncMessage}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-b border-gray-800 flex items-center gap-1.5">
        <span className="text-[10px] text-gray-500 whitespace-nowrap">Ordenar:</span>
        <select
          value={sortField}
          onChange={(e) => setSortField(e.target.value as SortField)}
          className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
        >
          <option value="ocupacion">Nivel de ocupación</option>
          <option value="proxima-salida">UT más próxima en salir</option>
          <option value="proxima-llegada">UT más próxima en llegar</option>
        </select>
        <button
          type="button"
          onClick={() => setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')}
          className="w-7 h-6 rounded bg-gray-800 border border-gray-700 text-[11px] text-sky-400 hover:bg-gray-700 cursor-pointer"
          title={sortDirection === 'asc' ? 'Orden ascendente' : 'Orden descendente'}
          aria-label={sortDirection === 'asc' ? 'Cambiar a orden descendente' : 'Cambiar a orden ascendente'}
        >
          {sortDirection === 'asc' ? '↑' : '↓'}
        </button>
      </div>
      {sortField !== 'ocupacion' && (
        <div className="px-3 py-1.5 border-b border-gray-800/70 text-[10px] text-violet-300/80">
          {sortField === 'proxima-salida'
            ? 'Orden actual: UT que sale más pronto por almacén'
            : 'Orden actual: UT que llega más pronto por almacén'}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {selectedAlmacen && (
          <div className="border-b border-gray-800 p-3">
            <AeropuertoDetailCard
              aeropuerto={selectedAlmacen}
              vuelos={vuelos}
              envios={envios}
              tzOffset={tzOffset}
              onEnvioSelect={onEnvioSelect}
              selectedEnvioId={selectedEnvioId}
              onVueloSelect={onVueloSelect}
              onClear={onSelectedAlmacenClear}
              aeropuertos={aeropuertosCombinados}
            />
          </div>
        )}
        {filtrados.length === 0 && (
          <p className="text-center text-xs text-gray-500 py-8">
            {term || hasFilters ? 'No se encontraron almacenes' : 'No hay almacenes disponibles'}
          </p>
        )}

        {filtrados.map((a) => {
          const isSelected = selectedAlmacenId === a.codigoOACI
          const almacenDB = almacenMap.get(a.codigoOACI)
          const ciudad = a.ciudad || getAirportCity(a.codigoOACI) || ''
          const pais = a.pais || getAirportCountry(a.codigoOACI) || ''
          const enviosAqui = envios?.filter((e) => isEnvioEnAlmacen(a.codigoOACI, e.estado, e.aeropuertoActual)) || []
          const ocupacionVisual = enviosAqui.reduce((sum, envio) => sum + envio.cantidad, 0)
          const ocupPct = a.capacidadMaxima > 0 ? Math.round((ocupacionVisual / a.capacidadMaxima) * 100) : 0
          const esEditable = Boolean(almacenDB?.editable)
          const nextDepartureFlight = getClosestFlight(a.vuelosSalientes, vuelosMap, 'salida')
          const nextArrivalFlight = getClosestFlight(a.vuelosEntrantes, vuelosMap, 'llegada')
          const showNextDeparture = nextDepartureFlight
          const showNextArrival = nextArrivalFlight

          return (
            <div key={a.codigoOACI} className="border-b border-gray-800/50">
              {/* Main row */}
              <div
                onClick={() => {
                  onAlmacenSelect?.(a)
                }}
                className={`px-3 py-2 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-amber-900/20 border-l-2 border-l-amber-400'
                    : 'hover:bg-gray-800/50'
                }`}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-violet-300 truncate">
                      <span className="font-semibold text-emerald-400">{a.codigoOACI}</span>
                      {ciudad && <span className="text-violet-200 ml-1">· {ciudad}{pais ? `, ${pais}` : ''}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingAlmacen({
                          codigoOACI: a.codigoOACI,
                          ciudad,
                          pais,
                          continente: almacenDB?.continente || a.continente || '',
                          gmtOffsetMinutos: almacenDB?.gmtOffsetMinutos ?? 0,
                          capacidadMaxima: almacenDB?.capacidadMaxima || a.capacidadMaxima,
                          latitud: almacenDB?.latitud || a.latitud,
                          longitud: almacenDB?.longitud || a.longitud,
                          editable: almacenDB?.editable,
                          ocupacionActual: a.ocupacionActual,
                        })
                        setShowForm(true)
                      }}
                      className="text-[10px] text-gray-500 hover:text-sky-400 px-1 py-0.5 rounded transition-colors"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    {esEditable ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteError(null)
                          setDeleteConfirm(a.codigoOACI)
                        }}
                        className="text-[10px] text-gray-500 hover:text-red-400 px-1 py-0.5 rounded transition-colors"
                        title="Eliminar"
                      >
                        🗑️
                      </button>
                    ) : (
                      <span
                        className="text-[10px] text-gray-600 px-1 py-0.5 rounded cursor-not-allowed"
                        title="Este almacén proviene del maestro y no se puede eliminar"
                      >
                        🗑️
                      </span>
                    )}
                  </div>
                </div>

                {/* Occupation bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        ocupPct > 90 ? 'bg-red-500' : ocupPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(ocupPct, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap font-mono">
                    {ocupacionVisual}/{a.capacidadMaxima}
                  </span>
                  <span className={`text-[10px] font-mono font-medium ${
                    ocupPct > 90 ? 'text-red-400' : ocupPct > 70 ? 'text-amber-400' : 'text-emerald-400'
                  }`}>
                    ({ocupPct}%)
                  </span>
                </div>

                {envios && (
                  <div className="text-[10px] text-violet-300/80 mt-1">
                    📦 {enviosAqui.length} envío{enviosAqui.length !== 1 ? 's' : ''} en almacén
                  </div>
                )}
                {showNextDeparture && (
                  <div className="text-[10px] text-violet-300/80 mt-1 truncate">
                    ✈️ Próxima salida: <span className="font-mono text-violet-200">{nextDepartureFlight.id}</span>
                    <span className="text-gray-500"> · sale {formatTimeInTimezone(nextDepartureFlight.salidaUtc, tzOffset)}</span>
                  </div>
                )}
                {showNextArrival && (
                  <div className="text-[10px] text-violet-300/80 mt-1 truncate">
                    🛬 Próxima llegada: <span className="font-mono text-violet-200">{nextArrivalFlight.id}</span>
                    <span className="text-gray-500"> · llega {formatTimeInTimezone(nextArrivalFlight.llegadaUtc, tzOffset)}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-gray-800 text-[10px] text-gray-600 flex justify-between items-center">
        <span>{filtrados.length} de {filtradosSinLimite.length} · base {aeropuertosCombinados.length}</span>
        {!showAll && !shouldBypassLimit && filtradosSinLimite.length > DEFAULT_LIMIT && (
          <button onClick={() => setShowAll(true)} className="text-sky-400 hover:text-sky-300 font-medium cursor-pointer">
            Mostrar todos
          </button>
        )}
      </div>

      {/* Form Modal */}
      <AlmacenFormModal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingAlmacen(null) }}
        onSave={handleSave}
        almacen={editingAlmacen}
      />

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-100 mb-2">Eliminar almacén</h3>
            <p className="text-gray-300 text-sm mb-6">
              ¿Estás seguro de eliminar el almacén <span className="font-semibold text-red-400">{deleteConfirm}</span>?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg font-medium text-sm transition-colors"
              >
                Sí, eliminar
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg font-medium text-sm transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
