import { useEffect, useMemo, useState } from 'react'
import { getAirportCityCountry } from '../data/airportsData'
import type { EnvioEstado, MaletaEstado } from '../types'

const INITIAL_VISIBLE_BAGS = 50
const VISIBLE_BAGS_STEP = 50

interface Props {
  envio: EnvioEstado
  routeMode?: 'actual' | 'anterior'
  onRouteModeChange?: (mode: 'actual' | 'anterior') => void
  onClose?: () => void
  onIrAVuelo?: (vueloId: string) => void
  maletas?: MaletaEstado[]
  selectedMaletaId?: string | null
  onMaletaSelect?: (maleta: MaletaEstado) => void
  compact?: boolean
}

const estadoLabels: Record<string, { label: string; color: string }> = {
  EN_ESPERA: { label: 'En espera', color: 'text-amber-400' },
  EMBARCADO: { label: 'En espera', color: 'text-amber-400' },
  EN_VUELO: { label: 'En vuelo', color: 'text-emerald-400' },
  ENTREGADO: { label: 'Entregado', color: 'text-gray-400' },
}

const maletaEstadoColors: Record<string, string> = {
  EN_ESPERA: 'text-amber-400 bg-amber-400/10',
  EMBARCADO: 'text-amber-400 bg-amber-400/10',
  EN_VUELO: 'text-emerald-400 bg-emerald-400/10',
  ENTREGADO: 'text-gray-400 bg-gray-400/10',
}

export default function EnvioDetailCard({
  envio,
  routeMode = 'actual',
  onRouteModeChange,
  onClose,
  onIrAVuelo,
  maletas = [],
  selectedMaletaId,
  onMaletaSelect,
  compact = false,
}: Props) {
  const [visibleBagCount, setVisibleBagCount] = useState(INITIAL_VISIBLE_BAGS)
  const estadoInfo = estadoLabels[envio.estado] || { label: envio.estado, color: 'text-gray-400' }
  const origenInfo = getAirportCityCountry(envio.origen)
  const destinoInfo = getAirportCityCountry(envio.destino)
  const aeropuertoInfo = getAirportCityCountry(envio.aeropuertoActual)
  const ultimoVuelo = envio.ultimoVuelo || envio.vueloActual || envio.vueloEsperado
  const ubicacionActualLabel = (() => {
    if (envio.estado === 'EN_VUELO') {
      if (envio.vueloActual) return `En vuelo · ${envio.vueloActual}`
      return 'En vuelo'
    }
    if (envio.estado === 'ENTREGADO') {
      return destinoInfo
    }
    return aeropuertoInfo
  })()
  const tieneRutaAnterior = Boolean(envio.rutaAnteriorAeropuertos?.length)
  const rutaAeropuertos = routeMode === 'anterior'
    ? (envio.rutaAnteriorAeropuertos || [])
    : (envio.rutaAeropuertos || [])
  const rutaVuelos = routeMode === 'anterior'
    ? (envio.rutaAnteriorVuelos || [])
    : (envio.rutaVuelos || [])
  const maletasDelEnvio = useMemo(
    () => maletas
      .filter((maleta) => maleta.envioId === envio.id)
      .sort((a, b) => a.indice - b.indice),
    [envio.id, maletas],
  )
  const resumenMaletas = useMemo(() => {
    const totals = {
      enVuelo: 0,
      esperadas: 0,
      entregadas: 0,
      pendientes: 0,
    }

    maletasDelEnvio.forEach((maleta) => {
      if (maleta.estado === 'EN_VUELO') {
        totals.enVuelo += 1
      } else if (maleta.estado === 'ENTREGADO') {
        totals.entregadas += 1
      } else if (maleta.vueloEsperado || maleta.vueloActual || maleta.ultimoVuelo) {
        totals.esperadas += 1
      } else {
        totals.pendientes += 1
      }
    })

    return totals
  }, [maletasDelEnvio])
  const vuelosActuales = useMemo(
    () => Array.from(new Set(
      maletasDelEnvio
        .map((maleta) => maleta.vueloActual)
        .filter((vueloId): vueloId is string => Boolean(vueloId)),
    )),
    [maletasDelEnvio],
  )
  const vuelosEsperados = useMemo(
    () => Array.from(new Set(
      maletasDelEnvio
        .map((maleta) => maleta.vueloEsperado)
        .filter((vueloId): vueloId is string => Boolean(vueloId)),
    )),
    [maletasDelEnvio],
  )
  const ultimosVuelos = useMemo(
    () => Array.from(new Set(
      maletasDelEnvio
        .map((maleta) => maleta.ultimoVuelo)
        .filter((vueloId): vueloId is string => Boolean(vueloId)),
    )),
    [maletasDelEnvio],
  )
  const visibleMaletas = maletasDelEnvio.slice(0, visibleBagCount)
  const hasMoreMaletas = visibleMaletas.length < maletasDelEnvio.length

  useEffect(() => {
    setVisibleBagCount(INITIAL_VISIBLE_BAGS)
  }, [envio.id])

  const renderFlightLinks = (label: string, flightIds: string[]) => (
    <div className="border-t border-gray-700 pt-1">
      <div className="flex items-start justify-between gap-3">
        <span className="text-gray-400">{label}</span>
        <div className="flex max-w-[13rem] flex-col items-end gap-1">
          {flightIds.map((flightId) => (
            <button
              key={`${label}-${flightId}`}
              type="button"
              onClick={() => onIrAVuelo?.(flightId)}
              className="truncate text-xs font-medium text-sky-400 hover:text-sky-300"
              title={flightId}
            >
              {flightId} →
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className={`${compact ? 'rounded-none border-0 bg-transparent p-3' : 'mx-3 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-amber-400">Detalle de envío</h4>
          <p className="truncate text-[10px] text-gray-500" title={envio.id}>{envio.id}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-lg leading-none text-gray-400 transition-colors hover:text-white"
            aria-label="Cerrar detalle de envío"
          >
            &times;
          </button>
        )}
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-gray-400">Estado</span>
          <span className={`font-medium ${estadoInfo.color}`}>{estadoInfo.label}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-400">Origen</span>
          <span className="text-right font-medium text-emerald-400">{origenInfo}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-400">Destino</span>
          <span className="text-right font-medium text-red-400">{destinoInfo}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-400">Ubicación actual</span>
          <span className="text-right font-medium text-gray-200">{ubicacionActualLabel}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-400">Cantidad</span>
          <span className="font-medium text-amber-300">{envio.cantidad}</span>
        </div>
        {(envio.fechaRegistroLocal || envio.horaRegistroLocal) && (
          <div className="flex justify-between gap-2">
            <span className="text-gray-400">Registrado</span>
            <span className="text-right font-medium text-gray-200">
              {envio.fechaRegistroLocal || '--'} {envio.horaRegistroLocal?.slice(0, 5) || '--:--'}
            </span>
          </div>
        )}
        {envio.clienteId && (
          <div className="flex justify-between gap-2">
            <span className="text-gray-400">Cliente</span>
            <span className="font-medium text-sky-300">{envio.clienteId}</span>
          </div>
        )}

        {(envio.rutaAeropuertos?.length || tieneRutaAnterior) && (
          <div className="space-y-1.5 border-t border-gray-700 pt-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">Ruta mostrada</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onRouteModeChange?.('actual')}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    routeMode === 'actual'
                      ? 'border border-sky-500/40 bg-sky-500/20 text-sky-400'
                      : 'border border-gray-700 bg-gray-800 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Actual
                </button>
                <button
                  type="button"
                  onClick={() => onRouteModeChange?.('anterior')}
                  disabled={!tieneRutaAnterior}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    routeMode === 'anterior'
                      ? 'border border-amber-500/40 bg-amber-500/20 text-amber-400'
                      : 'border border-gray-700 bg-gray-800 text-gray-500 hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-40'
                  }`}
                >
                  Anterior
                </button>
              </div>
            </div>
            {rutaAeropuertos.length > 0 && (
              <>
                <div className="break-words text-[10px] text-gray-500">
                  Ruta: {rutaAeropuertos.join(' -> ')}
                </div>
                <div className="space-y-1">
                  {rutaAeropuertos.map((codigo, index) => {
                    const rol = index === 0 ? 'Origen' : index === rutaAeropuertos.length - 1 ? 'Destino' : `Escala ${index}`
                    const vueloTramo = index > 0 ? rutaVuelos[index - 1] : null
                    return (
                      <div key={`${routeMode}-${codigo}-${index}`} className="flex justify-between gap-2 text-[10px] text-gray-400">
                        <span>{rol}: {getAirportCityCountry(codigo)}</span>
                        <span>{vueloTramo ? `UT ${vueloTramo}` : ''}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {vuelosActuales.length > 0
          ? renderFlightLinks(vuelosActuales.length > 1 ? 'Vuelos actuales' : 'Vuelo actual', vuelosActuales)
          : envio.vueloActual
            ? renderFlightLinks('Vuelo actual', [envio.vueloActual])
            : null}

        {vuelosEsperados.length > 0
          ? renderFlightLinks(vuelosEsperados.length > 1 ? 'Vuelos esperados' : 'Vuelo esperado', vuelosEsperados)
          : envio.vueloEsperado
            ? renderFlightLinks('Vuelo esperado', [envio.vueloEsperado])
            : null}

        {envio.estado === 'ENTREGADO' && (
          ultimosVuelos.length > 0
            ? renderFlightLinks(ultimosVuelos.length > 1 ? 'Últimos vuelos' : 'Último vuelo', ultimosVuelos)
            : ultimoVuelo
              ? renderFlightLinks('Último vuelo', [ultimoVuelo])
              : null
        )}

        <div className="space-y-2 border-t border-gray-700 pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-gray-300">Maletas del envío</span>
            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
              {maletasDelEnvio.length}
            </span>
          </div>
          {maletasDelEnvio.length > 0 && (
            <div className="flex flex-wrap gap-1 text-[10px] text-gray-400">
              {resumenMaletas.enVuelo > 0 && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                  En vuelo: {resumenMaletas.enVuelo}
                </span>
              )}
              {resumenMaletas.esperadas > 0 && (
                <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-300">
                  Asignadas: {resumenMaletas.esperadas}
                </span>
              )}
              {resumenMaletas.pendientes > 0 && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-300">
                  Pendientes: {resumenMaletas.pendientes}
                </span>
              )}
              {resumenMaletas.entregadas > 0 && (
                <span className="rounded-full bg-gray-500/10 px-2 py-0.5 text-gray-300">
                  Entregadas: {resumenMaletas.entregadas}
                </span>
              )}
            </div>
          )}

          {maletasDelEnvio.length === 0 ? (
            <p className="text-[10px] text-gray-500">
              No hay maletas asociadas visibles para este envío.
            </p>
          ) : (
            <div className="space-y-2">
              {maletasDelEnvio.length > INITIAL_VISIBLE_BAGS && (
                <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
                  <span>
                    Mostrando {visibleMaletas.length} de {maletasDelEnvio.length} maletas
                  </span>
                  <button
                    type="button"
                    onClick={() => setVisibleBagCount(INITIAL_VISIBLE_BAGS)}
                    disabled={visibleBagCount <= INITIAL_VISIBLE_BAGS}
                    className="text-sky-400 transition-colors hover:text-sky-300 disabled:cursor-not-allowed disabled:text-gray-600"
                  >
                    Reiniciar vista
                  </button>
                </div>
              )}
              <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                {visibleMaletas.map((maleta) => {
                  const isSelected = maleta.id === selectedMaletaId
                  return (
                    <button
                      key={maleta.id}
                      type="button"
                      onClick={() => onMaletaSelect?.(maleta)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        isSelected
                          ? 'border-sky-500/50 bg-sky-500/15'
                          : 'border-gray-800 bg-gray-900/80 hover:bg-gray-800/80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-medium text-gray-200" title={maleta.id}>
                            {maleta.id}
                          </div>
                          <div className="mt-0.5 text-[10px] text-gray-500">
                            Subruta {maleta.subrutaIndex || 1} · Índice {maleta.indice}
                          </div>
                        </div>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium whitespace-nowrap ${maletaEstadoColors[maleta.estado] || 'text-gray-500'}`}>
                          {estadoLabels[maleta.estado]?.label || maleta.estado}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
              {hasMoreMaletas && (
                <button
                  type="button"
                  onClick={() => setVisibleBagCount((current) => Math.min(current + VISIBLE_BAGS_STEP, maletasDelEnvio.length))}
                  className="w-full rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] font-medium text-sky-300 transition-colors hover:bg-sky-500/15 hover:text-sky-200"
                >
                  Mostrar 50 más
                </button>
              )}
              {!hasMoreMaletas && maletasDelEnvio.length > INITIAL_VISIBLE_BAGS && (
                <p className="text-center text-[10px] text-gray-500">
                  Se muestran todas las maletas del envío.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
