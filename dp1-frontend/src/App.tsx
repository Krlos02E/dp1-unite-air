import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { SimulationProvider, useSimulation } from './context/SimulationContext'
import GestionEnvios from './pages/GestionEnvios'
import OperacionDiaria from './pages/OperacionDiaria'
import Simulacion from './pages/Simulacion'
import Colapso from './pages/Colapso'
import { simulationService } from './services/SimulationService'

const NAV_ITEMS = [
  { path: '/gestion-envios', label: 'Gestión de Envíos' },
  { path: '/operacion-diaria', label: 'Operación diaria' },
  { path: '/simulacion', label: 'Simulación del Periodo' },
  { path: '/colapso', label: 'Colapso' },
] as const

function App() {
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    simulationService.activa().then(() => {}).catch(() => {}).finally(() => setChecking(false))
  }, [])

  return (
    <BrowserRouter>
      <SimulationProvider>
        <AppContent checking={checking} />
      </SimulationProvider>
    </BrowserRouter>
  )
}

function AppContent({ checking }: { checking: boolean }) {
  const [showBlockModal, setShowBlockModal] = useState(false)
  const { simulationState, isRunning } = useSimulation()
  const location = useLocation()

  const isFinished =
    simulationState?.status === 'COMPLETADA' ||
    simulationState?.status === 'COLAPSADA' ||
    simulationState?.status === 'ERROR' ||
    (simulationState && simulationState.progreso >= 100)

  const isSimBlocking = isRunning && !isFinished

  const handleNavClick = (e: React.MouseEvent, path: string) => {
    if (isSimBlocking && path !== '/simulacion') {
      e.preventDefault()
      setShowBlockModal(true)
    }
  }

  const navLinkClass = (isActive: boolean, path: string) => {
    const isBlocked = isSimBlocking && path !== '/simulacion'
    return `text-sm sm:text-base shrink-0 transition-colors ${
      isBlocked
        ? 'text-gray-600 cursor-not-allowed'
        : isActive
          ? 'text-sky-400 font-bold'
          : 'hover:text-sky-300'
    }`
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {checking ? (
        <div className="flex items-center justify-center h-screen">
          <div className="w-8 h-8 border-4 border-sky-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <nav className="bg-gray-900 border-b border-gray-800 px-4 sm:px-5 py-1 flex items-center gap-3 sm:gap-5 overflow-x-auto">
            <h1 className="text-base sm:text-lg font-bold text-sky-400 shrink-0">UniteAir</h1>
            {NAV_ITEMS.map(({ path, label }) => (
              <NavLink
                key={path}
                to={path}
                onClick={(e) => handleNavClick(e, path)}
                className={({ isActive }) => navLinkClass(isActive, path)}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <main className="px-3 sm:px-5 pt-1 pb-4 sm:pb-5 flex-1">
            <Routes>
              <Route path="/" element={<Navigate to="/operacion-diaria" replace />} />
              <Route path="/gestion-envios" element={<GestionEnvios />} />
              <Route path="/operacion-diaria" element={<OperacionDiaria />} />
              <Route path="/simulacion" element={<Simulacion />} />
              <Route path="/colapso" element={<Colapso />} />
            </Routes>
          </main>

          {showBlockModal && (
            <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60">
              <div className="bg-gray-900 border border-amber-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
                <h3 className="text-lg font-bold text-amber-400 mb-2">Simulación en curso</h3>
                <p className="text-gray-300 text-sm mb-6">
                  No puedes cambiar de pestaña mientras la simulación está en ejecución. Detén la simulación para navegar.
                </p>
                <button
                  onClick={() => setShowBlockModal(false)}
                  className="w-full bg-sky-600 hover:bg-sky-700 py-2.5 rounded-lg font-semibold text-sm"
                >
                  Entendido
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default App
