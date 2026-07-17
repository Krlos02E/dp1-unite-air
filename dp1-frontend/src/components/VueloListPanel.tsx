import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AirportLookupData,
  buildAirportLookup,
  getAirportCityResolved,
  getAirportCountryResolved,
  getAirportTimezone,
} from '../data/airportsData'
import { cargaArchivosService } from '../services/CargaArchivosService'
import {
  formatDateInTimezone,
  formatLocalClockTimeInTimezone,
  formatTimeInTimezone,
  parseUtcOffsetLabel,
} from '../utils/timezoneFormat'
import VueloProgramacionModal from './VueloProgramacionModal'
import VueloDetailCard from './VueloDetailCard'
import type { VueloDTO, EnvioEstado, AeropuertoDTO, AlmacenContexto, ProgramacionVueloDTO } from '../types'
import { shouldDisplayFlight } from '../utils/flightVisibility'

interface Props {
  vuelos: VueloDTO[]
  contexto?: AlmacenContexto
  aeropuertosDisponibles?: AeropuertoDTO[]
  envios?: EnvioEstado[]
  onEnvioSelect?: (envio: EnvioEstado) => void
  selectedEnvioId?: string | null
  onVueloSelect?: (vuelo: VueloDTO) => void
  selectedVueloId?: string | null
  selectedVuelo?: VueloDTO | null
  includeCompleted?: boolean
  includeProgrammed?: boolean
  showStatusFilters?: boolean
  onVisibleFlightsChange?: (flightIds: string[] | null) => void
  onDataChanged?: () => void | Promise<void>
  onFlightStatusChanged?: (flightId: string, estado: 'CANCELADO' | 'PROGRAMADO') => void
  simulationSessionId?: string | null
  tzOffset?: number
  onSelectedVueloClear?: () => void
}

const estadoColor: Record<string, string> = {
  EN_ESPERA: 'text-amber-400 bg-amber-400/10',
  EMBARCADO: 'text-sky-400 bg-sky-400/10',
  EN_VUELO: 'text-emerald-400 bg-emerald-400/10',
  ENTREGADO: 'text-gray-400 bg-gray-400/10',
  PROGRAMADO: 'text-sky-300 bg-sky-400/10',
  ACTIVO: 'text-emerald-300 bg-emerald-400/10',
  CULMINADO: 'text-gray-300 bg-gray-400/10',
  CANCELADO: 'text-red-300 bg-red-400/10',
}

const DEFAULT_LIMIT = 50

type SortField = 'ocupacion' | 'salida' | 'llegada' | 'origen' | 'destino'
type SortDirection = 'asc' | 'desc'
type LocationMatchMode = 'codigo' | 'ciudad'
type RouteFilterScope = 'tramo' | 'ruta'
type OccupationFilter = 'todos' | 'vacio' | 'normal' | 'alerta' | 'critico'

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function locationFieldValue(code: string, airportLookup: Map<string, AirportLookupData>, mode: LocationMatchMode): string {
  if (mode === 'codigo') return normalizeSearch(code)
  return normalizeSearch(getAirportCityResolved(code, airportLookup) || '')
}

function locationMatches(code: string, term: string, airportLookup: Map<string, AirportLookupData>, mode: LocationMatchMode): boolean {
  return locationFieldValue(code, airportLookup, mode).includes(normalizeSearch(term))
}

function routeMatches(route: string[] | undefined, term: string, airportLookup: Map<string, AirportLookupData>, mode: LocationMatchMode): boolean {
  if (!route?.length) return false
  return route.some((code) => locationMatches(code, term, airportLookup, mode))
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

function timeOfDay(iso: string): number {
  if (!iso) return 0
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function occupationStatus(cargaActual: number, ocupPct: number) {
  if (cargaActual <= 0) {
    return { label: 'Vacío', bar: 'bg-sky-500', text: 'text-sky-400', track: 'bg-sky-950/80' }
  }
  if (ocupPct > 90) {
    return { label: 'Crítico', bar: 'bg-red-500', text: 'text-red-400', track: 'bg-gray-800' }
  }
  if (ocupPct > 70) {
    return { label: 'Alerta', bar: 'bg-amber-500', text: 'text-amber-400', track: 'bg-gray-800' }
  }
  return { label: 'Estándar', bar: 'bg-emerald-500', text: 'text-emerald-400', track: 'bg-gray-800' }
}

function occupationCategory(cargaActual: number, ocupPct: number): OccupationFilter {
  if (cargaActual <= 0) return 'vacio'
  if (ocupPct > 90) return 'critico'
  if (ocupPct > 70) return 'alerta'
  return 'normal'
}

function formatProgramacionTime(
  localTime: string,
  airportCode: string,
  targetOffsetMinutes: number,
): string {
  const airportOffset = parseUtcOffsetLabel(getAirportTimezone(airportCode))
  if (airportOffset == null) return localTime.slice(0, 5) || '--:--'
  return formatLocalClockTimeInTimezone(localTime, airportOffset, targetOffsetMinutes)
}

function VueloListPanel({
  vuelos,
  contexto,
  aeropuertosDisponibles = [],
  envios,
  onEnvioSelect,
  selectedEnvioId,
  onVueloSelect,
  selectedVueloId,
  selectedVuelo,
  includeCompleted = false,
  includeProgrammed = false,
  showStatusFilters = true,
  onVisibleFlightsChange,
  onDataChanged,
  onFlightStatusChanged,
  simulationSessionId,
  tzOffset = 0,
  onSelectedVueloClear,
}: Props) {
  const [searchOrigin, setSearchOrigin] = useState('')
  const [searchDestination, setSearchDestination] = useState('')
  const [searchCode, setSearchCode] = useState('')
  const [searchOriginMode, setSearchOriginMode] = useState<LocationMatchMode>('ciudad')
  const [searchDestinationMode, setSearchDestinationMode] = useState<LocationMatchMode>('ciudad')
  const [searchCollapsed, setSearchCollapsed] = useState(false)
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [filterEstado, setFilterEstado] = useState<string>('ACTIVO')
  const [originFilter, setOriginFilter] = useState('')
  const [destinationFilter, setDestinationFilter] = useState('')
  const [codeFilter, setCodeFilter] = useState('')
  const [occupationFilter, setOccupationFilter] = useState<OccupationFilter>('todos')
  const [originFilterMode, setOriginFilterMode] = useState<LocationMatchMode>('ciudad')
  const [destinationFilterMode, setDestinationFilterMode] = useState<LocationMatchMode>('ciudad')
  const [filterRouteScope, setFilterRouteScope] = useState<RouteFilterScope>('tramo')
  const [sortField, setSortField] = useState<SortField>('ocupacion')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [programaciones, setProgramaciones] = useState<ProgramacionVueloDTO[]>([])
  const [showProgramacionForm, setShowProgramacionForm] = useState(false)
  const [editingProgramacion, setEditingProgramacion] = useState<ProgramacionVueloDTO | null>(null)
  const [deletingProgramacionId, setDeletingProgramacionId] = useState<number | null>(null)
  const [programacionesExpanded, setProgramacionesExpanded] = useState(false)
  const [cancellingFlightId, setCancellingFlightId] = useState<string | null>(null)
  const [flightMessage, setFlightMessage] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null)
  const [pendingReplanBaseLogId, setPendingReplanBaseLogId] = useState<number | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const contentRef = useRef<HTMLDivElement | null>(null)
  const airportLookup = useMemo(() => buildAirportLookup(aeropuertosDisponibles), [aeropuertosDisponibles])

  const deferredSearchOrigin = useDeferredValue(searchOrigin)
  const deferredSearchDestination = useDeferredValue(searchDestination)
  const deferredSearchCode = useDeferredValue(searchCode)
  const searchOriginTerm = normalizeSearch(deferredSearchOrigin)
  const searchDestinationTerm = normalizeSearch(deferredSearchDestination)
  const searchCodeTerm = normalizeSearch(deferredSearchCode)
  const searchCodeMatcher = useMemo(
    () => createCodePatternMatcher(deferredSearchCode),
    [deferredSearchCode],
  )
  const filterCodeMatcher = useMemo(
    () => createCodePatternMatcher(codeFilter),
    [codeFilter],
  )
  const hasPanelSearch = Boolean(searchOriginTerm || searchDestinationTerm || normalizeSearch(deferredSearchCode))
  const hasPersistentFilters = Boolean(originFilter || destinationFilter || codeFilter || occupationFilter !== 'todos')
  const hasMapFilters = Boolean(originFilter || destinationFilter || codeFilter || occupationFilter !== 'todos')
  const canManageTransportUnits = Boolean(contexto)
  const canCancelFlights = Boolean(contexto)

  useEffect(() => {
    if (!contexto) return
    cargaArchivosService.obtenerProgramacionesVuelo(contexto)
      .then(setProgramaciones)
      .catch(() => {})
  }, [contexto])

  useEffect(() => {
    if (contexto !== 'SIMULACION') return

    let cancelled = false
    const refresh = async () => {
      try {
        const latest = await cargaArchivosService.obtenerProgramacionesVuelo(contexto)
        if (!cancelled) setProgramaciones(latest)
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

        if (cancelled) return
        await onDataChanged()
        if (cancelled) return
        setPendingReplanBaseLogId(null)
        setFlightMessage(null)
      } catch {
        // Keep polling until the scheduled replan becomes visible in logs.
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

  const enviosByFlight = useMemo(() => {
    const index = new Map<string, EnvioEstado[]>()
    if (!envios) return index
    envios.forEach((envio) => {
      const flightIds = new Set([envio.vueloActual, envio.vueloEsperado, envio.ultimoVuelo].filter((id): id is string => Boolean(id)))
      flightIds.forEach((flightId) => {
        const current = index.get(flightId)
        if (current) current.push(envio)
        else index.set(flightId, [envio])
      })
    })
    return index
  }, [envios])

  const visibleFlights = useMemo(
    () => vuelos.filter((flight) => (
      (
        (includeProgrammed && flight.estado === 'PROGRAMADO')
        || 
        flight.estado === 'ACTIVO'
        || (includeCompleted && flight.estado === 'CULMINADO')
        || (includeCompleted && flight.estado === 'CANCELADO')
      )
      && (
        flight.estado === 'CANCELADO'
        || Boolean(flight.editable)
        || shouldDisplayFlight(flight.id)
        || flight.id === selectedVueloId
      )
    )),
    [vuelos, selectedVueloId, includeCompleted, includeProgrammed, showStatusFilters],
  )

  const indexedFlights = useMemo(() => visibleFlights.map((flight) => {
    const codigo = normalizeSearch(flight.id)
    return {
      flight,
      codigo,
      ocupacion: flight.capacidad > 0 ? flight.cargaActual / flight.capacidad : 0,
      ocupacionCategoria: occupationCategory(
        flight.cargaActual,
        flight.capacidad > 0 ? Math.round((flight.cargaActual / flight.capacidad) * 100) : 0,
      ),
      salida: timeOfDay(flight.salidaUtc),
      llegada: timeOfDay(flight.llegadaUtc),
      origenOrden: normalizeSearch(getAirportCountryResolved(flight.origen, airportLookup) || getAirportCityResolved(flight.origen, airportLookup) || flight.origen),
      destinoOrden: normalizeSearch(getAirportCountryResolved(flight.destino, airportLookup) || getAirportCityResolved(flight.destino, airportLookup) || flight.destino),
    }
  }), [visibleFlights, airportLookup])

  const filtradosPersistentes = useMemo(() => {
    return indexedFlights.filter(({ flight: v, codigo, ocupacionCategoria }) => {
      if (originFilter) {
        const matchesOrigin = filterRouteScope === 'ruta'
          ? (enviosByFlight.get(v.id)?.some((envio) => routeMatches(envio.rutaAeropuertos, originFilter, airportLookup, originFilterMode)) ?? false)
          : locationMatches(v.origen, originFilter, airportLookup, originFilterMode)
        if (!matchesOrigin) return false
      }
      if (destinationFilter) {
        const matchesDestination = filterRouteScope === 'ruta'
          ? (enviosByFlight.get(v.id)?.some((envio) => routeMatches(envio.rutaAeropuertos, destinationFilter, airportLookup, destinationFilterMode)) ?? false)
          : locationMatches(v.destino, destinationFilter, airportLookup, destinationFilterMode)
        if (!matchesDestination) return false
      }
      if (codeFilter && !filterCodeMatcher(codigo)) return false
      if (occupationFilter !== 'todos' && ocupacionCategoria !== occupationFilter) return false
      return true
    })
  }, [indexedFlights, originFilter, destinationFilter, codeFilter, filterCodeMatcher, occupationFilter, airportLookup, originFilterMode, destinationFilterMode, filterRouteScope, enviosByFlight])

  const filtradosSinLimite = useMemo(() => {
    return filtradosPersistentes.filter(({ flight, codigo }) => {
      if (showStatusFilters && flight.estado !== filterEstado) return false
      if (searchOriginTerm && !locationMatches(flight.origen, searchOriginTerm, airportLookup, searchOriginMode)) return false
      if (searchDestinationTerm && !locationMatches(flight.destino, searchDestinationTerm, airportLookup, searchDestinationMode)) return false
      if (searchCodeTerm && !searchCodeMatcher(codigo)) return false
      return true
    }).sort((a, b) => {
      let comparison: number
      if (sortField === 'ocupacion') comparison = a.ocupacion - b.ocupacion
      else if (sortField === 'salida') comparison = a.salida - b.salida
      else if (sortField === 'llegada') comparison = a.llegada - b.llegada
      else if (sortField === 'origen') comparison = a.origenOrden.localeCompare(b.origenOrden)
      else comparison = a.destinoOrden.localeCompare(b.destinoOrden)

      if (comparison === 0) comparison = a.codigo.localeCompare(b.codigo)
      return sortDirection === 'asc' ? comparison : -comparison
    }).map(({ flight }) => flight)
  }, [filtradosPersistentes, searchOriginTerm, searchDestinationTerm, searchCodeMatcher, searchCodeTerm, sortField, sortDirection, airportLookup, searchOriginMode, searchDestinationMode, showStatusFilters, filterEstado])

  const estadosDisponibles = useMemo(() => {
    const states = includeProgrammed ? ['PROGRAMADO', 'ACTIVO'] : ['ACTIVO']
    if (includeCompleted) states.push('CULMINADO', 'CANCELADO')
    return states
  }, [includeCompleted, includeProgrammed])

  useEffect(() => {
    if (!onVisibleFlightsChange) return
    if (!hasMapFilters) {
      onVisibleFlightsChange(null)
      return
    }

    const timeoutId = window.setTimeout(() => {
      onVisibleFlightsChange(filtradosPersistentes.map(({ flight }) => flight.id))
    }, 120)

    return () => window.clearTimeout(timeoutId)
  }, [filtradosPersistentes, hasMapFilters, onVisibleFlightsChange])

  useEffect(() => {
    if (!selectedVueloId) return
    const selected = vuelos.find((flight) => flight.id === selectedVueloId)
    if (!selected) return

    const estadosValidos = new Set(estadosDisponibles)
    if (selected.estado && estadosValidos.has(selected.estado) && selected.estado !== filterEstado) {
      setFilterEstado(selected.estado)
    }

    const visible = filtradosSinLimite.some((flight) => flight.id === selectedVueloId)
    if (!visible) return

    window.setTimeout(() => {
      if (selectedVuelo?.id === selectedVueloId) {
        contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      rowRefs.current.get(selectedVueloId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 0)
  }, [selectedVueloId, selectedVuelo?.id, vuelos, estadosDisponibles, filterEstado, filtradosSinLimite])

  const resultKey = `${searchOriginTerm}|${searchDestinationTerm}|${searchCodeTerm}|${searchOriginMode}|${searchDestinationMode}|${originFilter}|${destinationFilter}|${codeFilter}|${occupationFilter}|${originFilterMode}|${destinationFilterMode}|${filterRouteScope}|${filterEstado}|${sortField}|${sortDirection}`
  const [page, setPage] = useState({ key: '', limit: DEFAULT_LIMIT })
  const visibleLimit = page.key === resultKey ? page.limit : DEFAULT_LIMIT
  const filtrados = filtradosSinLimite.slice(0, visibleLimit)

  const programacionesFiltradas = useMemo(() => {
    return programaciones.filter((programacion) => {
      if (originFilter && !locationMatches(programacion.origenOACI, originFilter, airportLookup, originFilterMode)) return false
      if (destinationFilter && !locationMatches(programacion.destinoOACI, destinationFilter, airportLookup, destinationFilterMode)) return false
      const codigoProgramacion = normalizeSearch(`USR-${programacion.id ?? ''}-${programacion.origenOACI}-${programacion.destinoOACI}`)
      if (codeFilter && !filterCodeMatcher(codigoProgramacion)) return false
      if (searchOriginTerm && !locationMatches(programacion.origenOACI, searchOriginTerm, airportLookup, searchOriginMode)) return false
      if (searchDestinationTerm && !locationMatches(programacion.destinoOACI, searchDestinationTerm, airportLookup, searchDestinationMode)) return false
      if (searchCodeTerm && !searchCodeMatcher(codigoProgramacion)) return false
      return true
    })
  }, [programaciones, originFilter, destinationFilter, codeFilter, filterCodeMatcher, searchOriginTerm, searchDestinationTerm, searchCodeMatcher, searchCodeTerm, airportLookup, originFilterMode, destinationFilterMode, searchOriginMode, searchDestinationMode])

  const estadoVueloLabel: Record<string, string> = {
    ACTIVO: 'Activos',
    PROGRAMADO: 'Programados',
    CULMINADO: 'Culminados',
    CANCELADO: 'Cancelados',
  }

  const refreshProgramaciones = async () => {
    if (!contexto) return
    const programacionesActualizadas = await cargaArchivosService.obtenerProgramacionesVuelo(contexto)
    setProgramaciones(programacionesActualizadas)
  }

  const scheduleOperationalRefresh = async (message: string) => {
    const logs = await cargaArchivosService.obtenerLogsPlanificacion()
    setPendingReplanBaseLogId(logs[0]?.id ?? 0)
    setFlightMessage({ tipo: 'success', texto: message })
  }

  const handleProgramacionSave = async (data: ProgramacionVueloDTO) => {
    if (!contexto) return
    if (editingProgramacion?.id) {
      await cargaArchivosService.actualizarProgramacionVuelo(editingProgramacion.id, data, contexto)
    } else {
      await cargaArchivosService.crearProgramacionVuelo(data, contexto)
    }
    await refreshProgramaciones()
    setFlightMessage({ tipo: 'success', texto: 'UT guardada correctamente' })
    await onDataChanged?.()
    if (contexto === 'SIMULACION' && includeProgrammed) {
      setFilterEstado('PROGRAMADO')
      setProgramacionesExpanded(true)
    }
    if (contexto === 'OPERACION' && onDataChanged) {
      await scheduleOperationalRefresh('UT guardada. Los vuelos operativos se actualizarán después de la próxima replanificación programada.')
    }
  }

  const handleDeleteProgramacion = async (id: number) => {
    if (!contexto) return
    await cargaArchivosService.eliminarProgramacionVuelo(id, contexto)
    await refreshProgramaciones()
    setFlightMessage({ tipo: 'success', texto: 'UT eliminada correctamente' })
    await onDataChanged?.()
    if (contexto === 'OPERACION' && onDataChanged) {
      await scheduleOperationalRefresh('UT eliminada. Los vuelos operativos se actualizarán después de la próxima replanificación programada.')
    }
    setDeletingProgramacionId(null)
  }

  const handleCancelFlight = async (flight: VueloDTO) => {
    if (!contexto || flight.estado !== 'PROGRAMADO') return
    setCancellingFlightId(flight.id)
    setFlightMessage(null)
    try {
      const horaSalidaLocal = flight.salidaUtc.slice(11, 16)
      const result = await cargaArchivosService.cancelarVuelo(
        flight.origen,
        flight.destino,
        horaSalidaLocal,
        contexto,
        simulationSessionId || undefined,
      )
      if (result.success && result.vueloId) {
        setFlightMessage({ tipo: 'success', texto: `Vuelo ${result.vueloId} cancelado correctamente` })
        onFlightStatusChanged?.(result.vueloId, 'CANCELADO')
        if (contexto !== 'SIMULACION') {
          await onDataChanged?.()
        }
      } else {
        setFlightMessage({ tipo: 'error', texto: result.message || 'No se pudo cancelar el vuelo' })
      }
    } catch (error: any) {
      setFlightMessage({
        tipo: 'error',
        texto: error?.response?.data?.message || error?.message || 'No se pudo cancelar el vuelo',
      })
    } finally {
      setCancellingFlightId(null)
    }
  }

  const handleUncancelFlight = async (flight: VueloDTO) => {
    if (!contexto || flight.estado !== 'CANCELADO') return
    setCancellingFlightId(flight.id)
    setFlightMessage(null)
    try {
      const result = await cargaArchivosService.descancelarVuelo(flight.id, contexto)
      if (result.success && result.vueloId) {
        setFlightMessage({ tipo: 'success', texto: `Vuelo ${result.vueloId} descancelado correctamente` })
        onFlightStatusChanged?.(result.vueloId, 'PROGRAMADO')
        if (contexto !== 'SIMULACION') {
          await onDataChanged?.()
        }
      } else {
        setFlightMessage({ tipo: 'error', texto: result.message || 'No se pudo descancelar el vuelo' })
      }
    } catch (error: any) {
      setFlightMessage({
        tipo: 'error',
        texto: error?.response?.data?.message || error?.message || 'No se pudo descancelar el vuelo',
      })
    } finally {
      setCancellingFlightId(null)
    }
  }

  return (
    <div className="w-96 flex-1 min-h-0 bg-gray-900 border border-gray-800 rounded-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-800">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-200">Unidades de transporte</h3>
          {canManageTransportUnits && (
            <button
              type="button"
              onClick={() => {
                setEditingProgramacion(null)
                setShowProgramacionForm(true)
              }}
              className="text-[11px] bg-sky-600 hover:bg-sky-500 text-white px-2 py-1 rounded-md font-medium transition-colors"
            >
              + Nueva UT
            </button>
          )}
        </div>
        {flightMessage && (
          <div className={`mb-2 rounded-lg border px-2.5 py-2 text-[10px] ${
            flightMessage.tipo === 'success'
              ? 'border-emerald-700 bg-emerald-900/30 text-emerald-300'
              : 'border-red-700 bg-red-900/30 text-red-300'
          }`}>
            {flightMessage.texto}
          </div>
        )}
        {canManageTransportUnits && (
          <div className="mb-3 rounded-lg border border-gray-800 bg-gray-950/70 p-2">
            <button
              type="button"
              onClick={() => setProgramacionesExpanded((current) => !current)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="text-[10px] font-medium text-gray-300">Programación recurrente diaria</span>
              <span className="text-[9px] text-gray-500">
                {programacionesFiltradas.length} de {programaciones.length} {programacionesExpanded ? '▼' : '▶'}
              </span>
            </button>
            {programaciones.length === 0 ? (
              <p className="mt-1 text-[10px] text-gray-500">No hay UT creadas por interfaz en este contexto.</p>
            ) : !programacionesExpanded ? (
              <p className="mt-1 text-[10px] text-gray-500">
                {programacionesFiltradas.length === 0
                  ? 'No hay UT creadas por interfaz que coincidan con el filtro actual.'
                  : 'Expandir para ver y editar las UT creadas por interfaz.'}
              </p>
            ) : programacionesFiltradas.length === 0 ? (
              <p className="mt-1 text-[10px] text-gray-500">No hay UT creadas por interfaz que coincidan con el filtro actual.</p>
            ) : (
              <div
                className="mt-2 max-h-44 space-y-1.5 overflow-y-scroll pr-1"
                style={{ scrollbarGutter: 'stable' }}
              >
                {programacionesFiltradas.map((programacion) => (
                  <div key={programacion.id} className="rounded-md border border-gray-800 bg-gray-900/80 px-2 py-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold text-sky-400">
                          {programacion.origenOACI} → {programacion.destinoOACI}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {formatProgramacionTime(programacion.horaSalidaLocal, programacion.origenOACI, tzOffset)}
                          {' - '}
                          {formatProgramacionTime(programacion.horaLlegadaLocal, programacion.destinoOACI, tzOffset)}
                          {' · cap. '}
                          {programacion.capacidad}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProgramacion(programacion)
                            setShowProgramacionForm(true)
                          }}
                          className="text-[10px] text-gray-400 hover:text-sky-400 px-1 py-0.5 rounded transition-colors"
                          title="Editar programación"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingProgramacionId(programacion.id || null)}
                          className="text-[10px] text-gray-400 hover:text-red-400 px-1 py-0.5 rounded transition-colors"
                          title="Eliminar programación"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    {deletingProgramacionId === programacion.id && (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => programacion.id && handleDeleteProgramacion(programacion.id)}
                          className="flex-1 rounded-md bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-500"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingProgramacionId(null)}
                          className="flex-1 rounded-md bg-gray-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-gray-600"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-2" aria-label="Semáforo de ocupación">
          {[
            ['bg-sky-500', 'Vacío'],
            ['bg-emerald-500', 'Estándar'],
            ['bg-amber-500', 'Alerta'],
            ['bg-red-500', 'Crítico'],
          ].map(([color, label]) => (
            <span key={label} className="inline-flex items-center gap-1 text-[9px] text-violet-300/80">
              <span className={`w-1.5 h-1.5 rounded-full ${color}`} />{label}
            </span>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-gray-800/80">
          <button onClick={() => setSearchCollapsed((v) => !v)} className="flex w-full items-center justify-between gap-2 mb-1.5 cursor-pointer">
            <span className="text-[10px] font-medium text-violet-300">Búsqueda en panel</span>
            <span className={`text-gray-500 text-[10px] transition-transform ${searchCollapsed ? '' : 'rotate-180'}`}>▼</span>
          </button>
          {!searchCollapsed && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-1 gap-1.5">
                <div className="flex gap-1.5">
                  <select
                    value={searchOriginMode}
                    onChange={(e) => setSearchOriginMode(e.target.value as LocationMatchMode)}
                    aria-label="Buscar origen por tipo"
                    className="w-[92px] bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                  >
                    <option value="codigo">Código</option>
                    <option value="ciudad">Ciudad</option>
                  </select>
                  <input
                    type="text"
                    value={searchOrigin}
                    onChange={(e) => setSearchOrigin(e.target.value)}
                    aria-label="Buscar unidades de transporte por origen en el panel"
                    placeholder="Búsqueda por origen"
                    className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-300 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex gap-1.5">
                  <select
                    value={searchDestinationMode}
                    onChange={(e) => setSearchDestinationMode(e.target.value as LocationMatchMode)}
                    aria-label="Buscar destino por tipo"
                    className="w-[92px] bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                  >
                    <option value="codigo">Código</option>
                    <option value="ciudad">Ciudad</option>
                  </select>
                  <input
                    type="text"
                    value={searchDestination}
                    onChange={(e) => setSearchDestination(e.target.value)}
                    aria-label="Buscar unidades de transporte por destino en el panel"
                    placeholder="Búsqueda por destino"
                    className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-300 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <input
                  type="text"
                  value={searchCode}
                  onChange={(e) => setSearchCode(e.target.value)}
                  aria-label="Buscar unidades de transporte por código en el panel"
                  placeholder="Búsqueda por código UT"
                  className="min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-300 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                />
              </div>
              {hasPanelSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchOrigin('')
                    setSearchDestination('')
                    setSearchCode('')
                  }}
                  className="text-[9px] text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  Limpiar
                </button>
              )}
            </div>
          )}
          <div className="mt-2">
            <button onClick={() => setFiltersCollapsed((v) => !v)} className="flex w-full items-center justify-between gap-2 mb-1.5 cursor-pointer">
              <span className="text-[10px] font-medium text-violet-300">Filtros persistentes</span>
              <span className={`text-gray-500 text-[10px] transition-transform ${filtersCollapsed ? '' : 'rotate-180'}`}>▼</span>
            </button>
            {!filtersCollapsed && (
              <div className="space-y-1.5">
                {hasPersistentFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setOriginFilter('')
                      setDestinationFilter('')
                      setCodeFilter('')
                      setOccupationFilter('todos')
                    }}
                    className="text-[9px] text-sky-400 hover:text-sky-300 cursor-pointer"
                  >
                    Limpiar
                  </button>
                )}
                <div className="grid grid-cols-1 gap-1.5">
                  <select
                    value={filterRouteScope}
                    onChange={(e) => setFilterRouteScope(e.target.value as RouteFilterScope)}
                    aria-label="Aplicar filtros de origen y destino en tramo o ruta"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                  >
                    <option value="tramo">Filtrar en tramo</option>
                    <option value="ruta">Filtrar en ruta</option>
                  </select>
                  <div className="flex gap-1.5">
                    <select
                      value={originFilterMode}
                      onChange={(e) => setOriginFilterMode(e.target.value as LocationMatchMode)}
                      aria-label="Filtrar origen por tipo"
                      className="w-[92px] bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                    >
                      <option value="codigo">Código</option>
                      <option value="ciudad">Ciudad</option>
                    </select>
                    <input
                      type="text"
                      value={originFilter}
                      onChange={(e) => setOriginFilter(e.target.value)}
                      aria-label="Filtrar unidades de transporte por origen"
                      placeholder="Filtrar origen"
                      className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-300 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div className="flex gap-1.5">
                    <select
                      value={destinationFilterMode}
                      onChange={(e) => setDestinationFilterMode(e.target.value as LocationMatchMode)}
                      aria-label="Filtrar destino por tipo"
                      className="w-[92px] bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                    >
                      <option value="codigo">Código</option>
                      <option value="ciudad">Ciudad</option>
                    </select>
                    <input
                      type="text"
                      value={destinationFilter}
                      onChange={(e) => setDestinationFilter(e.target.value)}
                      aria-label="Filtrar unidades de transporte por destino"
                      placeholder="Filtrar destino"
                      className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-300 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <input
                    type="text"
                    value={codeFilter}
                    onChange={(e) => setCodeFilter(e.target.value)}
                    aria-label="Filtrar unidades de transporte por código"
                    placeholder="Filtrar código UT"
                    className="min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-300 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                  />
                  <select
                    value={occupationFilter}
                    onChange={(e) => setOccupationFilter(e.target.value as OccupationFilter)}
                    aria-label="Filtrar unidades de transporte por semáforo"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                  >
                    <option value="todos">Filtrar semáforo: Todos</option>
                    <option value="vacio">Semáforo: Vacío</option>
                    <option value="normal">Semáforo: Estándar</option>
                    <option value="alerta">Semáforo: Alerta</option>
                    <option value="critico">Semáforo: Crítico</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* State filter */}
      {showStatusFilters && (
        <div className="px-3 py-1.5 border-b border-gray-800 flex gap-1 overflow-x-auto flex-nowrap">
          {estadosDisponibles.map(est => (
            <button
              key={est}
              onClick={() => setFilterEstado(est)}
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap cursor-pointer ${
                filterEstado === est
                  ? 'bg-sky-600 text-white'
                  : 'bg-gray-800 text-violet-300/80 hover:text-violet-200'
              }`}
            >
              {estadoVueloLabel[est] || est}
            </button>
          ))}
        </div>
      )}

      {/* Sorting */}
      <div className="px-3 py-1.5 border-b border-gray-800 flex items-center gap-1.5">
        <span className="text-[10px] text-violet-300 whitespace-nowrap">Ordenar:</span>
        <select
          value={sortField}
          onChange={(e) => setSortField(e.target.value as SortField)}
          aria-label="Ordenar unidades de transporte por"
          className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
        >
          <option value="ocupacion">Nivel de ocupación</option>
          <option value="salida">Hora de salida</option>
          <option value="llegada">Hora de llegada</option>
          <option value="origen">Origen</option>
          <option value="destino">Destino</option>
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

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        {selectedVuelo && (
          <div className="border-b border-gray-800 p-3">
            <VueloDetailCard
              vuelo={selectedVuelo}
              tzOffset={tzOffset}
              aeropuertos={aeropuertosDisponibles}
              envios={envios}
              onEnvioSelect={onEnvioSelect}
              selectedEnvioId={selectedEnvioId}
              onClear={onSelectedVueloClear}
            />
          </div>
        )}
        {filtrados.length === 0 && (
          <p className="text-center text-xs text-gray-500 py-8">
            {programacionesFiltradas.length > 0
              ? 'No hay vuelos activos para este filtro. Revisa la programación recurrente superior.'
              : hasPanelSearch || hasPersistentFilters ? 'No se encontraron vuelos' : 'No hay vuelos disponibles'}
          </p>
        )}

        {filtrados.map((v) => {
          const isFlightSelected = selectedVueloId === v.id
          const enviosEnEsteVuelo = enviosByFlight.get(v.id) ?? []
          const totalMaletas = enviosEnEsteVuelo.reduce((sum, e) => sum + e.cantidad, 0)
          const ocupPct = v.capacidad > 0 ? Math.round((v.cargaActual / v.capacidad) * 100) : 0
          const ocupacion = occupationStatus(v.cargaActual, ocupPct)
          const origenPais = getAirportCountryResolved(v.origen, airportLookup) || getAirportCityResolved(v.origen, airportLookup) || v.origen
          const destinoPais = getAirportCountryResolved(v.destino, airportLookup) || getAirportCityResolved(v.destino, airportLookup) || v.destino

          return (
            <div
              key={v.id}
              ref={(node) => {
                if (node) rowRefs.current.set(v.id, node)
                else rowRefs.current.delete(v.id)
              }}
              className="border-b border-gray-800/50"
            >
              {/* Main row */}
              <div
                onClick={() => {
                  onVueloSelect?.(v)
                }}
                className={`px-3 py-2 cursor-pointer transition-colors ${
                  isFlightSelected
                    ? 'bg-amber-900/20 border-l-2 border-l-amber-400'
                    : 'hover:bg-gray-800/50'
                }`}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-mono font-bold text-violet-200 mb-0.5" title={v.id}>
                      UT {v.origen}-{v.destino}
                    </div>
                    <div className="text-[11px] text-violet-300 truncate">
                      <span className="font-medium text-violet-200">{origenPais}</span>
                      <span className="text-gray-500 mx-0.5">→</span>
                      <span className="font-medium text-violet-200">{destinoPais}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-gray-500">
                      Salida: {formatDateInTimezone(v.salidaUtc, tzOffset)} {formatTimeInTimezone(v.salidaUtc, tzOffset)}
                      {' · '}
                      Llegada: {formatDateInTimezone(v.llegadaUtc, tzOffset)} {formatTimeInTimezone(v.llegadaUtc, tzOffset)}
                    </div>
                    {v.estado && (
                      <span className={`text-[9px] font-medium px-1 py-0.5 rounded-full ${estadoColor[v.estado] || 'text-gray-500'}`}>
                        {v.estado}
                      </span>
                    )}
                  </div>
                  {canCancelFlights && (v.estado === 'PROGRAMADO' || v.estado === 'CANCELADO') && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (v.estado === 'CANCELADO') {
                          handleUncancelFlight(v)
                        } else {
                          handleCancelFlight(v)
                        }
                      }}
                      disabled={cancellingFlightId === v.id}
                      className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium text-white disabled:cursor-not-allowed ${
                        v.estado === 'CANCELADO'
                          ? 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800'
                          : 'bg-red-600 hover:bg-red-500 disabled:bg-red-800'
                      }`}
                    >
                      {cancellingFlightId === v.id
                        ? (v.estado === 'CANCELADO' ? 'Descancelando...' : 'Cancelando...')
                        : (v.estado === 'CANCELADO' ? 'Descancelar' : 'Cancelar')}
                    </button>
                  )}
                </div>

                {/* Occupation bar */}
                <div className="flex items-center gap-2 mt-1">
                  <div className={`flex-1 ${ocupacion.track} rounded-full h-2 overflow-hidden`}>
                    <div
                      className={`h-full rounded-full transition-all ${ocupacion.bar}`}
                      style={{ width: `${Math.min(ocupPct, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap font-mono">
                    {v.cargaActual}/{v.capacidad}
                  </span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${ocupacion.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${ocupacion.bar}`} />
                    {ocupacion.label} ({ocupPct}%)
                  </span>
                </div>

                {envios && (
                  <div className="text-[10px] text-violet-300/80 mt-1">
                    📦 {enviosEnEsteVuelo.length} envío{enviosEnEsteVuelo.length !== 1 ? 's' : ''} · 🎒 {totalMaletas} maleta{totalMaletas !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-gray-800 text-[10px] text-gray-600 flex justify-between items-center">
        <span>{filtrados.length} mostrados · {filtradosSinLimite.length} de {visibleFlights.length}</span>
        {filtrados.length < filtradosSinLimite.length && (
          <button
            onClick={() => setPage({ key: resultKey, limit: visibleLimit + DEFAULT_LIMIT })}
            className="text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            Mostrar {Math.min(DEFAULT_LIMIT, filtradosSinLimite.length - filtrados.length)} más
          </button>
        )}
      </div>

      <VueloProgramacionModal
        isOpen={showProgramacionForm}
        aeropuertos={aeropuertosDisponibles}
        programacion={editingProgramacion}
        onClose={() => {
          setShowProgramacionForm(false)
          setEditingProgramacion(null)
        }}
        onSave={handleProgramacionSave}
      />
    </div>
  )
}

export default memo(VueloListPanel)
