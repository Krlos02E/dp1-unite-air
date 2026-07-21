import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatLocalDateTimeParts,
  getOffsetMinutesForTimezone,
  getStationById,
  normalizeCanonicalTimezone,
  resolveStationState,
  resolveStationByTimezone,
  saveManualStationSelection,
  type StorageLike,
} from '../src/utils/stationTimezone.ts'
import { formatTimeInTimezone } from '../src/utils/timezoneFormat.ts'

class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>()

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }
}

test('reconoce las cuatro zonas canonicas', () => {
  assert.equal(resolveStationByTimezone('America/Lima')?.airportCode, 'SPIM')
  assert.equal(resolveStationByTimezone('America/Argentina/Buenos_Aires')?.airportCode, 'SABE')
  assert.equal(resolveStationByTimezone('Europe/Copenhagen')?.airportCode, 'EKCH')
  assert.equal(resolveStationByTimezone('Asia/Kolkata')?.airportCode, 'VIDP')
})

test('normaliza aliases permitidos a la zona canonica', () => {
  assert.equal(normalizeCanonicalTimezone('America/Buenos_Aires'), 'America/Argentina/Buenos_Aires')
  assert.equal(normalizeCanonicalTimezone('Asia/Calcutta'), 'Asia/Kolkata')
})

test('rechaza zonas no permitidas sin inferir por offset', () => {
  assert.equal(resolveStationByTimezone('Europe/Berlin'), null)
})

test('permite seleccionar manualmente una sede durante la sesion', () => {
  const storage = new MemoryStorage()
  saveManualStationSelection('COPENHAGEN', storage)

  const state = resolveStationState('Europe/Berlin', storage)
  assert.equal(state.requiresManualSelection, true)
  assert.equal(state.source, 'manual')
  assert.equal(state.station?.canonicalTimezone, 'Europe/Copenhagen')
})

test('usa la zona detectada por alias permitido por encima de la seleccion manual previa', () => {
  const storage = new MemoryStorage()
  saveManualStationSelection('LIMA', storage)

  const state = resolveStationState('America/Buenos_Aires', storage)
  assert.equal(state.source, 'detected')
  assert.equal(state.station?.id, 'BUENOS_AIRES')
  assert.equal(state.station?.canonicalTimezone, 'America/Argentina/Buenos_Aires')
})

test('Copenhague usa horario de invierno y verano automaticamente', () => {
  assert.equal(formatTimeInTimezone('2026-01-15T12:00:00Z', 'Europe/Copenhagen'), '13:00')
  assert.equal(formatTimeInTimezone('2026-07-15T12:00:00Z', 'Europe/Copenhagen'), '14:00')
  assert.equal(getOffsetMinutesForTimezone('Europe/Copenhagen', new Date('2026-01-15T12:00:00Z')), 60)
  assert.equal(getOffsetMinutesForTimezone('Europe/Copenhagen', new Date('2026-07-15T12:00:00Z')), 120)
})

test('la sede manual produce fecha y hora con la zona canonica seleccionada', () => {
  const station = getStationById('DELHI')
  const parts = formatLocalDateTimeParts(station.canonicalTimezone, new Date('2026-07-21T00:00:00Z'))
  assert.equal(parts.fecha, '2026-07-21')
  assert.equal(parts.hora, '05:30')
})
