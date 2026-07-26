import { useMemo, useState } from 'react'
import type { AeropuertoDTO, VueloDTO, EnvioEstado, MaletaEstado } from '../types'
import { buildAirportLookup, getAirportCityCountryResolved } from '../data/airportsData'
import { formatTimeInTimezone, formatDateInTimezone } from '../utils/timezoneFormat'
import { getDisplayedFlightLoad, getMaletasForVuelo } from '../utils/flightLoad'

interface Props {
  vuelo: VueloDTO
  tzOffset: number | string
  aeropuertos?: AeropuertoDTO[]
  envios?: EnvioEstado[]
  maletas?: MaletaEstado[]
  onEnvioSelect?: (envio: EnvioEstado) => void
  selectedEnvioId?: string | null
  onClear?: () => void
}

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

function envioIncluyeVuelo(envio: EnvioEstado, vueloId: string): boolean {
  const flightIds = new Set<string>()
  ;[envio.vueloActual, envio.vueloEsperado, envio.ultimoVuelo].forEach((id) => {
    if (id) flightIds.add(id)
  })
  ;(envio.rutaVuelos || []).forEach((id) => {
    if (id) flightIds.add(id)
  })
  ;(envio.rutaAnteriorVuelos || []).forEach((id) => {
    if (id) flightIds.add(id)
  })
  return flightIds.has(vueloId)
}

export default function VueloDetailCard({
  vuelo,
  tzOffset,
  aeropuertos = [],
  envios = [],
  maletas = [],
  onEnvioSelect,
  selectedEnvioId,
  onClear,
}: Props) {
  const airportLookup = buildAirportLookup(aeropuertos)
  const origenInfo = getAirportCityCountryResolved(vuelo.origen, airportLookup)
  const destinoInfo = getAirportCityCountryResolved(vuelo.destino, airportLookup)
  const [enviosExpanded, setEnviosExpanded] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const enviosPorRuta = useMemo(() => {
    return envios.filter((envio) => envioIncluyeVuelo(envio, vuelo.id))
  }, [envios, vuelo.id])
  const maletasDelVuelo = useMemo(() => {
    return getMaletasForVuelo(vuelo, maletas)
  }, [maletas, vuelo])
  const enviosDelVuelo = useMemo(() => {
    if (maletasDelVuelo.length === 0) return enviosPorRuta

    const enviosIndexados = new Map(envios.map((envio) => [envio.id, envio]))
    const enviosUnicos = new Map<string, EnvioEstado>()

    maletasDelVuelo.forEach((maleta) => {
      const envio = enviosIndexados.get(maleta.envioId)
      if (envio) enviosUnicos.set(envio.id, envio)
    })

    return Array.from(enviosUnicos.values())
  }, [envios, enviosPorRuta, maletasDelVuelo])
  const enviosFiltrados = useMemo(() => {
    if (!searchTerm) return enviosDelVuelo
    const term = searchTerm.toLowerCase()
    return enviosDelVuelo.filter((envio) =>
      envio.id.toLowerCase().includes(term)
      || getAirportCityCountryResolved(envio.origen, airportLookup).toLowerCase().includes(term)
      || getAirportCityCountryResolved(envio.destino, airportLookup).toLowerCase().includes(term)
    )
  }, [enviosDelVuelo, searchTerm, airportLookup])
  const totalMaletas = maletasDelVuelo.length > 0
    ? maletasDelVuelo.length
    : enviosDelVuelo.reduce((sum, envio) => sum + envio.cantidad, 0)
  const cargaMostrada = getDisplayedFlightLoad(vuelo, maletas)
  const maletasPorEnvio = useMemo(() => {
    if (maletasDelVuelo.length === 0) return new Map<string, number>()

    const counts = new Map<string, number>()
    maletasDelVuelo.forEach((maleta) => {
      counts.set(maleta.envioId, (counts.get(maleta.envioId) ?? 0) + 1)
    })
    return counts
  }, [maletasDelVuelo])

  return (
    <div className="rounded-xl border border-violet-700/60 bg-violet-950/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-violet-300">Vuelo seleccionado</h4>
          <p className="text-[10px] font-mono text-violet-200">{vuelo.id}</p>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-lg leading-none text-gray-400 transition-colors hover:text-white"
            aria-label="Cerrar detalle de vuelo"
          >
            &times;
          </button>
        )}
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between gap-3">
          <span className="text-gray-400">Estado</span>
          <span className={`font-semibold ${
            vuelo.estado === 'CANCELADO'
              ? 'text-red-400'
              : vuelo.estado === 'ACTIVO'
                ? 'text-emerald-400'
                : vuelo.estado === 'PROGRAMADO'
                  ? 'text-sky-400'
                  : 'text-gray-300'
          }`}>
            {vuelo.estado || 'SIN ESTADO'}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-gray-400">Origen</span>
          <span className="text-right font-medium text-emerald-400">{origenInfo}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-gray-400">Salida</span>
          <span className="text-right font-medium">
            {formatDateInTimezone(vuelo.salidaUtc, tzOffset)} {formatTimeInTimezone(vuelo.salidaUtc, tzOffset)}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-gray-400">Destino</span>
          <span className="text-right font-medium text-red-400">{destinoInfo}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-gray-400">Llegada</span>
          <span className="text-right font-medium">
            {formatDateInTimezone(vuelo.llegadaUtc, tzOffset)} {formatTimeInTimezone(vuelo.llegadaUtc, tzOffset)}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-gray-400">Maletas a bordo</span>
          <span className="font-medium text-amber-400">{cargaMostrada} / {vuelo.capacidad}</span>
        </div>
        <div className="flex justify-between gap-3 pt-1">
          <span className="text-gray-400">Progreso de vuelo</span>
          <span className="font-medium text-sky-400">{Math.round(vuelo.progresoVuelo)}%</span>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-gray-700">
        <button
          type="button"
          onClick={() => setEnviosExpanded((current) => !current)}
          className="flex w-full items-center justify-between rounded-t-lg px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800"
        >
          <span>Envíos transportados ({enviosDelVuelo.length}) · {totalMaletas} maletas</span>
          <span>{enviosExpanded ? '▼' : '▶'}</span>
        </button>
        {enviosExpanded && (
          <div className="space-y-1 px-3 pb-2">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar envío transportado..."
              className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900/70 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none"
            />
            {enviosFiltrados.length === 0 ? (
              <p className="pt-1 text-xs text-gray-500">Este vuelo no traslada envíos visibles.</p>
            ) : enviosFiltrados.map((envio) => {
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
                      <div className="truncate text-[10px] font-medium text-gray-300">{envio.id}</div>
                      <div className="truncate text-[10px] text-gray-500">
                        {getAirportCityCountryResolved(envio.origen, airportLookup)} -&gt; {getAirportCityCountryResolved(envio.destino, airportLookup)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="whitespace-nowrap text-[10px] text-amber-400">
                        {maletasPorEnvio.get(envio.id) ?? envio.cantidad} maleta{(maletasPorEnvio.get(envio.id) ?? envio.cantidad) !== 1 ? 's' : ''}
                      </span>
                      <span className={`whitespace-nowrap rounded-full px-1 py-0.5 text-[9px] font-medium ${estadoColor[envio.estado] || 'text-gray-500'}`}>
                        {estadoLabel[envio.estado] || envio.estado}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
