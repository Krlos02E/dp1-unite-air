import { useCallback, useEffect, useState } from 'react'
import { cargaArchivosService } from '../services/CargaArchivosService'
import AgregarEnvios from '../components/AgregarEnvios'
import StationSelectorCard from '../components/StationSelectorCard'
import type { CargaResult } from '../types'
import {
  getStationById,
  resolveStationState,
  saveManualStationSelection,
  type StationId,
} from '../utils/stationTimezone'

type Tab = 'carga' | 'envios'

export default function GestionEnvios() {
  const [tab, setTab] = useState<Tab>('carga')

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl sm:text-2xl font-bold mb-6">Gestión de Envíos</h2>

      <div className="flex gap-1 mb-6 bg-gray-900 border border-gray-800 rounded-lg p-1">
        <TabButton active={tab === 'carga'} onClick={() => setTab('carga')}>
          Carga de Archivos
        </TabButton>
        <TabButton active={tab === 'envios'} onClick={() => setTab('envios')}>
          Agregar Envíos
        </TabButton>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        {tab === 'carga' && <CargaArchivosTab />}
        {tab === 'envios' && <AgregarEnvios />}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
        active
          ? 'bg-sky-600 text-white'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
      }`}
    >
      {children}
    </button>
  )
}

function CargaArchivosTab() {
  const [planesVuelo, setPlanesVuelo] = useState<File | null>(null)
  const [aeropuertos, setAeropuertos] = useState<File | null>(null)
  const [envios, setEnvios] = useState<File | null>(null)
  const [fileInputResetToken, setFileInputResetToken] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<CargaResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stationState, setStationState] = useState(() => resolveStationState())
  const selectedStation = stationState.station
  const timezone = selectedStation?.canonicalTimezone ?? 'UTC'
  const origenDetectado = selectedStation?.airportCode ?? null
  const tieneArchivos = Boolean(planesVuelo || aeropuertos || envios)
  const requiereOrigenDetectado = Boolean(envios)
  const uploadDisabled = uploading || !tieneArchivos || (requiereOrigenDetectado && !origenDetectado)
  const archivosSeleccionados = [planesVuelo, aeropuertos, envios].filter(Boolean).length
  const puedeSubirSoloOperacion = Boolean(planesVuelo || aeropuertos)
  const puedeSubirEnvios = Boolean(envios && origenDetectado)

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

  const handleUpload = async () => {
    setError(null)
    setResult(null)
    setProgress(0)
    setUploading(true)

    try {
      const res = await cargaArchivosService.upload(
        {
          planes_vuelo: planesVuelo ?? undefined,
          aeropuertos: aeropuertos ?? undefined,
          envios: envios ?? undefined,
        },
        timezone,
        (pct) => setProgress(pct)
      )
      setResult(res)
      setPlanesVuelo(null)
      setAeropuertos(null)
      setEnvios(null)
      setFileInputResetToken((current) => current + 1)
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Error al subir los archivos. Verifique el formato.'
      setError(msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-800/70 bg-sky-950/30 p-4 text-sm text-sky-100">
        <p className="font-semibold text-sky-200">Puedes subir cualquier archivo por separado</p>
        <p className="mt-1 text-sky-100/80">
          `planes_vuelo.txt`, `aeropuerto.txt` y `envios.txt` son independientes. Solo el archivo de envíos
          necesita detectar la sede de origen.
        </p>
      </div>

      <StationSelectorCard
        browserTimezone={stationState.browserTimezone}
        selectedStation={selectedStation}
        requiresManualSelection={stationState.requiresManualSelection}
        onSelectStation={handleManualStationSelection}
        airportLabel="Origen usado para la carga"
      />

      <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Carga operativa</h3>
          <p className="text-sm text-gray-400">
            Puedes subir vuelos, aeropuertos o ambos. No depende del archivo de envíos.
          </p>
        </div>
        <FileInput
          label="Archivo de vuelos"
          hint="`planes_vuelo.txt`"
          file={planesVuelo}
          onChange={setPlanesVuelo}
          resetToken={fileInputResetToken}
        />
        <FileInput
          label="Archivo de aeropuertos"
          hint="`aeropuerto.txt`"
          file={aeropuertos}
          onChange={setAeropuertos}
          resetToken={fileInputResetToken}
        />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Carga de envíos</h3>
          <p className="text-sm text-gray-400">
            Este archivo también se puede subir solo, pero usa el aeropuerto detectado para esta sede.
          </p>
        </div>
        <FileInput
          label="Archivo de envíos"
          hint="`.txt`"
          file={envios}
          onChange={setEnvios}
          resetToken={fileInputResetToken}
        />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-4 space-y-2 text-sm">
        <p className="font-semibold text-gray-100">Resumen de carga</p>
        <p className="text-gray-300">
          {archivosSeleccionados === 0
            ? 'Aún no has seleccionado archivos.'
            : `Has seleccionado ${archivosSeleccionados} archivo${archivosSeleccionados === 1 ? '' : 's'}.`}
        </p>
        <p className={puedeSubirSoloOperacion ? 'text-emerald-300' : 'text-gray-400'}>
          {puedeSubirSoloOperacion
            ? 'Carga operativa lista para subir.'
            : 'Sin archivos operativos seleccionados todavía.'}
        </p>
        <p className={puedeSubirEnvios ? 'text-emerald-300' : requiereOrigenDetectado ? 'text-amber-300' : 'text-gray-400'}>
          {puedeSubirEnvios
            ? `Carga de envíos lista con origen ${origenDetectado}.`
            : requiereOrigenDetectado
              ? 'Seleccionaste envíos, pero falta confirmar el origen detectado.'
              : 'No hay archivo de envíos seleccionado.'}
        </p>
      </div>

      {!tieneArchivos && (
        <div className="bg-amber-900/40 border border-amber-700 text-amber-200 p-3 rounded-lg text-sm">
          Puedes subir solo uno si quieres. Solo necesitamos que selecciones al menos un archivo.
        </div>
      )}

      {requiereOrigenDetectado && !origenDetectado && (
        <div className="bg-amber-900/40 border border-amber-700 text-amber-200 p-3 rounded-lg text-sm">
          Para subir envíos necesitamos identificar el aeropuerto de origen de esta sede.
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={uploadDisabled}
        className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-gray-600 disabled:cursor-not-allowed py-2.5 rounded-lg font-semibold"
      >
        {uploading ? 'Subiendo...' : 'Subir Archivos'}
      </button>

      {uploading && (
        <div className="w-full bg-gray-700 rounded-full h-4">
          <div className="bg-sky-500 h-4 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-emerald-900/50 border border-emerald-700 text-emerald-300 p-4 rounded-lg space-y-1">
          <p className="font-semibold">{result.message}</p>
          {result.aeropuertosCount > 0 && <p>Aeropuertos cargados desde archivo: {result.aeropuertosCount}</p>}
          {result.vuelosCount > 0 && <p>Vuelos cargados desde archivo: {result.vuelosCount}</p>}
          {result.paquetesCount > 0 && <p>Envíos cargados desde archivo: {result.paquetesCount}</p>}
        </div>
      )}
    </div>
  )
}

function FileInput({
  label,
  hint,
  file,
  onChange,
  resetToken,
}: {
  label: string
  hint?: string
  file: File | null
  onChange: (f: File | null) => void
  resetToken: number
}) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-1">
        {label}
        {hint && <span className="ml-2 text-gray-500">{hint}</span>}
      </label>
      <input
        key={resetToken}
        type="file"
        accept=".txt"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 cursor-pointer"
      />
      <p className={`mt-1 text-sm ${file ? 'text-emerald-300' : 'text-gray-500'}`}>
        {file ? `Seleccionado: ${file.name}` : 'Ningún archivo seleccionado'}
      </p>
    </div>
  )
}
