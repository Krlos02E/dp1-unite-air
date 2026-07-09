import { useState, useEffect } from 'react'
import type { AlmacenDTO } from '../types'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSave: (data: AlmacenDTO) => Promise<void>
  almacen?: AlmacenDTO | null
}

const CONTINENTES = ['AMERICA', 'EUROPA', 'ASIA']
const TIMEZONE_OFFSETS = [
  { value: -300, label: 'UTC-5' },
  { value: -240, label: 'UTC-4' },
  { value: -180, label: 'UTC-3' },
  { value: 0, label: 'UTC' },
  { value: 60, label: 'UTC+1' },
  { value: 120, label: 'UTC+2' },
  { value: 180, label: 'UTC+3' },
  { value: 240, label: 'UTC+4' },
  { value: 270, label: 'UTC+4:30' },
  { value: 300, label: 'UTC+5' },
  { value: 330, label: 'UTC+5:30' },
  { value: 480, label: 'UTC+8' },
]

export default function AlmacenFormModal({ isOpen, onClose, onSave, almacen }: Props) {
  const isEditing = !!almacen
  const [codigoOACI, setCodigoOACI] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [pais, setPais] = useState('')
  const [continente, setContinente] = useState('AMERICA')
  const [gmtOffsetMinutos, setGmtOffsetMinutos] = useState(-300)
  const [capacidadMaxima, setCapacidadMaxima] = useState(500)
  const [latitud, setLatitud] = useState('')
  const [longitud, setLongitud] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (almacen) {
      setCodigoOACI(almacen.codigoOACI)
      setCiudad(almacen.ciudad || '')
      setPais(almacen.pais || '')
      setContinente(almacen.continente || 'AMERICA')
      setGmtOffsetMinutos(almacen.gmtOffsetMinutos)
      setCapacidadMaxima(almacen.capacidadMaxima)
      setLatitud(String(almacen.latitud))
      setLongitud(String(almacen.longitud))
    } else {
      setCodigoOACI('')
      setCiudad('')
      setPais('')
      setContinente('AMERICA')
      setGmtOffsetMinutos(-300)
      setCapacidadMaxima(500)
      setLatitud('')
      setLongitud('')
    }
    setError(null)
  }, [almacen, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!isEditing && !codigoOACI.trim()) {
      setError('El código OACI es obligatorio')
      return
    }
    if (!ciudad.trim()) {
      setError('La ciudad es obligatoria')
      return
    }
    if (capacidadMaxima <= 0) {
      setError('La capacidad debe ser mayor que 0')
      return
    }
    const lat = parseFloat(latitud)
    const lon = parseFloat(longitud)
    if (isNaN(lat) || isNaN(lon)) {
      setError('Ingrese coordenadas válidas')
      return
    }

    setSaving(true)
    try {
      await onSave({
        codigoOACI: codigoOACI.trim().toUpperCase(),
        ciudad: ciudad.trim(),
        pais: pais.trim(),
        continente,
        gmtOffsetMinutos,
        capacidadMaxima,
        latitud: lat,
        longitud: lon,
      })
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-100">
            {isEditing ? 'Editar Almacén' : 'Nuevo Almacén'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 p-3 rounded-lg text-sm">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Código OACI</label>
              <input
                type="text"
                value={codigoOACI}
                onChange={(e) => setCodigoOACI(e.target.value)}
                disabled={isEditing}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50 focus:outline-none focus:border-sky-500"
                placeholder="SKBO"
                maxLength={4}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Continente</label>
              <select
                value={continente}
                onChange={(e) => setContinente(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              >
                {CONTINENTES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Ciudad</label>
              <input
                type="text"
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="Bogotá"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">País</label>
              <input
                type="text"
                value={pais}
                onChange={(e) => setPais(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="Colombia"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Zona horaria (GMT)</label>
              <select
                value={gmtOffsetMinutos}
                onChange={(e) => setGmtOffsetMinutos(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              >
                {TIMEZONE_OFFSETS.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Capacidad máxima (maletas)</label>
              <input
                type="number"
                value={capacidadMaxima}
                onChange={(e) => setCapacidadMaxima(Number(e.target.value))}
                min={1}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Latitud</label>
              <input
                type="number"
                step="any"
                value={latitud}
                onChange={(e) => setLatitud(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="4.7016"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Longitud</label>
              <input
                type="number"
                step="any"
                value={longitud}
                onChange={(e) => setLongitud(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="-74.1469"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-sky-600 hover:bg-sky-500 disabled:bg-gray-600 text-white py-2 rounded-lg font-medium text-sm transition-colors"
            >
              {saving ? 'Guardando...' : isEditing ? 'Actualizar' : 'Crear'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg font-medium text-sm transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
