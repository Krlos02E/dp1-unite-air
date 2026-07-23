import { getAirportCityCountry } from '../data/airportsData'
import type { EnvioEstado, MaletaEstado } from '../types'

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
  const estadoInfo = estadoLabels[envio.estado] || { label: envio.estado, color: 'text-gray-400' }
  const origenInfo = getAirportCityCountry(envio.origen)
  const destinoInfo = getAirportCityCountry(envio.destino)
  const aeropuertoInfo = getAirportCityCountry(envio.aeropuertoActual)
  const ultimoVuelo = envio.ultimoVuelo || envio.vueloActual || envio.vueloEsperado
  const tieneRutaAnterior = Boolean(envio.rutaAnteriorAeropuertos?.length)
  const rutaAeropuertos = routeMode === 'anterior'
    ? (envio.rutaAnteriorAeropuertos || [])
    : (envio.rutaAeropuertos || [])
  const rutaVuelos = routeMode === 'anterior'
    ? (envio.rutaAnteriorVuelos || [])
    : (envio.rutaVuelos || [])
  const maletasDelEnvio = maletas
    .filter((maleta) => maleta.envioId === envio.id)
    .sort((a, b) => a.indice - b.indice)

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
          <span className="text-right font-medium text-gray-200">{aeropuertoInfo}</span>
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

        {envio.vueloActual && (
          <div className="border-t border-gray-700 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Vuelo actual</span>
              <button
                type="button"
                onClick={() => onIrAVuelo?.(envio.vueloActual!)}
                className="text-xs font-medium text-sky-400 hover:text-sky-300"
              >
                {envio.vueloActual} →
              </button>
            </div>
          </div>
        )}

        {envio.vueloEsperado && (
          <div className="border-t border-gray-700 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Vuelo esperado</span>
              <button
                type="button"
                onClick={() => onIrAVuelo?.(envio.vueloEsperado!)}
                className="text-xs font-medium text-sky-400 hover:text-sky-300"
              >
                {envio.vueloEsperado} →
              </button>
            </div>
          </div>
        )}

        {envio.estado === 'ENTREGADO' && ultimoVuelo && (
          <div className="border-t border-gray-700 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Último vuelo</span>
              <button
                type="button"
                onClick={() => onIrAVuelo?.(ultimoVuelo)}
                className="max-w-[13rem] truncate text-xs font-medium text-sky-400 hover:text-sky-300"
                title={ultimoVuelo}
              >
                {ultimoVuelo} →
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2 border-t border-gray-700 pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-gray-300">Maletas del envío</span>
            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
              {maletasDelEnvio.length}
            </span>
          </div>

          {maletasDelEnvio.length === 0 ? (
            <p className="text-[10px] text-gray-500">
              No hay maletas asociadas visibles para este envío.
            </p>
          ) : (
            <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
              {maletasDelEnvio.map((maleta) => {
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
          )}
        </div>
      </div>
    </div>
  )
}
