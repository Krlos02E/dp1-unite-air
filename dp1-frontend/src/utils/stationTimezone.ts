export const SEDES_TIMEZONE = {
  LIMA: ['America/Lima'],
  BUENOS_AIRES: [
    'America/Argentina/Buenos_Aires',
    'America/Buenos_Aires',
  ],
  COPENHAGEN: ['Europe/Copenhagen'],
  DELHI: [
    'Asia/Kolkata',
    'Asia/Calcutta',
  ],
} as const

export type StationId = keyof typeof SEDES_TIMEZONE

export interface StationDefinition {
  id: StationId
  label: string
  airportCode: string
  canonicalTimezone: string
  aliases: readonly string[]
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ResolvedStationState {
  browserTimezone: string
  station: StationDefinition | null
  source: 'detected' | 'manual' | null
  requiresManualSelection: boolean
}

const SESSION_KEY = 'operacion-diaria-station-id'

const STATIONS: Record<StationId, StationDefinition> = {
  LIMA: {
    id: 'LIMA',
    label: 'Lima',
    airportCode: 'SPIM',
    canonicalTimezone: 'America/Lima',
    aliases: SEDES_TIMEZONE.LIMA,
  },
  BUENOS_AIRES: {
    id: 'BUENOS_AIRES',
    label: 'Buenos Aires',
    airportCode: 'SABE',
    canonicalTimezone: 'America/Argentina/Buenos_Aires',
    aliases: SEDES_TIMEZONE.BUENOS_AIRES,
  },
  COPENHAGEN: {
    id: 'COPENHAGEN',
    label: 'Copenhague',
    airportCode: 'EKCH',
    canonicalTimezone: 'Europe/Copenhagen',
    aliases: SEDES_TIMEZONE.COPENHAGEN,
  },
  DELHI: {
    id: 'DELHI',
    label: 'Delhi',
    airportCode: 'VIDP',
    canonicalTimezone: 'Asia/Kolkata',
    aliases: SEDES_TIMEZONE.DELHI,
  },
}

const ALIAS_TO_STATION = new Map<string, StationDefinition>()
for (const station of Object.values(STATIONS)) {
  for (const alias of station.aliases) {
    ALIAS_TO_STATION.set(alias, station)
  }
}

export const STATION_OPTIONS = Object.values(STATIONS)

function getSessionStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage
  if (typeof window === 'undefined' || !window.sessionStorage) return null
  return window.sessionStorage
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function getStationById(stationId: StationId): StationDefinition {
  return STATIONS[stationId]
}

export function resolveStationByTimezone(timezone?: string | null): StationDefinition | null {
  if (!timezone) return null
  return ALIAS_TO_STATION.get(timezone) ?? null
}

export function normalizeCanonicalTimezone(timezone?: string | null): string | null {
  return resolveStationByTimezone(timezone)?.canonicalTimezone ?? null
}

export function saveManualStationSelection(stationId: StationId, storage?: StorageLike): void {
  const sessionStorage = getSessionStorage(storage)
  sessionStorage?.setItem(SESSION_KEY, stationId)
}

export function clearManualStationSelection(storage?: StorageLike): void {
  const sessionStorage = getSessionStorage(storage)
  sessionStorage?.removeItem(SESSION_KEY)
}

export function getManualStationSelection(storage?: StorageLike): StationDefinition | null {
  const sessionStorage = getSessionStorage(storage)
  const rawValue = sessionStorage?.getItem(SESSION_KEY) ?? null
  if (!rawValue) return null
  return STATIONS[rawValue as StationId] ?? null
}

export function resolveStationState(
  browserTimezone = getBrowserTimezone(),
  storage?: StorageLike,
): ResolvedStationState {
  const detectedStation = resolveStationByTimezone(browserTimezone)
  if (detectedStation) {
    return {
      browserTimezone,
      station: detectedStation,
      source: 'detected',
      requiresManualSelection: false,
    }
  }

  const manualStation = getManualStationSelection(storage)
  return {
    browserTimezone,
    station: manualStation,
    source: manualStation ? 'manual' : null,
    requiresManualSelection: true,
  }
}

export function formatLocalDateTimeParts(
  timeZone: string,
  at: Date = new Date(),
): { fecha: string; hora: string; horaConSegundos: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(at)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return {
    fecha: `${get('year')}-${get('month')}-${get('day')}`,
    hora: `${get('hour')}:${get('minute')}`,
    horaConSegundos: `${get('hour')}:${get('minute')}:${get('second')}`,
  }
}

export function getOffsetMinutesForTimezone(timeZone: string, at: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  })
  const parts = formatter.formatToParts(at)
  const offsetToken = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  if (offsetToken === 'GMT' || offsetToken === 'UTC') return 0

  const match = offsetToken.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!match) return 0

  const [, sign, hoursRaw, minutesRaw] = match
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw ?? '0')
  const total = hours * 60 + minutes
  return sign === '-' ? -total : total
}
