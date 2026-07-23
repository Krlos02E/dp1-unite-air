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
  compact?: boolean
}

export default function StationSelectorCard({
  browserTimezone,
  selectedStation,
  requiresManualSelection,
  onSelectStation,
  localDateTimeText,
  airportLabel = 'Sede seleccionada',
  compact = false,
}: Props) {
  const selectedStationId = selectedStation?.id ?? ''
  const containerClass = compact
    ? `rounded-lg border px-3 py-2 text-[11px] ${
        selectedStation
          ? 'border-sky-700/70 bg-gray-950/55'
          : 'border-red-700/70 bg-red-950/20'
      }`
    : `rounded-lg border px-4 py-3 text-sm ${
        selectedStation
          ? 'border-sky-700 bg-sky-950/30'
          : 'border-red-700 bg-red-950/30'
      }`

  return (
    <div className={containerClass}>
      {compact ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-start gap-2">
            <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
              PC
            </span>
            <span className={`min-w-0 break-all font-mono ${selectedStation ? 'text-sky-300' : 'text-red-300'}`}>
              {browserTimezone}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <span className="block text-[9px] uppercase tracking-wide text-gray-500">{airportLabel}</span>
              {selectedStation ? (
                <span className="block break-words font-semibold text-emerald-300">
                  {selectedStation.airportCode} - {getAirportCityCountry(selectedStation.airportCode)}
                </span>
              ) : (
                <span className="block break-words text-red-300">
                  Debe elegirse manualmente una de las cuatro sedes válidas
                </span>
              )}
            </div>
            <div className="min-w-0">
              <span className="block text-[9px] uppercase tracking-wide text-gray-500">Zona canónica</span>
              {selectedStation ? (
                <span className="block break-all font-mono text-emerald-300">{selectedStation.canonicalTimezone}</span>
              ) : (
                <span className="block text-red-300">No reconocida</span>
              )}
            </div>
          </div>
          {localDateTimeText && (
            <p className="text-[10px] text-gray-400">
              Hora local usada: <span className="font-mono text-gray-200">{localDateTimeText}</span>
            </p>
          )}
        </div>
      ) : (
        <>
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
        </>
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
