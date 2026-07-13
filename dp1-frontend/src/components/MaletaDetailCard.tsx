import { getAirportCityCountry } from '../data/airportsData'
import type { MaletaEstado } from '../types'

interface Props {
  maleta: MaletaEstado
  routeMode?: 'actual' | 'anterior'
  onRouteModeChange?: (mode: 'actual' | 'anterior') => void
  onClose?: () => void
  onIrAVuelo?: (vueloId: string) => void
  compact?: boolean
}

const estadoLabels: Record<string, { label: string; color: string }> = {
  EN_ESPERA: { label: 'En espera', color: 'text-amber-400' },
  EMBARCADO: { label: 'En espera', color: 'text-amber-400' },
  EN_VUELO: { label: 'En vuelo', color: 'text-emerald-400' },
  ENTREGADO: { label: 'Entregada', color: 'text-gray-400' },
}

export default function MaletaDetailCard({
  maleta,
  routeMode = 'actual',
  onRouteModeChange,
  onClose,
  onIrAVuelo,
  compact = false,
}: Props) {
  const estadoInfo = estadoLabels[maleta.estado] || { label: maleta.estado, color: 'text-gray-400' }
  const origenInfo = getAirportCityCountry(maleta.origen)
  const destinoInfo = getAirportCityCountry(maleta.destino)
  const aeropuertoInfo = getAirportCityCountry(maleta.aeropuertoActual)
  const ultimoVuelo = maleta.ultimoVuelo || maleta.vueloActual || maleta.vueloEsperado
  const tieneRutaAnterior = Boolean(maleta.rutaAnteriorAeropuertos?.length)
  const rutaAeropuertos = routeMode === 'anterior'
    ? (maleta.rutaAnteriorAeropuertos || [])
    : (maleta.rutaAeropuertos || [])
  const rutaVuelos = routeMode === 'anterior'
    ? (maleta.rutaAnteriorVuelos || [])
    : (maleta.rutaVuelos || [])

  return (
    <div className={`${compact ? 'rounded-none border-0 bg-transparent p-3' : 'mx-3 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-amber-400">Detalle de maleta</h4>
          <p className="truncate text-[10px] text-gray-500" title={maleta.id}>{maleta.id}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-lg leading-none text-gray-400 transition-colors hover:text-white"
            aria-label="Cerrar detalle de maleta"
          >
            &times;
          </button>
        )}
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-gray-400">Envío</span>
          <span className="truncate text-right font-medium text-amber-300" title={maleta.envioId}>{maleta.envioId}</span>
        </div>
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
          <span className="text-gray-400">Subruta</span>
          <span className="font-medium text-sky-400">{maleta.subrutaIndex || 1}</span>
        </div>

        {(maleta.rutaAeropuertos?.length || tieneRutaAnterior) && (
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

        {maleta.vueloActual && (
          <div className="border-t border-gray-700 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Vuelo actual</span>
              <button
                type="button"
                onClick={() => onIrAVuelo?.(maleta.vueloActual!)}
                className="text-xs font-medium text-sky-400 hover:text-sky-300"
              >
                {maleta.vueloActual} →
              </button>
            </div>
          </div>
        )}

        {maleta.vueloEsperado && (
          <div className="border-t border-gray-700 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Vuelo esperado</span>
              <button
                type="button"
                onClick={() => onIrAVuelo?.(maleta.vueloEsperado!)}
                className="text-xs font-medium text-sky-400 hover:text-sky-300"
              >
                {maleta.vueloEsperado} →
              </button>
            </div>
          </div>
        )}

        {maleta.estado === 'ENTREGADO' && ultimoVuelo && (
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
      </div>
    </div>
  )
}
