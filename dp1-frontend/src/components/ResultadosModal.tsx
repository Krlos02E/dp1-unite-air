import { formatDateTime } from '../utils/dateFormat'
import type { SimulationState } from '../types'

interface Props {
  state: SimulationState | null
  isOpen: boolean
  onClose: () => void
}

function sameRoute(actual?: string[] | null, anterior?: string[] | null) {
  if (!actual?.length || !anterior?.length) return false
  if (actual.length !== anterior.length) return false
  return actual.every((value, index) => value === anterior[index])
}

function parseLocalDate(value?: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toLocalIso(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
}

function getLastPlanningSimulatedTime(fechaInicio?: string, simulationTime?: string): string | null {
  const inicio = parseLocalDate(fechaInicio)
  const corte = parseLocalDate(simulationTime)
  if (!inicio || !corte) return fechaInicio ?? simulationTime ?? null

  const diffMs = corte.getTime() - inicio.getTime()
  if (diffMs <= 0) return toLocalIso(inicio)

  const hourMs = 60 * 60 * 1000
  const completedHours = Math.floor(diffMs / hourMs)
  return toLocalIso(new Date(inicio.getTime() + completedHours * hourMs))
}

function addMinutes(isoString?: string | null, minutes = 0): string | null {
  const base = parseLocalDate(isoString)
  if (!base) return null
  return toLocalIso(new Date(base.getTime() + minutes * 60 * 1000))
}

function extractLastPlanningDuration(logs: SimulationState['logs']): string {
  const replanLog = [...(logs ?? [])].reverse().find((log) => log.tipo === 'REPLAN')
  if (!replanLog?.mensaje) return '--'
  const match = replanLog.mensaje.match(/algoritmo\s+(\d+(?:\.\d+)?)s/i)
  return match ? `${match[1]} s` : '--'
}

export default function ResultadosModal({ state, isOpen, onClose }: Props) {
  if (!isOpen || !state) return null

  const envios = state.envios ?? []
  const enviosConRuta = envios.filter((envio) => envio.rutaAeropuertos?.length)
  const enviosAsignados = enviosConRuta.length
  const enviosEntregados = envios.filter((envio) => envio.estado === 'ENTREGADO').length
  const enviosEnVuelo = envios.filter((envio) => envio.estado === 'EN_VUELO').length
  const enviosEnEspera = envios.filter((envio) => envio.estado === 'EN_ESPERA' || envio.estado === 'EMBARCADO').length
  const rutasGeneradas = new Set(
    enviosConRuta.map((envio) => (envio.rutaAeropuertos ?? []).join(' > ')),
  ).size
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
  const ultimaPlanificacionSimulada = state.ultimaPlanificacionSimulada
    ?? getLastPlanningSimulatedTime(state.fechaInicio, state.simulationTime)
  const finUltimaPlanificacionSimulada = addMinutes(
    ultimaPlanificacionSimulada,
    state.horizontePlanificacionMinutos ?? 180,
  )
  const duracionUltimaPlanificacion = state.duracionUltimaPlanificacionSeg != null
    ? `${state.duracionUltimaPlanificacionSeg.toFixed(3)} s`
    : extractLastPlanningDuration(state.logs)
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4">
      <div
        className="w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-3xl border border-gray-700 bg-gray-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 px-6 py-5 backdrop-blur">
          <div className="min-w-0">
              <h2 className="text-2xl font-bold text-emerald-400">Reporte de la Última Planificación Estable</h2>
              <p className="mt-1 text-sm text-gray-300">
                Resumen de la última planificación válida lograda por el sistema
              </p>
              <div className="mt-4 flex flex-col gap-3 md:flex-row">
                <div className="min-w-0 flex-1 rounded-2xl border border-emerald-800/60 bg-emerald-950/30 p-5">
                  <p className="text-xs uppercase tracking-wide text-emerald-300">Estado de planificación</p>
                  <p className="mt-2 text-3xl font-bold text-white">
                    {state.planificacionEstable === false || state.colapsada ? 'No estable' : 'Estable'}
                  </p>
                </div>
                <div className="min-w-0 flex-1 rounded-2xl border border-emerald-700/70 bg-emerald-950/50 p-5 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]">
                  <p className="text-xs uppercase tracking-wide text-emerald-300">Corte (hora simulada)</p>
                  <p className="mt-2 text-3xl font-bold text-white">{formatDateTime(state.simulationTime)}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Inicio de la última planificación (hora real)</p>
                  <p className="mt-2 text-base font-semibold text-gray-100">
                    {formatDateTime(state.startedAt ?? state.simulationTime)}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Inicio de la última planificación (hora simulada)</p>
                  <p className="mt-2 text-base font-semibold text-gray-100">{formatDateTime(ultimaPlanificacionSimulada)}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Rango planificado (horas simuladas)</p>
                  <p className="mt-2 text-base font-semibold text-gray-100">
                    {formatDateTime(ultimaPlanificacionSimulada)} - {formatDateTime(finUltimaPlanificacionSimulada)}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Duración de la última planificación</p>
                  <p className="mt-2 text-base font-semibold text-gray-100">{duracionUltimaPlanificacion}</p>
                </div>
              </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
            <h3 className="text-lg font-semibold text-gray-100">Asignación de la última planificación estable</h3>
            <p className="mt-1 text-sm text-gray-400">
              Este bloque resume cuántos envíos fueron asignados y cómo se encontraban al momento del corte.
            </p>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Detalle de asignación</p>
                <div className="mt-3 rounded-xl bg-gray-800/70 p-4">
                  <p className="text-xs text-gray-400">Envíos con ruta final</p>
                  <p className="mt-1 text-3xl font-bold text-emerald-400">{enviosAsignados}</p>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-gray-800/70 p-3">
                    <p className="text-xs text-gray-400">Envíos con nueva asignación</p>
                    <p className="mt-1 text-xl font-bold text-amber-400">{enviosConRutaNueva.length}</p>
                  </div>
                  <div className="rounded-xl bg-gray-800/70 p-3">
                    <p className="text-xs text-gray-400">Envíos reasignados</p>
                    <p className="mt-1 text-xl font-bold text-cyan-400">{enviosReasignados.length}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-gray-800/70 p-3">
                    <p className="text-xs text-gray-400">Envíos sin ruta final</p>
                    <p className="mt-1 text-xl font-bold text-rose-400">{enviosSinRuta.length}</p>
                  </div>
                  <div className="rounded-xl bg-gray-800/70 p-3">
                    <p className="text-xs text-gray-400">Rutas generadas</p>
                    <p className="mt-1 text-xl font-bold text-indigo-400">{rutasGeneradas}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Detalle de envíos al corte</p>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-xs text-gray-400">Envíos entregados</p>
                    <p className="mt-1 text-xl font-bold text-slate-200">{enviosEntregados}</p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-xs text-gray-400">Envíos en vuelo</p>
                    <p className="mt-1 text-xl font-bold text-emerald-400">{enviosEnVuelo}</p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-xs text-gray-400">Envíos en espera</p>
                    <p className="mt-1 text-xl font-bold text-amber-400">{enviosEnEspera}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

        </div>

        <div className="sticky bottom-0 border-t border-gray-800 bg-gray-950/95 px-6 py-4 backdrop-blur">
          <div className="flex">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl bg-gray-700 py-3 font-medium transition-colors hover:bg-gray-600"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
