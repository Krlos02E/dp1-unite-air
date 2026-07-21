import { useMemo, useState } from 'react'
import type { AeropuertoDTO, EnvioEstado, VueloDTO } from '../types'
import {
  buildAirportLookup,
  getAirportCityCountryResolved,
  getAirportCityResolved,
  getAirportCountryResolved,
} from '../data/airportsData'
import { formatDateInTimezone, formatTimeInTimezone } from '../utils/timezoneFormat'

interface Props {
  aeropuerto: AeropuertoDTO
  vuelos?: VueloDTO[]
  envios?: EnvioEstado[]
  tzOffset: number | string
  aeropuertos?: AeropuertoDTO[]
  onVueloSelect?: (vuelo: VueloDTO) => void
  onEnvioSelect?: (envio: EnvioEstado) => void
  selectedEnvioId?: string | null
  onClear?: () => void
}

type SectionKey =
  | 'envios-almacen'
  | 'maletas-almacen'
  | 'envios-entrada'
  | 'maletas-entrada'
  | 'envios-salida'
  | 'maletas-salida'

function getRouteIndex(envio: EnvioEstado, airportCode: string): number {
  return (envio.rutaAeropuertos || []).indexOf(airportCode)
}

function getCurrentFlightId(envio: EnvioEstado): string | null {
  return envio.vueloActual || envio.vueloEsperado || envio.ultimoVuelo || null
}

export default function AeropuertoDetailCard({
  aeropuerto,
  vuelos = [],
  envios = [],
  tzOffset,
  onVueloSelect,
  onEnvioSelect,
  selectedEnvioId,
  onClear,
  aeropuertos = [],
}: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedSection, setExpandedSection] = useState<SectionKey | null>(null)
  const [expandedEnvioId, setExpandedEnvioId] = useState<string | null>(null)

  const airportLookup = useMemo(() => buildAirportLookup(aeropuertos), [aeropuertos])
  const ciudad = getAirportCityResolved(aeropuerto.codigoOACI, airportLookup) || aeropuerto.ciudad || ''
  const pais = getAirportCountryResolved(aeropuerto.codigoOACI, airportLookup) || aeropuerto.pais || ''

  const vuelosMap = useMemo(() => {
    const map = new Map<string, VueloDTO>()
    vuelos.forEach((vuelo) => map.set(vuelo.id, vuelo))
    return map
  }, [vuelos])

  const enviosEnAlmacen = useMemo(
    () => envios.filter((envio) => envio.aeropuertoActual === aeropuerto.codigoOACI),
    [envios, aeropuerto.codigoOACI],
  )

  const enviosPlaneadosEntrada = useMemo(
    () => envios.filter((envio) => {
      if (envio.aeropuertoActual === aeropuerto.codigoOACI) return false
      const currentIndex = getRouteIndex(envio, envio.aeropuertoActual)
      const targetIndex = getRouteIndex(envio, aeropuerto.codigoOACI)
      return currentIndex >= 0 && targetIndex > currentIndex
    }),
    [envios, aeropuerto.codigoOACI],
  )

  const enviosPlaneadosSalida = useMemo(
    () => envios.filter((envio) => {
      if (envio.aeropuertoActual !== aeropuerto.codigoOACI) return false
      const currentIndex = getRouteIndex(envio, aeropuerto.codigoOACI)
      const route = envio.rutaAeropuertos || []
      return currentIndex >= 0 && currentIndex < route.length - 1
    }),
    [envios, aeropuerto.codigoOACI],
  )

  const maletasEnAlmacen = useMemo(
    () => enviosEnAlmacen.reduce((sum, envio) => sum + envio.cantidad, 0),
    [enviosEnAlmacen],
  )

  const maletasPlaneadasEntrada = useMemo(
    () => enviosPlaneadosEntrada.reduce((sum, envio) => sum + envio.cantidad, 0),
    [enviosPlaneadosEntrada],
  )

  const maletasPlaneadasSalida = useMemo(
    () => enviosPlaneadosSalida.reduce((sum, envio) => sum + envio.cantidad, 0),
    [enviosPlaneadosSalida],
  )

  const stockPct = aeropuerto.capacidadMaxima > 0
    ? Math.round((aeropuerto.ocupacionActual / aeropuerto.capacidadMaxima) * 100)
    : 0

  const matchesSearch = (envio: EnvioEstado) => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return true
    return envio.id.toLowerCase().includes(term)
      || getAirportCityCountryResolved(envio.origen, airportLookup).toLowerCase().includes(term)
      || getAirportCityCountryResolved(envio.destino, airportLookup).toLowerCase().includes(term)
  }

  const enviosEnAlmacenFiltrados = useMemo(
    () => enviosEnAlmacen.filter(matchesSearch),
    [enviosEnAlmacen, searchTerm, airportLookup],
  )

  const enviosPlaneadosEntradaFiltrados = useMemo(
    () => enviosPlaneadosEntrada.filter(matchesSearch),
    [enviosPlaneadosEntrada, searchTerm, airportLookup],
  )

  const enviosPlaneadosSalidaFiltrados = useMemo(
    () => enviosPlaneadosSalida.filter(matchesSearch),
    [enviosPlaneadosSalida, searchTerm, airportLookup],
  )

  const toggleSection = (section: SectionKey) => {
    setExpandedSection((prev) => prev === section ? null : section)
    setExpandedEnvioId(null)
  }

  const renderUtInfo = (envio: EnvioEstado) => {
    const flightId = getCurrentFlightId(envio)
    if (!flightId) return null
    const vuelo = vuelosMap.get(flightId)
    if (!vuelo) {
      return <div className="text-[10px] text-gray-500">UT: {flightId}</div>
    }

    return (
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onVueloSelect?.(vuelo)
          }}
          className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300 hover:bg-sky-500/20"
        >
          UT: {flightId}
        </button>
        <span className="text-[10px] text-gray-500">
          {formatDateInTimezone(vuelo.salidaUtc, tzOffset)} {formatTimeInTimezone(vuelo.salidaUtc, tzOffset)}
        </span>
      </div>
    )
  }

  const renderEnvioList = (
    items: EnvioEstado[],
    emptyLabel: string,
    badgeLabel: (envio: EnvioEstado) => string,
    badgeClassName: (envio: EnvioEstado) => string,
    extraLine: (envio: EnvioEstado) => string | null,
  ) => {
    if (items.length === 0) {
      return <p className="text-xs text-gray-500">{emptyLabel}</p>
    }

    return items.map((envio) => {
      const isSelected = envio.id === selectedEnvioId
      return (
        <button
          key={envio.id}
          type="button"
          onClick={() => onEnvioSelect?.(envio)}
          className={`w-full rounded border-t border-gray-800 px-2 py-1.5 text-left transition-colors hover:bg-violet-900/20 ${
            isSelected ? 'bg-sky-900/20 border-l-2 border-l-sky-500' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${badgeClassName(envio)}`}>
                  {badgeLabel(envio)}
                </span>
                <span className="truncate text-[10px] font-medium text-gray-300">{envio.id}</span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-gray-500">
                {getAirportCityCountryResolved(envio.origen, airportLookup)} -&gt; {getAirportCityCountryResolved(envio.destino, airportLookup)}
              </div>
              {extraLine(envio) && (
                <div className="text-[10px] text-gray-500">{extraLine(envio)}</div>
              )}
              {renderUtInfo(envio)}
            </div>
            <span className="whitespace-nowrap text-[10px] text-amber-400">
              {envio.cantidad} maleta{envio.cantidad !== 1 ? 's' : ''}
            </span>
          </div>
        </button>
      )
    })
  }

  
  const renderMaletaList = (items: EnvioEstado[], emptyLabel: string, tagLabel: string) => {
    if (items.length === 0) {
      return <p className="text-xs text-gray-500">{emptyLabel}</p>
    }

    return items.map((envio) => {
      const isExpanded = expandedEnvioId === envio.id
      return (
        <div key={envio.id} className="rounded border-t border-gray-800 bg-gray-900/40">
          <button
            type="button"
            onClick={() => setExpandedEnvioId((prev) => prev === envio.id ? null : envio.id)}
            className="w-full px-2 py-1.5 text-left transition-colors hover:bg-gray-800/70"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-emerald-300/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                    {tagLabel}
                  </span>
                  <span className="truncate text-[10px] font-medium text-gray-300">Envío {envio.id}</span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-gray-500">
                  {getAirportCityCountryResolved(envio.origen, airportLookup)} -&gt; {getAirportCityCountryResolved(envio.destino, airportLookup)}
                </div>
                {renderUtInfo(envio)}
              </div>
              <span className="whitespace-nowrap text-[10px] text-amber-400">
                {envio.cantidad} maleta{envio.cantidad !== 1 ? 's' : ''}
              </span>
            </div>
          </button>
          {isExpanded && (
            <div className="space-y-0.5 px-2 pb-1">
              {Array.from({ length: envio.cantidad }, (_, index) => (
                <div
                  key={`${envio.id}-maleta-${index + 1}`}
                  className="flex justify-between border-t border-gray-800 py-0.5 text-[10px] text-gray-400"
                >
                  <span>Maleta {index + 1}</span>
                  <span className="font-mono text-gray-500">{envio.id}-BAG-{String(index + 1).padStart(3, '0')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    })
  }

  return (
    <div className="rounded-xl border border-violet-700/60 bg-violet-950/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-violet-300">Almacén seleccionado</h4>
          <p className="text-xs font-semibold text-emerald-400">{aeropuerto.codigoOACI}</p>
          <p className="text-[10px] text-gray-400">{ciudad}{pais ? `, ${pais}` : ''}</p>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-lg leading-none text-gray-400 transition-colors hover:text-white"
            aria-label="Cerrar detalle de almacén"
          >
            &times;
          </button>
        )}
      </div>

      <div className="mb-2 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-400">Stock del almacén</span>
          <span className="font-medium text-amber-400">
            {aeropuerto.ocupacionActual} / {aeropuerto.capacidadMaxima} ({stockPct}%)
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Envíos en almacén</span>
          <span className="font-medium text-sky-400">{enviosEnAlmacen.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Maletas en almacén</span>
          <span className="font-medium text-sky-400">{maletasEnAlmacen}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Envíos planificados de entrada</span>
          <span className="font-medium text-emerald-400">{enviosPlaneadosEntrada.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Envíos planificados de salida</span>
          <span className="font-medium text-emerald-400">{enviosPlaneadosSalida.length}</span>
        </div>
      </div>

      <div className="mb-2">
        <input
          type="text"
          placeholder={
            expandedSection === 'envios-almacen'
              ? 'Buscar envío en almacén...'
              : expandedSection === 'maletas-almacen'
                ? 'Buscar maleta en almacén...'
                : expandedSection === 'envios-entrada'
                  ? 'Buscar envío planificado de entrada...'
                  : expandedSection === 'maletas-entrada'
                    ? 'Buscar maleta planificada de entrada...'
                    : expandedSection === 'envios-salida'
                      ? 'Buscar envío planificado de salida...'
                      : expandedSection === 'maletas-salida'
                        ? 'Buscar maleta planificada de salida...'
                        : 'Expandir una sección para buscar...'
          }
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-900/70 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none"
        />
      </div>

      <div className="max-h-[24rem] space-y-1 overflow-y-auto">
        <div className="rounded-lg border border-gray-700">
          <button
            onClick={() => toggleSection('envios-almacen')}
            className="flex w-full items-center justify-between rounded-t-lg px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800"
          >
            <span>Lista de envíos en el almacén ({enviosEnAlmacen.length})</span>
            <span>{expandedSection === 'envios-almacen' ? '▼' : '▶'}</span>
          </button>
          {expandedSection === 'envios-almacen' && (
            <div className="space-y-1 px-3 pb-2">
              {renderEnvioList(
                enviosEnAlmacenFiltrados,
                'No hay envíos en este almacén',
                (envio) => envio.destino === aeropuerto.codigoOACI ? 'Destino final' : 'En tránsito',
                (envio) => envio.destino === aeropuerto.codigoOACI
                  ? 'bg-amber-300/10 text-amber-300'
                  : 'bg-sky-300/10 text-sky-300',
                (envio) => envio.destino === aeropuerto.codigoOACI
                  ? 'Este almacén es el destino final'
                  : 'Este almacén es una escala de tránsito',
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-700">
          <button
            onClick={() => toggleSection('maletas-almacen')}
            className="flex w-full items-center justify-between rounded-t-lg px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800"
          >
            <span>Lista de maletas en el almacén ({maletasEnAlmacen})</span>
            <span>{expandedSection === 'maletas-almacen' ? '▼' : '▶'}</span>
          </button>
          {expandedSection === 'maletas-almacen' && (
            <div className="space-y-1 px-3 pb-2">
              <p className="text-[10px] text-gray-500">
                Cada fila agrupa las maletas de un envío. Al expandirla se muestra la lista individual de maletas.
              </p>
              {renderMaletaList(enviosEnAlmacenFiltrados, 'No hay maletas en este almacén', 'En almacén')}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-700">
          <button
            onClick={() => toggleSection('envios-entrada')}
            className="flex w-full items-center justify-between rounded-t-lg px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800"
          >
            <span>Envíos planificados que entran ({enviosPlaneadosEntrada.length})</span>
            <span>{expandedSection === 'envios-entrada' ? '▼' : '▶'}</span>
          </button>
          {expandedSection === 'envios-entrada' && (
            <div className="space-y-1 px-3 pb-2">
              {renderEnvioList(
                enviosPlaneadosEntradaFiltrados,
                'No hay envíos planificados de entrada',
                (envio) => envio.destino === aeropuerto.codigoOACI ? 'Destino final' : 'Entrada en tránsito',
                (envio) => envio.destino === aeropuerto.codigoOACI
                  ? 'bg-amber-300/10 text-amber-300'
                  : 'bg-emerald-300/10 text-emerald-300',
                (envio) => {
                  const currentStop = getAirportCityCountryResolved(envio.aeropuertoActual, airportLookup)
                  return `Viene desde ${currentStop}`
                },
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-700">
          <button
            onClick={() => toggleSection('maletas-entrada')}
            className="flex w-full items-center justify-between rounded-t-lg px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800"
          >
            <span>Maletas planificadas que entran ({maletasPlaneadasEntrada})</span>
            <span>{expandedSection === 'maletas-entrada' ? '▼' : '▶'}</span>
          </button>
          {expandedSection === 'maletas-entrada' && (
            <div className="space-y-1 px-3 pb-2">
              <p className="text-[10px] text-gray-500">
                Cada fila agrupa las maletas de un envío planificado de entrada.
              </p>
              {renderMaletaList(enviosPlaneadosEntradaFiltrados, 'No hay maletas planificadas de entrada', 'Entrada')}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-700">
          <button
            onClick={() => toggleSection('envios-salida')}
            className="flex w-full items-center justify-between rounded-t-lg px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800"
          >
            <span>Envíos planificados que salen ({enviosPlaneadosSalida.length})</span>
            <span>{expandedSection === 'envios-salida' ? '▼' : '▶'}</span>
          </button>
          {expandedSection === 'envios-salida' && (
            <div className="space-y-1 px-3 pb-2">
              {renderEnvioList(
                enviosPlaneadosSalidaFiltrados,
                'No hay envíos planificados de salida',
                () => 'Salida planificada',
                () => 'bg-violet-300/10 text-violet-300',
                (envio) => {
                  const route = envio.rutaAeropuertos || []
                  const currentIndex = route.indexOf(aeropuerto.codigoOACI)
                  const nextStop = currentIndex >= 0 ? route[currentIndex + 1] : null
                  return nextStop
                    ? `Próxima escala: ${getAirportCityCountryResolved(nextStop, airportLookup)}`
                    : 'Sin próxima escala registrada'
                },
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-700">
          <button
            onClick={() => toggleSection('maletas-salida')}
            className="flex w-full items-center justify-between rounded-t-lg px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800"
          >
            <span>Maletas planificadas que salen ({maletasPlaneadasSalida})</span>
            <span>{expandedSection === 'maletas-salida' ? '▼' : '▶'}</span>
          </button>
          {expandedSection === 'maletas-salida' && (
            <div className="space-y-1 px-3 pb-2">
              <p className="text-[10px] text-gray-500">
                Cada fila agrupa las maletas de un envío planificado de salida.
              </p>
              {renderMaletaList(enviosPlaneadosSalidaFiltrados, 'No hay maletas planificadas de salida', 'Salida')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
