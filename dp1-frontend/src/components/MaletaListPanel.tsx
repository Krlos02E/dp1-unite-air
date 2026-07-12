import { useEffect, useRef, useState } from 'react'
import { cargaArchivosService } from '../services/CargaArchivosService'
import { getAirportCity } from '../data/airportsData'
import type { MaletaEstado } from '../types'
import MaletaDetailCard from './MaletaDetailCard'

type Tab = 'pendientes' | 'planificados' | 'envuelo' | 'entregados'
type MainTab = 'almacen' | 'envuelo' | 'entregados'

const TAB_CONFIG: { key: Tab; label: string; estados: string; horas?: number }[] = [
  { key: 'envuelo', label: 'En vuelo', estados: 'EN_VUELO' },
  { key: 'planificados', label: 'Embarcado', estados: 'EMBARCADO' },
  { key: 'pendientes', label: 'Pendiente', estados: 'EN_ESPERA' },
  { key: 'entregados', label: 'Entregadas', estados: 'ENTREGADO', horas: 4 },
]

const MAIN_TAB_CONFIG: { key: MainTab; label: string }[] = [
  { key: 'almacen', label: 'En almacén' },
  { key: 'envuelo', label: 'En vuelo' },
  { key: 'entregados', label: 'Entregadas' },
]

interface Props {
  onMaletaSelect: (maleta: MaletaEstado) => void
  selectedMaletaId?: string | null
  selectedMaleta?: MaletaEstado | null
  selectedMaletaRouteMode?: 'actual' | 'anterior'
  onSelectedMaletaRouteModeChange?: (mode: 'actual' | 'anterior') => void
  onClearSelectedMaleta?: () => void
  maletasExternas?: MaletaEstado[]
  currentTime?: string | null
  filterEnvioId?: string | null
  onClearEnvioFilter?: () => void
  onIrAVuelo?: (vueloId: string) => void
}

const DEFAULT_LIMIT = 50

function parseCurrentTimeMs(currentTime?: string | null): number {
  if (!currentTime) return Date.now()
  const normalized = currentTime.endsWith('Z') ? currentTime : `${currentTime}Z`
  const parsed = Date.parse(normalized)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

function estaDentroDeHoras(maleta: MaletaEstado, horas?: number, currentTime?: string | null): boolean {
  if (!horas || maleta.estado !== 'ENTREGADO') return true
  if (!maleta.ultimaLlegadaUtc) return false
  const llegadaMs = Date.parse(maleta.ultimaLlegadaUtc)
  const referenciaMs = parseCurrentTimeMs(currentTime)
  if (Number.isNaN(llegadaMs) || Number.isNaN(referenciaMs)) return false
  const diffMs = referenciaMs - llegadaMs
  return diffMs >= 0 && diffMs <= horas * 60 * 60 * 1000
}

export default function MaletaListPanel({
  onMaletaSelect,
  selectedMaletaId,
  selectedMaleta,
  selectedMaletaRouteMode = 'actual',
  onSelectedMaletaRouteModeChange,
  onClearSelectedMaleta,
  maletasExternas,
  currentTime,
  filterEnvioId = null,
  onClearEnvioFilter,
  onIrAVuelo,
}: Props) {
  const [tab, setTab] = useState<Tab>('pendientes')
  const [search, setSearch] = useState('')
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [maletas, setMaletas] = useState<MaletaEstado[]>([])
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const pollingRef = useRef(false)
  const mountedRef = useRef(true)

  const config = TAB_CONFIG.find((c) => c.key === tab)!
  const currentMainTab: MainTab = tab === 'pendientes' || tab === 'planificados' ? 'almacen' : tab
  const sourceMaletas = maletasExternas ?? maletas
  const maletasFiltrables = filterEnvioId
    ? sourceMaletas.filter((m) => m.envioId === filterEnvioId)
    : sourceMaletas

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (maletasExternas) {
      setMaletas(maletasExternas)
      setLoading(false)
      return
    }
    const fetch = async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      setLoading(true)
      try {
        const horasFiltro = tab === 'entregados' && showAll ? undefined : config.horas
        const res = await cargaArchivosService.listarMaletas(config.estados, undefined, horasFiltro)
        if (mountedRef.current) setMaletas(res.maletas)
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
  }, [tab, maletasExternas, showAll])

  useEffect(() => { setShowAll(false) }, [tab])

  useEffect(() => {
    const counts: Record<Tab, number> = {
      pendientes: maletasFiltrables.filter((m) => m.estado === 'EN_ESPERA').length,
      planificados: maletasFiltrables.filter((m) => m.estado === 'EMBARCADO').length,
      envuelo: maletasFiltrables.filter((m) => m.estado === 'EN_VUELO').length,
      entregados: maletasFiltrables.filter((m) =>
        m.estado === 'ENTREGADO' && estaDentroDeHoras(m, 4, currentTime)
      ).length,
    }

    if (counts[tab] > 0) return

    if (counts.pendientes > 0) {
      setTab('pendientes')
    } else if (counts.planificados > 0) {
      setTab('planificados')
    } else if (counts.envuelo > 0) {
      setTab('envuelo')
    } else if (counts.entregados > 0) {
      setTab('entregados')
    }
  }, [maletasFiltrables, currentTime, tab])

  const maletasVisibles = maletasFiltrables.filter((m) => {
        if (m.estado !== config.estados) return false
        if (tab === 'entregados' && !showAll) {
          return estaDentroDeHoras(m, config.horas, currentTime)
        }
        return true
      })
  const tabCounts: Record<Tab, number> = {
    pendientes: maletasFiltrables.filter((m) => m.estado === 'EN_ESPERA').length,
    planificados: maletasFiltrables.filter((m) => m.estado === 'EMBARCADO').length,
    envuelo: maletasFiltrables.filter((m) => m.estado === 'EN_VUELO').length,
    entregados: maletasFiltrables.filter((m) => m.estado === 'ENTREGADO' && estaDentroDeHoras(m, 4, currentTime)).length,
  }
  const mainTabCounts: Record<MainTab, number> = {
    almacen: tabCounts.pendientes + tabCounts.planificados,
    envuelo: tabCounts.envuelo,
    entregados: tabCounts.entregados,
  }
  const term = search.toLowerCase().trim()
  const filtradasBase = term
    ? maletasVisibles.filter((m) => (
      m.id.toLowerCase().includes(term)
      || m.envioId.toLowerCase().includes(term)
      || m.origen.toLowerCase().includes(term)
      || m.destino.toLowerCase().includes(term)
      || (getAirportCity(m.origen) || '').toLowerCase().includes(term)
      || (getAirportCity(m.destino) || '').toLowerCase().includes(term)
    ))
    : maletasVisibles
  const filtradas = showAll || term ? filtradasBase : filtradasBase.slice(0, DEFAULT_LIMIT)

  return (
    <div className="w-96 flex-1 min-h-0 bg-gray-900 border border-gray-800 rounded-xl flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-800">
        <button onClick={() => setFiltersCollapsed((v) => !v)} className="flex w-full items-center justify-between gap-2 mb-2 cursor-pointer">
          <h3 className="text-sm font-semibold text-violet-200">Maletas</h3>
          <span className={`text-gray-500 text-xs transition-transform ${filtersCollapsed ? '' : 'rotate-180'}`}>▼</span>
        </button>
        {!filtersCollapsed && (
          <>
            {filterEnvioId && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1.5">
                <span className="truncate text-[10px] text-sky-300">Filtrando por envio {filterEnvioId}</span>
                <button
                  type="button"
                  onClick={onClearEnvioFilter}
                  className="shrink-0 text-[10px] text-sky-400 hover:text-sky-300"
                >
                  Limpiar
                </button>
              </div>
            )}
            <input
              type="text"
              placeholder={filterEnvioId ? 'Buscar por ID de maleta...' : 'Buscar por ID de maleta o envío...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500"
            />
          </>
        )}
      </div>

      <div className="border-b border-gray-800">
        <div className="flex">
          {MAIN_TAB_CONFIG.map((main) => (
            <button
              key={main.key}
              onClick={() => {
                if (main.key === 'almacen') {
                  setTab((current) => (
                    current === 'pendientes' || current === 'planificados'
                      ? current
                      : (tabCounts.pendientes > 0 ? 'pendientes' : 'planificados')
                  ))
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
        {currentMainTab === 'almacen' && (
          <div className="flex gap-1 px-3 py-2 bg-gray-900/70">
            {(['pendientes', 'planificados'] as const).map((subtab) => {
              const isActive = tab === subtab
              const label = TAB_CONFIG.find((entry) => entry.key === subtab)?.label || subtab
              return (
                <button
                  key={subtab}
                  onClick={() => setTab(subtab)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    isActive
                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                      : 'bg-gray-800 text-violet-300/80 border border-gray-700 hover:text-violet-200'
                  }`}
                >
                  {label}
                  <span className="ml-1">({tabCounts[subtab]})</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedMaleta && (
          <MaletaDetailCard
            maleta={selectedMaleta}
            routeMode={selectedMaletaRouteMode}
            onRouteModeChange={onSelectedMaletaRouteModeChange}
            onClose={onClearSelectedMaleta}
            onIrAVuelo={onIrAVuelo}
          />
        )}

        {loading && maletas.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtradas.length === 0 && (
          <p className="text-center text-xs text-gray-500 py-8">
            {term ? 'No se encontraron maletas' : filterEnvioId ? 'No hay maletas para este envio en esta categoria' : 'No hay maletas en esta categoría'}
          </p>
        )}

        {filtradas.map((maleta) => {
          const isSelected = maleta.id === selectedMaletaId
          const ut = maleta.vueloActual || maleta.vueloEsperado
          return (
            <button
              key={maleta.id}
              onClick={() => onMaletaSelect(maleta)}
              className={`w-full text-left px-3 py-2 border-b border-gray-800/50 transition-colors hover:bg-gray-800/50 ${
                isSelected ? 'bg-sky-900/20 border-l-2 border-l-sky-500' : ''
              }`}
            >
              <div className="text-[11px] font-semibold text-amber-300 truncate">{maleta.id}</div>
              <div className="text-[10px] text-violet-300/80 truncate">Envío: {maleta.envioId}</div>
              <div className="text-xs text-violet-300 truncate mt-1">
                <span className="font-medium text-violet-200">{getAirportCity(maleta.origen) || maleta.origen}</span>
                <span className="text-gray-600 mx-1">→</span>
                <span className="font-medium text-violet-200">{getAirportCity(maleta.destino) || maleta.destino}</span>
              </div>
              <div className="text-[10px] text-violet-300/80 truncate mt-0.5">
                Subruta {maleta.subrutaIndex || 1}{ut ? ` · UT ${ut}` : ''}
              </div>
            </button>
          )
        })}
      </div>

      <div className="px-3 py-1.5 border-t border-gray-800 text-[10px] text-gray-600 flex justify-between items-center">
        <span>Mostrando {filtradas.length} de {maletasVisibles.length}</span>
        {tab === 'entregados' ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowAll(false)}
              className={`px-2 py-0.5 rounded-full font-medium transition-colors ${!showAll ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40' : 'bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-300'}`}
            >
              Ultimas 4h
            </button>
            <button
              onClick={() => setShowAll(true)}
              className={`px-2 py-0.5 rounded-full font-medium transition-colors ${showAll ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40' : 'bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-300'}`}
            >
              Mostrar todas
            </button>
          </div>
        ) : (
          !showAll && !term && maletasVisibles.length > DEFAULT_LIMIT && (
            <button onClick={() => setShowAll(true)} className="text-sky-400 hover:text-sky-300 font-medium cursor-pointer">
              Mostrar todas
            </button>
          )
        )}
      </div>
    </div>
  )
}
