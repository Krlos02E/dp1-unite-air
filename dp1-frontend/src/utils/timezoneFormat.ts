export const TIMEZONE_OPTIONS = [
  { label: 'UTC', offset: 0 },
  { label: 'UTC-5 (Peru/Colombia/Ecuador)', offset: -300 },
  { label: 'UTC-4 (Bolivia/Chile/Venezuela)', offset: -240 },
  { label: 'UTC-3 (Brasil/Argentina/Uruguay)', offset: -180 },
  { label: 'UTC+1 (Europa Central)', offset: 60 },
  { label: 'UTC+2 (Europa Oriental)', offset: 120 },
  { label: 'UTC+3 (Medio Oriente)', offset: 180 },
  { label: 'UTC+4 (Golfo)', offset: 240 },
  { label: 'UTC+5 (Pakistan)', offset: 300 },
  { label: 'UTC+5:30 (India)', offset: 330 },
]

function parseAsUtc(isoString: string): Date | null {
  if (!isoString) return null
  try {
    const str = isoString.endsWith('Z') ? isoString : isoString + 'Z'
    const d = new Date(str)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

export function formatTimeInTimezone(isoString: string, offsetMinutes: number): string {
  const d = parseAsUtc(isoString)
  if (!d) return '--'
  const utcMs = d.getTime()
  const targetMs = utcMs + offsetMinutes * 60000
  const target = new Date(targetMs)
  const hours = String(target.getUTCHours()).padStart(2, '0')
  const minutes = String(target.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function formatDateInTimezone(isoString: string, offsetMinutes: number): string {
  const d = parseAsUtc(isoString)
  if (!d) return '--'
  const utcMs = d.getTime()
  const targetMs = utcMs + offsetMinutes * 60000
  const target = new Date(targetMs)
  const day = String(target.getUTCDate()).padStart(2, '0')
  const month = String(target.getUTCMonth() + 1).padStart(2, '0')
  const year = target.getUTCFullYear()
  return `${day}/${month}/${year}`
}

export function extractUtcTime(isoString: string): string {
  if (!isoString || !isoString.includes('T')) return '--:--'
  return isoString.split('T')[1].substring(0, 5)
}

export function parseUtcOffsetLabel(offsetLabel?: string): number | null {
  if (!offsetLabel) return null

  const match = offsetLabel.trim().match(/^UTC([+-])(\d{1,2})(?::(\d{2}))?$/i)
  if (!match) return null

  const [, sign, hoursRaw, minutesRaw] = match
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw ?? '0')
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null

  const totalMinutes = hours * 60 + minutes
  return sign === '-' ? -totalMinutes : totalMinutes
}

export function formatLocalClockTimeInTimezone(
  localTime: string,
  sourceOffsetMinutes: number,
  targetOffsetMinutes: number,
): string {
  const match = localTime.trim().match(/^(\d{2}):(\d{2})/)
  if (!match) return '--:--'

  const [, hoursRaw, minutesRaw] = match
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (
    Number.isNaN(hours)
    || Number.isNaN(minutes)
    || hours < 0
    || hours > 23
    || minutes < 0
    || minutes > 59
  ) {
    return '--:--'
  }

  const totalMinutes = hours * 60 + minutes + (targetOffsetMinutes - sourceOffsetMinutes)
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440
  const targetHours = Math.floor(normalizedMinutes / 60)
  const targetMinutes = normalizedMinutes % 60

  return `${String(targetHours).padStart(2, '0')}:${String(targetMinutes).padStart(2, '0')}`
}
