import { useState } from 'react'
import { cargaArchivosService } from '../services/CargaArchivosService'
import AgregarEnvios from '../components/AgregarEnvios'
import { getAirportCityCountry } from '../data/airportsData'
import type { CargaResult } from '../types'

type Tab = 'carga' | 'envios'
const TIMEZONE_TO_AIRPORT: Record<string, string> = {
  'America/Lima': 'SPIM',
  'America/Argentina/Buenos_Aires': 'SABE',
  'Europe/Copenhagen': 'EKCH',
  'Asia/Kolkata': 'VIDP',
}

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
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const origenDetectado = TIMEZONE_TO_AIRPORT[timezone] ?? null

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
      <div className={`rounded-lg border px-4 py-3 text-sm ${origenDetectado ? 'border-sky-700 bg-sky-950/30' : 'border-red-700 bg-red-950/30'}`}>
        <p className="text-gray-300">
          <span className="font-semibold text-gray-100">Zona horaria detectada:</span>{' '}
          <span className={origenDetectado ? 'text-sky-300' : 'text-red-300'}>{timezone}</span>
        </p>
        <p className="mt-1 text-gray-300">
          <span className="font-semibold text-gray-100">Origen detectado para la carga:</span>{' '}
          {origenDetectado ? (
            <span className="text-emerald-300">{origenDetectado} - {getAirportCityCountry(origenDetectado)}</span>
          ) : (
            <span className="text-red-300">No corresponde a SPIM, SABE, EKCH o VIDP</span>
          )}
        </p>
      </div>

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
