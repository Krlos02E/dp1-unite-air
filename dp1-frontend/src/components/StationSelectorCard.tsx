import type { StationDefinition, StationId } from '../utils/stationTimezone'
import { STATION_OPTIONS } from '../utils/stationTimezone'
import { getAirportCityCountry } from '../data/airportsData'

interface Props {
  browserTimezone: string
  selectedStation: StationDefinition | null
  requiresManualSelection: boolean
  onSelectStation: (stationId: StationId) => void
  localDateTimeText?: string
  airportLabel?: string
}

export default function StationSelectorCard({
  browserTimezone,
  selectedStation,
  requiresManualSelection,
  onSelectStation,
  localDateTimeText,
  airportLabel = 'Sede seleccionada',
}: Props) {
  const selectedStationId = selectedStation?.id ?? ''

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${
      selectedStation
        ? 'border-sky-700 bg-sky-950/30'
        : 'border-red-700 bg-red-950/30'
    }`}>
      <p className="text-gray-300">
        <span className="font-semibold text-gray-100">Zona horaria detectada en la PC:</span>{' '}
        <span className={selectedStation ? 'text-sky-300' : 'text-red-300'}>{browserTimezone}</span>
      </p>
      <p className="mt-1 text-gray-300">
        <span className="font-semibold text-gray-100">Zona canónica usada:</span>{' '}
        {selectedStation ? (
          <span className="text-emerald-300">{selectedStation.canonicalTimezone}</span>
        ) : (
          <span className="text-red-300">No reconocida</span>
        )}
      </p>
      <p className="mt-1 text-gray-300">
        <span className="font-semibold text-gray-100">{airportLabel}:</span>{' '}
        {selectedStation ? (
          <span className="text-emerald-300">
            {selectedStation.airportCode} - {getAirportCityCountry(selectedStation.airportCode)}
          </span>
        ) : (
          <span className="text-red-300">Debe elegirse manualmente una de las cuatro sedes válidas</span>
        )}
      </p>
      {localDateTimeText && (
        <p className="mt-1 text-gray-400">
          Fecha/hora local usada: {localDateTimeText}
        </p>
      )}
      {requiresManualSelection && (
        <div className="mt-3 flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-amber-200">
            Seleccionar sede manualmente
          </label>
          <select
            value={selectedStationId}
            onChange={(event) => onSelectStation(event.target.value as StationId)}
            className="w-full rounded-lg border border-amber-600 bg-gray-950 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="" disabled>Elegir sede...</option>
            {STATION_OPTIONS.map((station) => (
              <option key={station.id} value={station.id}>
                {station.label} - {station.airportCode} - {station.canonicalTimezone}
              </option>
            ))}
          </select>
          <p className="text-xs text-amber-100/90">
            La selección se guardará durante esta sesión y se enviará al backend como zona canónica.
          </p>
        </div>
      )}
    </div>
  )
}
