import { formatDateTime } from '../utils/dateFormat'
import type { SimulationState } from '../types'

interface Props {
  state: SimulationState | null
  isOpen: boolean
  onClose: () => void
  onNuevaSimulacion: () => void
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

export default function ResultadosModal({ state, isOpen, onClose, onNuevaSimulacion }: Props) {
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-emerald-400">Reporte de la Última Planificación Estable</h2>
              <p className="mt-1 text-sm text-gray-300">
                Resumen de la última planificación válida lograda por el sistema
              </p>
              <div className="mt-2 space-y-1 text-xs text-gray-500">
                <p>Inicio real de simulación: {formatDateTime(state.startedAt ?? state.simulationTime)}</p>
                <p>Última planificación simulada: {formatDateTime(ultimaPlanificacionSimulada)}</p>
                <p>Rango planificado: {formatDateTime(ultimaPlanificacionSimulada)} - {formatDateTime(finUltimaPlanificacionSimulada)}</p>
                <p>Duración de la última planificación: {duracionUltimaPlanificacion}</p>
                <p>Corte: {formatDateTime(state.simulationTime)}</p>
              </div>
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
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/30 p-4">
              <p className="text-xs uppercase tracking-wide text-emerald-300">Estado de planificación</p>
              <p className="mt-2 text-2xl font-bold text-white">
                {state.planificacionEstable === false || state.colapsada ? 'No estable' : 'Estable'}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Corte</p>
              <p className="mt-2 text-xl font-semibold text-white">{formatDateTime(state.simulationTime)}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
            <h3 className="text-lg font-semibold text-gray-100">Resultado de asignación</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl bg-gray-800/70 p-3">
                <p className="text-xs text-gray-400">Envíos con ruta final</p>
                <p className="mt-1 text-xl font-bold text-emerald-400">{enviosAsignados}</p>
              </div>
              <div className="rounded-xl bg-gray-800/70 p-3">
                <p className="text-xs text-gray-400">Envíos reasignados</p>
                <p className="mt-1 text-xl font-bold text-cyan-400">{enviosReasignados.length}</p>
              </div>
              <div className="rounded-xl bg-gray-800/70 p-3">
                <p className="text-xs text-gray-400">Envíos sin ruta final</p>
                <p className="mt-1 text-xl font-bold text-rose-400">{enviosSinRuta.length}</p>
              </div>
              <div className="rounded-xl bg-gray-800/70 p-3">
                <p className="text-xs text-gray-400">Envíos con nueva asignación</p>
                <p className="mt-1 text-xl font-bold text-amber-400">{enviosConRutaNueva.length}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <p className="text-xs text-gray-400">Envíos entregados</p>
                <p className="mt-1 text-xl font-bold text-slate-200">{enviosEntregados}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <p className="text-xs text-gray-400">Envíos en vuelo</p>
                <p className="mt-1 text-xl font-bold text-emerald-400">{enviosEnVuelo}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <p className="text-xs text-gray-400">Envíos en espera</p>
                <p className="mt-1 text-xl font-bold text-amber-400">{enviosEnEspera}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <p className="text-xs text-gray-400">Rutas generadas</p>
                <p className="mt-1 text-xl font-bold text-indigo-400">{rutasGeneradas}</p>
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
