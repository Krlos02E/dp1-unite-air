import { useState, useEffect, useCallback } from 'react'
import { cargaArchivosService } from '../services/CargaArchivosService'
import { getAirportCity, getAirportTimezone } from '../data/airportsData'
import type { AeropuertoDTO, EnvioIncremental } from '../types'

const SHARED_ENVIOS_POLL_MS = 5000

export default function AgregarEnvios() {
  const [aeropuertos, setAeropuertos] = useState<AeropuertoDTO[]>([])
  const [enviosExistentes, setEnviosExistentes] = useState<EnvioIncremental[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null)

  const [remitente, setRemitente] = useState('')
  const [origen, setOrigen] = useState('')
  const [destino, setDestino] = useState('')
  const [fecha, setFecha] = useState('')
  const [hora, setHora] = useState('')
  const [cantidad, setCantidad] = useState('')

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

    if (!remitente || !origen || !destino || !fecha || !hora || !cantidad) {
      setMensaje({ tipo: 'error', texto: 'Todos los campos son obligatorios' })
      return
    }

    if (origen === destino) {
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
      const result = await cargaArchivosService.agregarEnvios([{
        origen,
        destino,
        fecha,
        hora,
        cantidad: cantNum,
        remitente,
      }])

      if (result.success) {
        setMensaje({ tipo: 'success', texto: `Envío agregado correctamente (${result.enviosAgregados} envío(s))` })
        setRemitente('')
        setOrigen('')
        setDestino('')
        setFecha('')
        setHora('')
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Ciudad del remitente</label>
              <select
                value={remitente}
                onChange={(e) => setRemitente(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">Seleccionar...</option>
                {aeropuertos.map(a => (
                  <option key={a.codigoOACI} value={a.codigoOACI}>
                    {a.codigoOACI} - {getAirportCity(a.codigoOACI) || a.ciudad || a.codigoOACI}
                  </option>
                ))}
              </select>
              {remitente && (
                <p className="text-xs text-gray-500 mt-1">
                  Zona horaria: {getAirportTimezone(remitente) || 'N/A'}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Aeropuerto origen</label>
              <select
                value={origen}
                onChange={(e) => setOrigen(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">Seleccionar...</option>
                {aeropuertos.map(a => (
                  <option key={a.codigoOACI} value={a.codigoOACI}>
                    {a.codigoOACI} - {getAirportCity(a.codigoOACI) || a.ciudad || a.codigoOACI}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Aeropuerto destino</label>
              <select
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">Seleccionar...</option>
                {aeropuertos.map(a => (
                  <option key={a.codigoOACI} value={a.codigoOACI}>
                    {a.codigoOACI} - {getAirportCity(a.codigoOACI) || a.ciudad || a.codigoOACI}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Hora (HH:mm)
                {remitente && (
                  <span className="text-gray-500 font-normal ml-1">
                    — Hora de {getAirportCity(remitente) || remitente} ({getAirportTimezone(remitente) || 'N/A'})
                  </span>
                )}
              </label>
              <input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              />
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
            disabled={submitting}
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
