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
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<CargaResult | null>(null)
  const [error, setError] = useState<string | null>(null)
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
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Error al subir los archivos. Verifique el formato.'
      setError(msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <StationSelectorCard
        browserTimezone={stationState.browserTimezone}
        selectedStation={selectedStation}
        requiresManualSelection={stationState.requiresManualSelection}
        onSelectStation={handleManualStationSelection}
        airportLabel="Origen usado para la carga"
      />

      <FileInput label="Archivo de vuelos (planes_vuelo.txt — opcional)" onChange={setPlanesVuelo} />
      <FileInput label="Archivo de aeropuertos (aeropuertos.txt — opcional)" onChange={setAeropuertos} />
      <FileInput label="Archivo de envíos (.txt — obligatorio, se carga usando el aeropuerto detectado de esta PC)" onChange={setEnvios} />

      <button
        onClick={handleUpload}
        disabled={uploading || !envios || !origenDetectado}
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
          <p>Aeropuertos: {result.aeropuertosCount}</p>
          <p>Vuelos: {result.vuelosCount}</p>
          <p>Paquetes: {result.paquetesCount}</p>
        </div>
      )}
    </div>
  )
}

function FileInput({ label, onChange }: { label: string; onChange: (f: File | null) => void }) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
        type="file"
        accept=".txt"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 cursor-pointer"
      />
    </div>
  )
}
