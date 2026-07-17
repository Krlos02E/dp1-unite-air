import { useEffect, useRef, useState, useCallback } from 'react'
import { useSimulation } from '../context/SimulationContext'
import { simulationService } from '../services/SimulationService'
import MapaAeropuertos from '../components/MapaAeropuertos'
import VueloDetailCard from '../components/VueloDetailCard'
import AeropuertoDetailCard from '../components/AeropuertoDetailCard'
import EnvioModal from '../components/EnvioModal'
import ResultadosModal from '../components/ResultadosModal'
import { formatDateTime } from '../utils/dateFormat'
import type { SimulationState, VueloDTO, AeropuertoDTO, EnvioEstado } from '../types'

interface Props {
  sessionId: string
  onColapso?: (state: SimulationState) => void
  onBack: () => void
}

export default function SimulacionEjecucion({ sessionId, onColapso, onBack }: Props) {
  const { simulationState, startPolling, stopPolling } = useSimulation()
  const [selectedVuelo, setSelectedVuelo] = useState<VueloDTO | null>(null)
  const [selectedAeropuerto, setSelectedAeropuerto] = useState<AeropuertoDTO | null>(null)
  const [selectedEnvio, setSelectedEnvio] = useState<EnvioEstado | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [showResultados, setShowResultados] = useState(false)
  const [resultSnapshot, setResultSnapshot] = useState<SimulationState | null>(null)
  const [mapTz, setMapTz] = useState(0)
  const logEndRef = useRef<HTMLDivElement>(null)
  const finalSnapshotRequestedRef = useRef(false)

  const handleVueloClick = useCallback((v: VueloDTO) => {
    setSelectedVuelo((prev) => (prev?.id === v.id ? null : v))
    setSelectedAeropuerto(null)
    setSelectedEnvio(null)
  }, [])

  const handleAeropuertoClick = useCallback((a: AeropuertoDTO) => {
    setSelectedAeropuerto((prev) => (prev?.codigoOACI === a.codigoOACI ? null : a))
    setSelectedVuelo(null)
    setSelectedEnvio(null)
  }, [])

  const handleIrAVueloDesdeEnvio = useCallback((vueloId: string) => {
    const vuelo = simulationState?.vuelos.find((v) => v.id === vueloId)
    if (vuelo) {
      setSelectedVuelo(vuelo)
      setSelectedEnvio(null)
    }
  }, [simulationState])

  // Keep selected flight synced with latest poll
  useEffect(() => {
    if (!selectedVuelo) return
    if (simulationState?.vuelos) {
      const updated = simulationState.vuelos.find((v) => v.id === selectedVuelo.id)
      if (updated) {
        setSelectedVuelo(updated)
      } else if (simulationState.status === 'COMPLETADA') {
        // Flight no longer in active list and sim completed → it reached destination
        setSelectedVuelo((prev) => (prev ? { ...prev, progresoVuelo: 100 } : prev))
      }
    }
  }, [simulationState?.vuelos, simulationState?.status])

  useEffect(() => {
    finalSnapshotRequestedRef.current = false
    setResultSnapshot(null)
    setShowResultados(false)
  }, [sessionId])

  useEffect(() => {
    if (!simulationState) return
    const isFinished = simulationState.status === 'COMPLETADA' || simulationState.status === 'COLAPSADA'
    if (!isFinished || finalSnapshotRequestedRef.current) return

    finalSnapshotRequestedRef.current = true

    const openResultsWithLatestState = async () => {
      try {
        const latestState = await simulationService.estado(sessionId)
        setResultSnapshot(latestState)
      } catch {
        setResultSnapshot({ ...simulationState })
      } finally {
        setShowResultados(true)
      }
    }

    void openResultsWithLatestState()
  }, [sessionId, simulationState])

  useEffect(() => {
    startPolling(sessionId, undefined, simulationState?.startedAt)
    return () => stopPolling()
  }, [sessionId, startPolling, stopPolling, simulationState?.startedAt])

  useEffect(() => {
    if (simulationState?.sessionId !== sessionId) return
    if (simulationState?.colapsada) {
      stopPolling()
      onColapso?.(simulationState)
    }
    if (simulationState?.status === 'COMPLETADA') {
      stopPolling()
    }
  }, [simulationState?.colapsada, simulationState?.status, simulationState?.sessionId, sessionId, stopPolling, onColapso])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [simulationState?.logs])

  const handleTogglePause = async () => {
    try {
      if (isPaused) {
        await simulationService.reanudar(sessionId)
        setIsPaused(false)
      } else {
        await simulationService.pausar(sessionId)
        setIsPaused(true)
      }
    } catch {
      // ignore
    }
  }

  const handleDetener = async () => {
    const snapshot = simulationState ? { ...simulationState } : null
    try {
      await simulationService.detener(sessionId)
    } catch {
      // ignore
    }
    if (snapshot) {
      setResultSnapshot(snapshot)
      setShowResultados(true)
    }
    stopPolling()
  }

  const handleNuevaSimulacion = () => {
    stopPolling()
    onBack()
  }

  if (!simulationState) {
    return (
      <div className="flex items-center justify-center h-64 px-4">
        <p className="text-gray-400 text-center">Iniciando simulación...</p>
      </div>
    )
  }

  const isPlanning = simulationState.status === 'PLANIFICANDO'
  const isCompleted = simulationState.status === 'COMPLETADA'
  const isColapsada = simulationState.status === 'COLAPSADA'
  const isError = simulationState.status === 'ERROR'
  const showActionButton = !isColapsada && !isError

  return (
    <div className="relative">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
        <h2 className="text-xl sm:text-2xl font-bold">
          {isPlanning ? 'Planificando Rutas' :
           isCompleted ? 'Simulación Completada' :
           isColapsada ? 'Simulación Colapsada' :
           isError ? 'Error en Simulación' :
           'Simulación en Curso'}
        </h2>
        {showActionButton && (
          <div className="flex items-center gap-2">
            {!isCompleted && (
              <>
                <button
                  onClick={handleTogglePause}
                  className={`px-4 py-2 rounded-lg font-medium text-sm cursor-pointer ${
                    isPaused
                      ? 'bg-sky-600 hover:bg-sky-700 text-white'
                      : 'bg-amber-600 hover:bg-amber-700 text-white'
                  }`}
                >
                  {isPaused ? 'Reanudar Simulación' : 'Pausar Simulación'}
                </button>
                <button
                  onClick={handleDetener}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer"
                >
                  Detener Simulación
                </button>
              </>
            )}
            {isCompleted && (
              <button
                onClick={handleNuevaSimulacion}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                Nueva Simulación
              </button>
            )}
          </div>
        )}
      </div>

      {isCompleted && (
        <div className="bg-emerald-900/50 border border-emerald-700 text-emerald-300 p-3 rounded-xl mb-3">
          <p className="font-semibold">Simulación finalizada exitosamente</p>
          <p className="text-sm mt-1">
            Progreso alcanzado: {simulationState.progreso}% del tiempo simulado.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-4 relative">
        {isPlanning && !isPaused && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 rounded-xl pointer-events-none">
            <div className="text-center pointer-events-auto">
              <div className="w-12 h-12 border-4 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-gray-300 text-lg mb-2">Calculando rutas óptimas...</p>
              <p className="text-gray-500 text-sm">El motor de planificación está procesando los envíos</p>
            </div>
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-2 h-[38vh] lg:h-[48vh]">
          <MapaAeropuertos
            aeropuertos={simulationState.aeropuertos}
            vuelos={simulationState.vuelos}
            selectedVueloId={selectedVuelo?.id || null}
            onAeropuertoClick={handleAeropuertoClick}
            onVueloClick={handleVueloClick}
            mapTz={mapTz}
            onMapTzChange={setMapTz}
            simulationMode={true}
            simulationTime={simulationState.simulationTime}
          />
        </div>

        <div className="space-y-2">
          {(selectedVuelo || selectedAeropuerto) && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
              {selectedVuelo ? (
                <VueloDetailCard
                  vuelo={selectedVuelo}
                  tzOffset={mapTz}
                  aeropuertos={simulationState.aeropuertos}
                  onClear={() => setSelectedVuelo(null)}
                />
              ) : selectedAeropuerto ? (
                <AeropuertoDetailCard
                  aeropuerto={selectedAeropuerto}
                  vuelos={simulationState?.vuelos}
                  envios={simulationState?.envios || []}
                  tzOffset={mapTz}
                  aeropuertos={simulationState.aeropuertos}
                  onVueloSelect={handleVueloClick}
                  onClear={() => setSelectedAeropuerto(null)}
                />
              ) : null}
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <p className="text-gray-400 text-sm">Tiempo de simulación</p>
            <p className="text-2xl font-mono font-bold text-sky-400">{formatDateTime(simulationState.simulationTime)}</p>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <p className="text-gray-400 text-sm mb-1">Progreso</p>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div className="bg-emerald-500 h-3 rounded-full transition-all" style={{ width: `${simulationState.progreso}%` }} />
            </div>
            <p className="text-right text-xs text-gray-500 mt-1">{simulationState.progreso}%</p>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex-1">
            <h3 className="text-sm font-semibold text-gray-300 mb-1">Registro Operativo</h3>
            <div className="h-20 lg:h-28 overflow-y-auto space-y-1 text-xs font-mono">
              {simulationState.logs.map((log, i) => (
                <div key={i} className={`${log.tipo === 'ERROR' ? 'text-red-400' : log.tipo === 'WARN' ? 'text-yellow-400' : log.tipo === 'COLAPSO' ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                  [{formatDateTime(log.timestamp)}] {log.tipo}: {log.mensaje}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>

      <EnvioModal envio={selectedEnvio} isOpen={!!selectedEnvio} onClose={() => setSelectedEnvio(null)} onIrAVuelo={handleIrAVueloDesdeEnvio} vuelos={simulationState?.vuelos} />
      <ResultadosModal
        state={resultSnapshot ?? simulationState}
        isOpen={showResultados}
        onClose={() => {
          setShowResultados(false)
          setResultSnapshot(null)
          handleNuevaSimulacion()
        }}
      />
    </div>
  )
}
