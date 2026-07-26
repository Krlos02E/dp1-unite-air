import { useEffect, useRef, useState } from 'react'
import type { AeropuertoDTO, ProgramacionVueloDTO } from '../types'

interface Props {
  isOpen: boolean
  aeropuertos: AeropuertoDTO[]
  programacion?: ProgramacionVueloDTO | null
  defaultOriginOACI?: string | null
  defaultHoraSalidaLocal?: string | null
  onClose: () => void
  onSave: (data: ProgramacionVueloDTO) => Promise<void>
}

function addHoursToTime(baseTime: string, hoursToAdd: number): string {
  const [hoursRaw, minutesRaw] = baseTime.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return '10:00'

  const totalMinutes = (hours * 60 + minutes + hoursToAdd * 60) % (24 * 60)
  const normalized = totalMinutes >= 0 ? totalMinutes : totalMinutes + 24 * 60
  const nextHours = Math.floor(normalized / 60)
  const nextMinutes = normalized % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`
}

export default function VueloProgramacionModal({
  isOpen,
  aeropuertos,
  programacion,
  defaultOriginOACI,
  defaultHoraSalidaLocal,
  onClose,
  onSave,
}: Props) {
  const isEditing = Boolean(programacion?.id)
  const [origenOACI, setOrigenOACI] = useState('')
  const [destinoOACI, setDestinoOACI] = useState('')
  const [horaSalidaLocal, setHoraSalidaLocal] = useState('08:00')
  const [horaLlegadaLocal, setHoraLlegadaLocal] = useState('10:00')
  const [capacidad, setCapacidad] = useState(120)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initializedForOpenRef = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      initializedForOpenRef.current = false
      return
    }
    if (initializedForOpenRef.current) return
    initializedForOpenRef.current = true

    if (programacion) {
      setOrigenOACI(programacion.origenOACI)
      setDestinoOACI(programacion.destinoOACI)
      setHoraSalidaLocal(programacion.horaSalidaLocal)
      setHoraLlegadaLocal(programacion.horaLlegadaLocal)
      setCapacidad(programacion.capacidad)
    } else {
      const suggestedOrigin = (
        defaultOriginOACI
        && aeropuertos.some((a) => a.codigoOACI === defaultOriginOACI)
      )
        ? defaultOriginOACI
        : (aeropuertos[0]?.codigoOACI || '')
      const suggestedDestination = aeropuertos.find((a) => a.codigoOACI !== suggestedOrigin)?.codigoOACI
        || aeropuertos[0]?.codigoOACI
        || ''
      const suggestedDeparture = defaultHoraSalidaLocal || '08:00'

      setOrigenOACI(suggestedOrigin)
      setDestinoOACI(suggestedDestination)
      setHoraSalidaLocal(suggestedDeparture)
      setHoraLlegadaLocal(addHoursToTime(suggestedDeparture, 2))
      setCapacidad(120)
    }
    setError(null)
  }, [programacion, isOpen, aeropuertos, defaultOriginOACI, defaultHoraSalidaLocal])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!origenOACI) {
      setError('Seleccione el almacén origen')
      return
    }
    if (!destinoOACI) {
      setError('Seleccione el almacén destino')
      return
    }
    if (origenOACI === destinoOACI) {
      setError('El origen y el destino deben ser diferentes')
      return
    }
    if (!horaSalidaLocal || !horaLlegadaLocal) {
      setError('Las horas son obligatorias')
      return
    }
    if (capacidad <= 0) {
      setError('La capacidad debe ser mayor que 0')
      return
    }

    setSaving(true)
    try {
      await onSave({
        id: programacion?.id,
        origenOACI,
        destinoOACI,
        horaSalidaLocal,
        horaLlegadaLocal,
        capacidad,
      })
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Error al guardar la programación')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-100">
            {isEditing ? 'Editar UT recurrente' : 'Nueva UT recurrente'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 p-3 rounded-lg text-sm">{error}</div>
          )}

          <div className="bg-sky-950/40 border border-sky-900/70 text-sky-200 rounded-lg p-3 text-xs">
            Esta programación se replica todos los días dentro del contexto actual.
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Origen</label>
              <select
                value={origenOACI}
                onChange={(e) => setOrigenOACI(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              >
                {aeropuertos.map((a) => (
                  <option key={a.codigoOACI} value={a.codigoOACI}>{a.codigoOACI}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Destino</label>
              <select
                value={destinoOACI}
                onChange={(e) => setDestinoOACI(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              >
                {aeropuertos.map((a) => (
                  <option key={a.codigoOACI} value={a.codigoOACI}>{a.codigoOACI}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Hora de salida local</label>
              <input
                type="time"
                value={horaSalidaLocal}
                onChange={(e) => setHoraSalidaLocal(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Hora de llegada local</label>
              <input
                type="time"
                value={horaLlegadaLocal}
                onChange={(e) => setHoraLlegadaLocal(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Capacidad (maletas)</label>
            <input
              type="number"
              min={1}
              value={capacidad}
              onChange={(e) => setCapacidad(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
            />
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
