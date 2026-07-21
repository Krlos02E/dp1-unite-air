import { useState, useEffect, useCallback } from 'react'
import { cargaArchivosService } from '../services/CargaArchivosService'
import StationSelectorCard from './StationSelectorCard'
import { getAirportCity } from '../data/airportsData'
import type { AeropuertoDTO, EnvioIncremental } from '../types'
import {
  formatLocalDateTimeParts,
  getStationById,
  resolveStationState,
  saveManualStationSelection,
  type StationId,
} from '../utils/stationTimezone'

const SHARED_ENVIOS_POLL_MS = 5000
const CLIENTE_PRUEBA_OPERACION_DIARIA = '0007729'
export default function AgregarEnvios() {
  const [aeropuertos, setAeropuertos] = useState<AeropuertoDTO[]>([])
  const [enviosExistentes, setEnviosExistentes] = useState<EnvioIncremental[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null)

  const [destino, setDestino] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [stationState, setStationState] = useState(() => resolveStationState())
  const selectedStation = stationState.station
  const timezone = selectedStation?.canonicalTimezone ?? 'UTC'
  const origenDetectado = selectedStation?.airportCode ?? null

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStationState(resolveStationState())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [])

  const handleManualStationSelection = useCallback((stationId: StationId) => {
    saveManualStationSelection(stationId)
    const station = getStationById(stationId)
    setStationState((current) => ({
      browserTimezone: current.browserTimezone,
      station,
      source: 'manual',
      requiresManualSelection: true,
    }))
  }, [])

  const cargarDatos = useCallback(async () => {
    try {
      setLoading(true)
      const [aeropuertosData, enviosData] = await Promise.all([
        cargaArchivosService.obtenerAeropuertos(),
        cargaArchivosService.obtenerEnviosIncrementales(),
      ])
      setAeropuertos(aeropuertosData)
      setEnviosExistentes(enviosData.envios || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  useEffect(() => {
    let cancelled = false

    const pollSharedEnvios = async () => {
      try {
        const [aeropuertosData, enviosData] = await Promise.all([
          cargaArchivosService.obtenerAeropuertos(),
          cargaArchivosService.obtenerEnviosIncrementales(),
        ])
        if (cancelled) return
        setAeropuertos(aeropuertosData)
        setEnviosExistentes(enviosData.envios || [])
      } catch {
        // ignore polling errors and keep last visible snapshot
      }
    }

    const intervalId = window.setInterval(() => {
      void pollSharedEnvios()
    }, SHARED_ENVIOS_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMensaje(null)

    if (!origenDetectado) {
      setMensaje({ tipo: 'error', texto: 'La zona horaria de esta PC no corresponde a una sede válida para la prueba' })
      return
    }

    if (!destino || !cantidad) {
      setMensaje({ tipo: 'error', texto: 'Destino y cantidad son obligatorios' })
      return
    }

    if (origenDetectado === destino) {
      setMensaje({ tipo: 'error', texto: 'El origen y destino deben ser diferentes' })
      return
    }

    const cantNum = parseInt(cantidad)
    if (isNaN(cantNum) || cantNum <= 0) {
      setMensaje({ tipo: 'error', texto: 'La cantidad debe ser un número mayor a 0' })
      return
    }

    setSubmitting(true)
    try {
      const { fecha: fechaLocal, hora: horaLocal } = formatLocalDateTimeParts(timezone)
      const result = await cargaArchivosService.agregarEnvios([{
        destino,
        fechaLocal,
        horaLocal,
        cantidad: cantNum,
        timezone,
        clienteId: CLIENTE_PRUEBA_OPERACION_DIARIA,
      }])

      if (result.success) {
        setMensaje({ tipo: 'success', texto: `Envío agregado correctamente (${result.enviosAgregados} envío(s))` })
        setDestino('')
        setCantidad('')
        await cargarDatos()
      } else {
        setMensaje({ tipo: 'error', texto: result.message })
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al agregar el envío' })
    } finally {
      setSubmitting(false)
    }
  }

  const currentLocalTime = formatLocalDateTimeParts(timezone)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-sky-400 border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-gray-400">Cargando datos...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-gray-200 mb-4">Agregar nuevo envío</h3>
        <form onSubmit={handleSubmit} className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-4">
          {mensaje && (
            <div className={`px-4 py-2 rounded-lg text-sm ${mensaje.tipo === 'success' ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-700' : 'bg-red-900/50 text-red-400 border border-red-700'}`}>
              {mensaje.texto}
            </div>
          )}

          <StationSelectorCard
            browserTimezone={stationState.browserTimezone}
            selectedStation={selectedStation}
            requiresManualSelection={stationState.requiresManualSelection}
            onSelectStation={handleManualStationSelection}
            localDateTimeText={`${currentLocalTime.fecha} ${currentLocalTime.horaConSegundos}`}
            airportLabel="Origen usado para el envío"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cliente</label>
              <input
                type="text"
                value={CLIENTE_PRUEBA_OPERACION_DIARIA}
                readOnly
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Aeropuerto destino</label>
              <select
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">Seleccionar...</option>
                {aeropuertos
                  .filter((a) => a.codigoOACI !== origenDetectado)
                  .map(a => (
                  <option key={a.codigoOACI} value={a.codigoOACI}>
                    {a.codigoOACI} - {getAirportCity(a.codigoOACI) || a.ciudad || a.codigoOACI}
                  </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Cantidad de maletas</label>
              <input
                type="number"
                min="1"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                placeholder="Ej: 50"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !origenDetectado}
            className="w-full sm:w-auto px-6 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-sky-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {submitting ? 'Agregando...' : 'Agregar envío'}
          </button>
        </form>
      </div>

      <div>
        <h3 className="text-lg font-bold text-gray-200 mb-3">
          Envíos agregados
          <span className="ml-2 text-sm font-normal text-gray-400">({enviosExistentes.length})</span>
        </h3>
        {enviosExistentes.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm bg-gray-800 border border-gray-700 rounded-lg">
            No hay envíos incrementales agregados
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {enviosExistentes.map(envio => (
              <div key={envio.id} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="font-medium text-gray-200">{envio.id}</span>
                  <span className="text-sky-300">Cliente {envio.clienteId}</span>
                  <span className="text-gray-400">
                    <span className="text-emerald-400">{getAirportCity(envio.origen) || envio.origen}</span>
                    {' → '}
                    <span className="text-red-400">{getAirportCity(envio.destino) || envio.destino}</span>
                  </span>
                  <span className="text-gray-400">{envio.fecha} {envio.hora}</span>
                  <span className="text-amber-400">{envio.cantidad} maletas</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
