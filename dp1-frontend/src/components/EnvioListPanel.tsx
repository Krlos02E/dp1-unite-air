import { useState, useEffect, useRef, useDeferredValue } from 'react'
import { cargaArchivosService } from '../services/CargaArchivosService'
import { getAirportCity, getAirportCountry } from '../data/airportsData'
import type { EnvioEstado, MaletaEstado } from '../types'
import EnvioDetailCard from './EnvioDetailCard'

type Tab = 'pendientes' | 'envuelo' | 'entregados'
type MainTab = 'almacen' | 'envuelo' | 'entregados'
type FilterScope = 'directo' | 'ruta'
type FilterMatchBy = 'codigo' | 'ciudad' | 'pais'

const TAB_CONFIG: { key: Tab; label: string; estados: string; horas?: number }[] = [
  { key: 'envuelo', label: 'En vuelo', estados: 'EN_VUELO' },
  { key: 'pendientes', label: 'En espera', estados: 'EN_ESPERA,EMBARCADO' },
  { key: 'entregados', label: 'Entregados', estados: 'ENTREGADO', horas: 4 },
]

const MAIN_TAB_CONFIG: { key: MainTab; label: string }[] = [
  { key: 'almacen', label: 'En almacén' },
  { key: 'envuelo', label: 'En vuelo' },
  { key: 'entregados', label: 'Entregados' },
]

function isStorageState(estado: string): boolean {
  return estado === 'EN_ESPERA' || estado === 'EMBARCADO'
}

interface Props {
  onEnvioSelect: (envio: EnvioEstado) => void
  selectedEnvioId?: string | null
  selectedEnvio?: EnvioEstado | null
  selectedEnvioRouteMode?: 'actual' | 'anterior'
  onSelectedEnvioRouteModeChange?: (mode: 'actual' | 'anterior') => void
  onClearSelectedEnvio?: () => void
  enviosExternos?: EnvioEstado[]
  currentTime?: string | null
  onViewMaletasForEnvio?: (envioId: string) => void
  onIrAVuelo?: (vueloId: string) => void
  maletasExternas?: MaletaEstado[]
  selectedMaletaId?: string | null
  onMaletaSelect?: (maleta: MaletaEstado) => void
  onVisibleFlightsChange?: (flightIds: string[] | null) => void
}

const DEFAULT_LIMIT = 50

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function airportFieldValue(code: string, matchBy: FilterMatchBy): string {
  if (matchBy === 'codigo') return code
  if (matchBy === 'pais') return getAirportCountry(code) || ''
  return getAirportCity(code) || ''
}

function airportMatches(code: string, term: string, matchBy: FilterMatchBy): boolean {
  return normalizeSearch(airportFieldValue(code, matchBy)).includes(normalizeSearch(term))
}

function routeMatches(route: string[] | undefined, term: string, matchBy: FilterMatchBy): boolean {
  if (!route?.length) return false
  return route.some((code) => airportMatches(code, term, matchBy))
}

function parseCurrentTimeMs(currentTime?: string | null): number {
  if (!currentTime) return Date.now()
  const normalized = currentTime.endsWith('Z') ? currentTime : `${currentTime}Z`
  const parsed = Date.parse(normalized)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

function estaDentroDeHoras(envio: EnvioEstado, horas?: number, currentTime?: string | null): boolean {
  if (!horas || envio.estado !== 'ENTREGADO') return true
  if (!envio.ultimaLlegadaUtc) return false

  const llegadaMs = Date.parse(envio.ultimaLlegadaUtc)
  if (Number.isNaN(llegadaMs)) return false

  const referenciaMs = parseCurrentTimeMs(currentTime)

  const diffMs = referenciaMs - llegadaMs
  return diffMs >= 0 && diffMs <= horas * 60 * 60 * 1000
}

function matchesPersistentFilters(
  envio: EnvioEstado,
  originFilter: string,
  destinationFilter: string,
  filterScope: FilterScope,
  filterMatchBy: FilterMatchBy,
): boolean {
  const originMatches = !originFilter || (
    filterScope === 'directo'
      ? airportMatches(envio.origen, originFilter, filterMatchBy)
      : routeMatches(envio.rutaAeropuertos, originFilter, filterMatchBy)
  )
  if (!originMatches) return false

  const destinationMatches = !destinationFilter || (
    filterScope === 'directo'
      ? airportMatches(envio.destino, destinationFilter, filterMatchBy)
      : routeMatches(envio.rutaAeropuertos, destinationFilter, filterMatchBy)
  )
  return destinationMatches
}

export default function EnvioListPanel({
  onEnvioSelect,
  selectedEnvioId,
  selectedEnvio,
  selectedEnvioRouteMode = 'actual',
  onSelectedEnvioRouteModeChange,
  onClearSelectedEnvio,
  enviosExternos,
  currentTime,
  onViewMaletasForEnvio,
  onIrAVuelo,
  maletasExternas = [],
  selectedMaletaId,
  onMaletaSelect,
  onVisibleFlightsChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('pendientes')
  const [searchOrigin, setSearchOrigin] = useState('')
  const [searchDestination, setSearchDestination] = useState('')
  const [searchId, setSearchId] = useState('')
  const [searchOriginMatchBy, setSearchOriginMatchBy] = useState<FilterMatchBy>('ciudad')
  const [searchDestinationMatchBy, setSearchDestinationMatchBy] = useState<FilterMatchBy>('ciudad')
  const [filterScope, setFilterScope] = useState<FilterScope>('directo')
  const [filterMatchBy, setFilterMatchBy] = useState<FilterMatchBy>('ciudad')
  const [originFilter, setOriginFilter] = useState('')
  const [destinationFilter, setDestinationFilter] = useState('')
  const [idFilter, setIdFilter] = useState('')
  const [searchCollapsed, setSearchCollapsed] = useState(false)
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [envios, setEnvios] = useState<EnvioEstado[]>([])
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const pollingRef = useRef(false)
  const mountedRef = useRef(true)

  const config = TAB_CONFIG.find((c) => c.key === tab)!
  const currentMainTab: MainTab = tab === 'pendientes' ? 'almacen' : tab
  const enviosBase = enviosExternos ?? envios
  const deferredSearchOrigin = useDeferredValue(searchOrigin)
  const deferredSearchDestination = useDeferredValue(searchDestination)
  const deferredSearchId = useDeferredValue(searchId)
  const searchOriginTerm = normalizeSearch(deferredSearchOrigin)
  const searchDestinationTerm = normalizeSearch(deferredSearchDestination)
  const searchIdTerm = normalizeSearch(deferredSearchId)
  const hasPanelSearch = Boolean(searchOriginTerm || searchDestinationTerm || searchIdTerm)
  const hasFilters = Boolean(originFilter || destinationFilter || idFilter)
  const enviosConFiltrosPersistentes = enviosBase.filter((envio) => (
    matchesPersistentFilters(envio, originFilter, destinationFilter, filterScope, filterMatchBy)
  ))
  const visibleFlightIdsFromFilters = Array.from(new Set(
    enviosConFiltrosPersistentes.flatMap((envio) => (
      [envio.vueloActual, envio.vueloEsperado, envio.ultimoVuelo].filter((flightId): flightId is string => Boolean(flightId))
    )),
  ))
  const countsByTab: Record<Tab, number> = {
    pendientes: enviosConFiltrosPersistentes.filter((e) => isStorageState(e.estado)).length,
    envuelo: enviosConFiltrosPersistentes.filter((e) => e.estado === 'EN_VUELO').length,
    entregados: enviosConFiltrosPersistentes.filter((e) => e.estado === 'ENTREGADO' && estaDentroDeHoras(e, 4, currentTime)).length,
  }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (enviosExternos) {
      setEnvios(enviosExternos)
      setLoading(false)
      return
    }
    const fetch = async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      setLoading(true)
      try {
        const horasFiltro = tab === 'entregados' && showAll ? undefined : config.horas
        const res = await cargaArchivosService.listarEnvios(config.estados, undefined, horasFiltro)
        if (mountedRef.current) setEnvios(res.envios)
      } catch {
        // ignore
      } finally {
        if (mountedRef.current) setLoading(false)
        pollingRef.current = false
      }
    }
    fetch()
    const interval = setInterval(fetch, 15000)
    return () => clearInterval(interval)
  }, [tab, enviosExternos, showAll])

  useEffect(() => { setShowAll(false) }, [tab])

  useEffect(() => {
    if (countsByTab[tab] > 0) return

    if (countsByTab.pendientes > 0) {
      setTab('pendientes')
    } else if (countsByTab.envuelo > 0) {
      setTab('envuelo')
    } else if (countsByTab.entregados > 0) {
      setTab('entregados')
    }
  }, [countsByTab.pendientes, countsByTab.envuelo, countsByTab.entregados, tab])

  const enviosVisibles = enviosConFiltrosPersistentes.filter((e) => {
    if (tab === 'pendientes') return isStorageState(e.estado)
    if (e.estado !== config.estados) return false
    if (tab === 'entregados' && !showAll) {
      return estaDentroDeHoras(e, config.horas, currentTime)
    }
    return true
  })
  const tabCounts: Record<Tab, number> = countsByTab
  const mainTabCounts: Record<MainTab, number> = {
    almacen: tabCounts.pendientes,
    envuelo: tabCounts.envuelo,
    entregados: tabCounts.entregados,
  }
  const enviosConFiltrosCompletos = enviosVisibles.filter((envio) => {
    if (idFilter && !normalizeSearch(envio.id).includes(normalizeSearch(idFilter))) return false
    return true
  })
  const filtradosSinLimite = enviosConFiltrosCompletos.filter((envio) => {
    if (searchIdTerm && !normalizeSearch(envio.id).includes(searchIdTerm)) return false
    if (searchOriginTerm && !airportMatches(envio.origen, searchOriginTerm, searchOriginMatchBy)) return false
    if (searchDestinationTerm && !airportMatches(envio.destino, searchDestinationTerm, searchDestinationMatchBy)) return false
    return true
  })
  const filtrados = showAll || hasPanelSearch ? filtradosSinLimite : filtradosSinLimite.slice(0, DEFAULT_LIMIT)

  useEffect(() => {
    if (!onVisibleFlightsChange) return
    if (!hasFilters) {
      onVisibleFlightsChange(null)
      return
    }

    const timeoutId = window.setTimeout(() => {
      onVisibleFlightsChange(visibleFlightIdsFromFilters)
    }, 120)

    return () => window.clearTimeout(timeoutId)
  }, [hasFilters, onVisibleFlightsChange, visibleFlightIdsFromFilters])

  const estadoLabel: Record<string, string> = {
    EN_ESPERA: 'En espera',
    EMBARCADO: 'En espera',
    EN_VUELO: 'En vuelo',
    ENTREGADO: 'Entregado',
  }

  const estadoColor: Record<string, string> = {
    EN_ESPERA: 'text-amber-400 bg-amber-400/10',
    EMBARCADO: 'text-amber-400 bg-amber-400/10',
    EN_VUELO: 'text-emerald-400 bg-emerald-400/10',
    ENTREGADO: 'text-gray-400 bg-gray-400/10',
  }

  return (
    <div className="w-96 flex-1 min-h-0 bg-gray-900 border border-gray-800 rounded-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-violet-200 mb-2">Envíos</h3>
        <div className="space-y-1.5">
          <div>
            <button onClick={() => setSearchCollapsed((v) => !v)} className="flex w-full items-center justify-between gap-2 mb-1.5 cursor-pointer">
              <p className="text-[10px] font-medium uppercase tracking-wide text-violet-300">Búsqueda en panel</p>
              <span className={`text-gray-500 text-[10px] transition-transform ${searchCollapsed ? '' : 'rotate-180'}`}>▼</span>
            </button>
            {!searchCollapsed && (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  <select
                    value={searchOriginMatchBy}
                    onChange={(e) => setSearchOriginMatchBy(e.target.value as FilterMatchBy)}
                    className="w-[92px] bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                  >
                    <option value="codigo">Código</option>
                    <option value="ciudad">Ciudad</option>
                    <option value="pais">País</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Búsqueda por origen"
                    value={searchOrigin}
                    onChange={(e) => setSearchOrigin(e.target.value)}
                    className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex gap-1.5">
                  <select
                    value={searchDestinationMatchBy}
                    onChange={(e) => setSearchDestinationMatchBy(e.target.value as FilterMatchBy)}
                    className="w-[92px] bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                  >
                    <option value="codigo">Código</option>
                    <option value="ciudad">Ciudad</option>
                    <option value="pais">País</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Búsqueda por destino"
                    value={searchDestination}
                    onChange={(e) => setSearchDestination(e.target.value)}
                    className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Búsqueda por ID"
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                />
                {hasPanelSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchOrigin('')
                      setSearchDestination('')
                      setSearchId('')
                    }}
                    className="text-[9px] text-sky-400 hover:text-sky-300"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="pt-2 border-t border-gray-800/80">
            <button onClick={() => setFiltersCollapsed((v) => !v)} className="flex w-full items-center justify-between gap-2 mb-1.5 cursor-pointer">
              <p className="text-[10px] font-medium uppercase tracking-wide text-violet-300">Filtros persistentes</p>
              <span className={`text-gray-500 text-[10px] transition-transform ${filtersCollapsed ? '' : 'rotate-180'}`}>▼</span>
            </button>
            {!filtersCollapsed && (
              <div className="space-y-1.5">
                {hasFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setOriginFilter('')
                      setDestinationFilter('')
                      setIdFilter('')
                    }}
                    className="text-[9px] text-sky-400 hover:text-sky-300"
                  >
                    Limpiar filtros
                  </button>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={filterScope}
                    onChange={(e) => setFilterScope(e.target.value as FilterScope)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                  >
                    <option value="directo">Filtrar en tramo</option>
                    <option value="ruta">Filtrar en ruta</option>
                  </select>
                  <select
                    value={filterMatchBy}
                    onChange={(e) => setFilterMatchBy(e.target.value as FilterMatchBy)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none focus:border-sky-500"
                  >
                    <option value="codigo">Código</option>
                    <option value="ciudad">Ciudad</option>
                    <option value="pais">País</option>
                  </select>
                  <input
                    type="text"
                    value={originFilter}
                    onChange={(e) => setOriginFilter(e.target.value)}
                    placeholder="Filtrar origen"
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                  />
                  <input
                    type="text"
                    value={destinationFilter}
                    onChange={(e) => setDestinationFilter(e.target.value)}
                    placeholder="Filtrar destino"
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                  />
                  <input
                    type="text"
                    value={idFilter}
                    onChange={(e) => setIdFilter(e.target.value)}
                    placeholder="Filtrar ID"
                    className="col-span-2 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-800">
        <div className="flex">
          {MAIN_TAB_CONFIG.map((main) => (
            <button
              key={main.key}
              onClick={() => {
                if (main.key === 'almacen') {
                  setTab('pendientes')
                  return
                }
                setTab(main.key)
              }}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                currentMainTab === main.key
                  ? 'text-sky-400 border-b-2 border-sky-400 bg-sky-400/5'
                  : 'text-violet-300/80 hover:text-violet-200 hover:bg-gray-800/50'
              }`}
            >
              {main.label}
              <span className="ml-1 text-[10px] text-gray-500">({mainTabCounts[main.key]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {selectedEnvio && (
          <EnvioDetailCard
            envio={selectedEnvio}
            routeMode={selectedEnvioRouteMode}
            onRouteModeChange={onSelectedEnvioRouteModeChange}
            onClose={onClearSelectedEnvio}
            onIrAVuelo={onIrAVuelo}
            maletas={maletasExternas}
            selectedMaletaId={selectedMaletaId}
            onMaletaSelect={onMaletaSelect}
          />
        )}

        {loading && envios.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtrados.length === 0 && (
          <p className="text-center text-xs text-gray-500 py-8">
            {hasPanelSearch || hasFilters ? 'No se encontraron envíos' : 'No hay envíos en esta categoría'}
          </p>
        )}

        {filtrados.map((envio) => {
          const isSelected = envio.id === selectedEnvioId
          const ut = envio.vueloActual || envio.vueloEsperado || envio.ultimoVuelo
          return (
            <div key={envio.id} className="border-b border-gray-800/50">
              <button
                onClick={() => onEnvioSelect(envio)}
                className={`w-full text-left px-3 py-2 transition-colors hover:bg-gray-800/50 ${
                  isSelected ? 'bg-sky-900/20 border-l-2 border-l-sky-500' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-violet-300 truncate">
                      <span className="font-medium text-violet-200">{getAirportCity(envio.origen) || envio.origen}</span>
                      <span className="text-gray-600 mx-1">→</span>
                      <span className="font-medium text-violet-200">{getAirportCity(envio.destino) || envio.destino}</span>
                    </div>
                    {ut && (
                      <div className="text-[10px] text-violet-300/80 mt-0.5 truncate">
                        UT: {ut}
                      </div>
                    )}
                    <div className="text-[10px] text-violet-300/80">
                      {envio.cantidad} maleta{envio.cantidad !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${estadoColor[envio.estado] || 'text-gray-500'}`}>
                    {estadoLabel[envio.estado] || envio.estado}
                  </span>
                </div>
              </button>
              <div className="px-3 pb-2">
                <button
                  type="button"
                  onClick={() => onViewMaletasForEnvio?.(envio.id)}
                  className="text-[10px] text-violet-300 hover:text-violet-200"
                >
                  Ver maletas del envio ({envio.cantidad})
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-gray-800 text-[10px] text-gray-600 flex justify-between items-center">
        <span>Mostrando {filtrados.length} de {enviosVisibles.length}</span>
        <div className="flex items-center gap-2">
          {tab === 'entregados' ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowAll(false)}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  !showAll
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    : 'bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-300'
                }`}
              >
                Ultimas 4h
              </button>
              <button
                onClick={() => setShowAll(true)}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  showAll
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    : 'bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-300'
                }`}
              >
                Mostrar todos
              </button>
            </div>
          ) : (
            !showAll && !hasPanelSearch && enviosVisibles.length > DEFAULT_LIMIT && (
            <button onClick={() => setShowAll(true)} className="text-sky-400 hover:text-sky-300 font-medium cursor-pointer">
              Mostrar todos
            </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
