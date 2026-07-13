import { formatDateTime } from '../utils/dateFormat'
import { getAirportCity } from '../data/airportsData'
import type { EnvioEstado, SimulationState } from '../types'

interface Props {
  state: SimulationState | null
  isOpen: boolean
  onClose: () => void
  onNuevaSimulacion: () => void
}

function countEnvios(envios: EnvioEstado[], estado: EnvioEstado['estado']) {
  return envios.filter((envio) => envio.estado === estado).length
}

function sameRoute(actual?: string[] | null, anterior?: string[] | null) {
  if (!actual?.length || !anterior?.length) return false
  if (actual.length !== anterior.length) return false
  return actual.every((value, index) => value === anterior[index])
}

export default function ResultadosModal({ state, isOpen, onClose, onNuevaSimulacion }: Props) {
  if (!isOpen || !state) return null

  const envios = state.envios ?? []
  const maletas = state.maletas ?? []
  const vuelos = state.vuelos ?? []
  const aeropuertos = state.aeropuertos ?? []

  const enviosEntregados = countEnvios(envios, 'ENTREGADO')
  const enviosEnVuelo = countEnvios(envios, 'EN_VUELO')
  const enviosEmbarcados = countEnvios(envios, 'EMBARCADO')
  const enviosEnEspera = countEnvios(envios, 'EN_ESPERA')
  const enviosPendientesConRuta = envios.filter((envio) => envio.estado === 'EN_ESPERA' && envio.rutaAeropuertos?.length).length
  const enviosConRuta = envios.filter((envio) => envio.rutaAeropuertos?.length)
  const enviosAsignados = enviosConRuta.length

  const maletasEntregadas = state.maletasEntregadas
  const maletasEnTransito = state.maletasEnTransito
  const maletasEnEspera = Math.max(0, maletas.length - maletasEntregadas - maletasEnTransito)
  const maletasPlanificadas = enviosConRuta.reduce((sum, envio) => sum + envio.cantidad, 0)

  const vuelosProgramados = vuelos.filter((vuelo) => vuelo.estado === 'PROGRAMADO').length
  const vuelosActivos = vuelos.filter((vuelo) => vuelo.estado === 'ACTIVO').length
  const vuelosCulminados = vuelos.filter((vuelo) => vuelo.estado === 'CULMINADO').length
  const vuelosCancelados = vuelos.filter((vuelo) => vuelo.estado === 'CANCELADO').length

  const enviosReasignados = envios.filter((envio) =>
    envio.rutaAeropuertos?.length
    && envio.rutaAnteriorAeropuertos?.length
    && !sameRoute(envio.rutaAeropuertos, envio.rutaAnteriorAeropuertos)
  )
  const enviosConRutaNueva = envios.filter((envio) =>
    envio.rutaAeropuertos?.length
    && !envio.rutaAnteriorAeropuertos?.length
  )
  const enviosSinRuta = envios.filter((envio) => !envio.rutaAeropuertos?.length)
  const vuelosUtilizados = new Set(
    enviosConRuta.flatMap((envio) => envio.rutaVuelos ?? []),
  ).size
  const aeropuertosInvolucrados = new Set(
    enviosConRuta.flatMap((envio) => envio.rutaAeropuertos ?? []),
  ).size
  const aeropuertosSaturados = aeropuertos.filter((aeropuerto) =>
    aeropuerto.capacidadMaxima > 0 && aeropuerto.ocupacionActual >= aeropuerto.capacidadMaxima
  )

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-3xl border border-gray-700 bg-gray-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 px-6 py-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-emerald-400">Reporte de la Ultima Planificacion Estable</h2>
              <p className="mt-1 text-sm text-gray-300">
                Resumen de la ultima planificacion valida lograda por el sistema
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Corte: {formatDateTime(state.simulationTime)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-3xl leading-none text-gray-400 transition-colors hover:text-white"
              aria-label="Cerrar"
            >
              &times;
            </button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/30 p-4">
              <p className="text-xs uppercase tracking-wide text-emerald-300">Estado de planificacion</p>
              <p className="mt-2 text-2xl font-bold text-white">{state.colapsada ? 'No estable' : 'Estable'}</p>
              <p className="mt-1 text-sm text-emerald-200">Progreso consolidado: {state.progreso}%</p>
            </div>
            <div className="rounded-2xl border border-sky-800/60 bg-sky-950/30 p-4">
              <p className="text-xs uppercase tracking-wide text-sky-300">Envios asignados</p>
              <p className="mt-2 text-2xl font-bold text-white">{enviosAsignados}</p>
              <p className="mt-1 text-sm text-sky-200">Totales: {envios.length}</p>
            </div>
            <div className="rounded-2xl border border-amber-800/60 bg-amber-950/30 p-4">
              <p className="text-xs uppercase tracking-wide text-amber-300">Maletas planificadas</p>
              <p className="mt-2 text-2xl font-bold text-white">{maletasPlanificadas}</p>
              <p className="mt-1 text-sm text-amber-200">Totales: {maletas.length}</p>
            </div>
            <div className="rounded-2xl border border-fuchsia-800/60 bg-fuchsia-950/30 p-4">
              <p className="text-xs uppercase tracking-wide text-fuchsia-300">Recursos usados</p>
              <p className="mt-2 text-2xl font-bold text-white">{vuelosUtilizados}</p>
              <p className="mt-1 text-sm text-fuchsia-200">Aeropuertos involucrados: {aeropuertosInvolucrados}</p>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <h3 className="text-lg font-semibold text-gray-100">Resultado de asignacion</h3>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">Con ruta final</p>
                  <p className="mt-1 text-xl font-bold text-emerald-400">{enviosAsignados}</p>
                </div>
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">Sin ruta final</p>
                  <p className="mt-1 text-xl font-bold text-rose-400">{enviosSinRuta.length}</p>
                </div>
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">Reasignados</p>
                  <p className="mt-1 text-xl font-bold text-cyan-400">{enviosReasignados.length}</p>
                </div>
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">Nuevas asignaciones</p>
                  <p className="mt-1 text-xl font-bold text-amber-400">{enviosConRutaNueva.length}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">Pendientes con ruta</p>
                  <p className="mt-1 text-lg font-semibold text-white">{enviosPendientesConRuta}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">Entregados al corte</p>
                  <p className="mt-1 text-lg font-semibold text-white">{enviosEntregados}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">Colapso</p>
                  <p className="mt-1 text-lg font-semibold text-white">{state.motivoColapso || 'No'}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">En ejecucion al corte</p>
                  <p className="mt-1 text-lg font-semibold text-white">{enviosEnVuelo + enviosEmbarcados}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">En espera al corte</p>
                  <p className="mt-1 text-lg font-semibold text-white">{enviosEnEspera}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <h3 className="text-lg font-semibold text-gray-100">Resultado de maletas</h3>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">Planificadas</p>
                  <p className="mt-1 text-xl font-bold text-emerald-400">{maletasPlanificadas}</p>
                </div>
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">En transito</p>
                  <p className="mt-1 text-xl font-bold text-sky-400">{maletasEnTransito}</p>
                </div>
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">En espera</p>
                  <p className="mt-1 text-xl font-bold text-amber-400">{maletasEnEspera}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">Entregadas al corte</p>
                  <p className="mt-1 text-lg font-semibold text-white">{maletasEntregadas}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">Maletas totales</p>
                  <p className="mt-1 text-lg font-semibold text-white">{maletas.length}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <h3 className="text-lg font-semibold text-gray-100">Recursos de la planificacion</h3>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">Vuelos utilizados</p>
                  <p className="mt-1 text-xl font-bold text-gray-100">{vuelosUtilizados}</p>
                </div>
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">Vuelos activos</p>
                  <p className="mt-1 text-xl font-bold text-sky-400">{vuelosActivos}</p>
                </div>
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">Vuelos culminados</p>
                  <p className="mt-1 text-xl font-bold text-emerald-400">{vuelosCulminados}</p>
                </div>
                <div className="rounded-xl bg-gray-800/70 p-3">
                  <p className="text-xs text-gray-400">Vuelos cancelados</p>
                  <p className="mt-1 text-xl font-bold text-rose-400">{vuelosCancelados}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">Vuelos programados</p>
                  <p className="mt-1 text-lg font-semibold text-white">{vuelosProgramados}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">Aeropuertos involucrados</p>
                  <p className="mt-1 text-lg font-semibold text-white">{aeropuertosInvolucrados}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <h3 className="text-lg font-semibold text-gray-100">Estado de aeropuertos</h3>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">Aeropuertos del reporte</p>
                  <p className="mt-1 text-lg font-semibold text-white">{aeropuertos.length}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">Saturados</p>
                  <p className="mt-1 text-lg font-semibold text-white">{aeropuertosSaturados.length}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-xs text-gray-400">Con cancelaciones salientes</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {aeropuertos.filter((aeropuerto) => aeropuerto.vuelosCanceladosSalientes.length > 0).length}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-sm font-medium text-gray-300">Aeropuertos con mayor ocupacion</p>
                <div className="mt-3 space-y-2">
                  {aeropuertos
                    .slice()
                    .sort((a, b) => b.ocupacionActual - a.ocupacionActual)
                    .slice(0, 5)
                    .map((aeropuerto) => (
                      <div key={aeropuerto.codigoOACI} className="rounded-xl bg-gray-950/60 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {getAirportCity(aeropuerto.codigoOACI) || aeropuerto.codigoOACI}
                            </p>
                            <p className="text-xs text-gray-500">{aeropuerto.codigoOACI}</p>
                          </div>
                          <p className="text-sm text-gray-300">
                            {aeropuerto.ocupacionActual} / {aeropuerto.capacidadMaxima}
                          </p>
                        </div>
                      </div>
                    ))}
                  {aeropuertos.length === 0 && (
                    <p className="text-sm text-gray-500">No hay aeropuertos disponibles en el reporte.</p>
                  )}
                </div>
              </div>
            </div>
          </section>

        </div>

        <div className="sticky bottom-0 border-t border-gray-800 bg-gray-950/95 px-6 py-4 backdrop-blur">
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl bg-gray-700 py-3 font-medium transition-colors hover:bg-gray-600"
            >
              Cerrar
            </button>
            <button
              onClick={onNuevaSimulacion}
              className="flex-1 rounded-xl bg-emerald-600 py-3 font-medium transition-colors hover:bg-emerald-700"
            >
              Nueva Simulación
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
