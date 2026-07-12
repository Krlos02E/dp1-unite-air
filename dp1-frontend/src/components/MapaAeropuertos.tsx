import {useEffect, useRef, useState, memo, useMemo} from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { AeropuertoDTO, VueloDTO, EnvioEstado } from '../types'
import { buildAirportLookup, getAirportCityResolved, getAirportCountryResolved, AIRPORTS_DATA, type AirportLookupData } from '../data/airportsData'
import { TIMEZONE_OPTIONS } from '../utils/timezoneFormat'
import { shouldDisplayFlight } from '../utils/flightVisibility'

function tooltipForFlight(
  v: VueloDTO,
  airportLookup: Map<string, AirportLookupData>,
  simulationMode: boolean,
  referenceTime?: Date,
): string {
  const origen = getAirportCityResolved(v.origen, airportLookup) || v.origen
  const destino = getAirportCityResolved(v.destino, airportLookup) || v.destino
  const progreso = simulationMode
    ? v.progresoVuelo
    : (referenceTime ? calcularProgresoLocal(v, referenceTime) : calcularProgresoLocal(v, new Date()))
  return `<b>${v.id}</b><br>${origen} → ${destino}<br>Progreso: ${Math.round(progreso)}%<br>Maletas: ${v.cargaActual}/${v.capacidad}`
}

interface Props {
  aeropuertos: AeropuertoDTO[]
  vuelos: VueloDTO[]
  selectedVueloId?: string | null
  selectedAeropuertoId?: string | null
  selectedEnvio?: EnvioEstado | null
  selectedEnvioRouteMode?: 'actual' | 'anterior'
  velocidad?: number
  onAeropuertoClick?: (a: AeropuertoDTO) => void
  onVueloClick?: (v: VueloDTO) => void
  mapTz: number
  onMapTzChange: (tz: number) => void
  simulationMode?: boolean
  simulationTime?: string | null
  filteredFlightIds?: Set<string> | null
  filteredAirportIds?: Set<string> | null
}

const INITIAL_CENTER: [number, number] = [17, 0]
const WORLD_BOUNDS = L.latLngBounds(L.latLng(-60, -160), L.latLng(82, 160))

function aeropuertoColor(ocu: number, max: number): string {
  const ratio = max > 0 ? ocu / max : 0
  if (ratio <= 0) return '#38bdf8'
  if (ratio <= 0.7) return '#22c55e'
  if (ratio <= 0.9) return '#eab308'
  return '#ef4444'
}

const AIRPLANE_COLOR_GREEN = '#22c55e'
const AIRPLANE_COLOR_YELLOW = '#eab308'
const AIRPLANE_COLOR_RED = '#ef4444'
const MAP_SELECTION_COLOR = '#8b5cf6'
const BASE_ICON_SIZE = 29
const AIRPORT_ICON_RATIO = 0.9
const ROUTE_POINT_COUNT = 28

type RouteDisplayMode = 'all' | 'selected'
type RouteDirectionFilter = 'both' | 'outbound' | 'inbound'

function getAirplaneColor(cargaActual: number, capacidad: number): string {
  if (capacidad <= 0 || cargaActual <= 0) return '#38bdf8'
  const ratio = cargaActual / capacidad
  if (ratio <= 0.7) return AIRPLANE_COLOR_GREEN
  if (ratio <= 0.9) return AIRPLANE_COLOR_YELLOW
  return AIRPLANE_COLOR_RED
}

function getAirplaneIcon(selected: boolean, cargaActual: number, capacidad: number): L.DivIcon {
  const color = selected ? MAP_SELECTION_COLOR : getAirplaneColor(cargaActual, capacidad)
  const size = BASE_ICON_SIZE
  const glowFilter = selected
    ? 'filter:drop-shadow(0 0 5px #8b5cf6) drop-shadow(0 0 10px #8b5cf6);'
    : 'filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5));'
  return L.divIcon({
    className: '',
    html: `<div class="airplane-body" style="width:${size}px;height:${size}px;will-change:transform;${glowFilter}">
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 13 L10.2 8.5 L10.5 12.5 Z" fill="${color}"/>
        <path d="M23 13 L13.8 8.5 L13.5 12.5 Z" fill="${color}"/>
        <path d="M11.5 1 C11.5 1 10.2 6 10.2 12 C10.2 19 11.2 22.5 12 23 C12.8 22.5 13.8 19 13.8 12 C13.8 6 12.5 1 12.5 1 C12.5 1 12 0 12 0 C12 0 11.5 1 11.5 1 Z" fill="${color}"/>
        <path d="M10.2 18 L7 23.5 L10.2 22 Z" fill="${color}"/>
        <path d="M13.8 18 L17 23.5 L13.8 22 Z" fill="${color}"/>
        <ellipse cx="12" cy="3.5" rx="1.8" ry="2.8" fill="white" opacity="0.5"/>
      </svg>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function airportIcon(color: string, label: string, selected = false): L.DivIcon {
  const r = AIRPORT_ICON_RATIO
  const circleSize = Math.round(34 * r)
  const svgSize = Math.round(22 * r)
  const borderWidth = Math.max(1, Math.round(2 * r))
  const markerColor = selected ? MAP_SELECTION_COLOR : color
  const glow = selected
    ? 'box-shadow:0 0 6px #8b5cf6,0 0 14px #8b5cf6,0 0 24px rgba(139,92,246,0.65);'
    : 'box-shadow:0 2px 6px rgba(0,0,0,0.5);'
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
      <div style="width:${circleSize}px;height:${circleSize}px;border-radius:50%;background-color:${markerColor};border:${borderWidth}px solid white;display:flex;align-items:center;justify-content:center;${glow}">
        <svg width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8">
            <path d="M3.59 7h8.82a1 1 0 0 1 .902 1.433l-1.44 3a1 1 0 0 1-.901.567H5.029a1 1 0 0 1-.901-.567l-1.44-3A1 1 0 0 1 3.589 7"/>
            <path d="m6 7l-.78-2.342A.5.5 0 0 1 5.693 4h4.612a.5.5 0 0 1 .475.658L10 7M8 2v2m-2 8v9h4v-9m-7 9h18m1-16h-6l-1-1"/>
            <path d="m18 3l2 2l-2 2m-8 10h7a2 2 0 0 1 2 2v2"/>
          </g>
        </svg>
      </div>
      <span style="font-size:${Math.max(8, Math.round(10 * r))}px;font-weight:bold;color:white;text-shadow:0 1px 3px rgba(0,0,0,0.8);white-space:nowrap;margin-top:${Math.max(1, Math.round(2 * r))}px;">${label}</span>
    </div>`,
    iconSize: [Math.round(34 * r), Math.round(54 * r)],
    iconAnchor: [Math.round(17 * r), Math.round(50 * r)],
  })
}

function parseUtc(iso: string): Date {
  if (!iso) return new Date(0)
  if (iso.endsWith('Z')) return new Date(iso)
  return new Date(iso + 'Z')
}

function calcularProgresoLocal(v: VueloDTO, now: Date): number {
  const salida = parseUtc(v.salidaUtc)
  const llegada = parseUtc(v.llegadaUtc)
  const totalMs = llegada.getTime() - salida.getTime()
  if (totalMs <= 0) return 0
  const transcurrido = now.getTime() - salida.getTime()
  if (transcurrido < 0) return 0
  if (transcurrido > totalMs) return 100
  return (transcurrido / totalMs) * 100
}

function calcularProgresoEnSimulacion(v: VueloDTO, simulationNow: Date): number {
  return calcularProgresoLocal(v, simulationNow)
}

function getFlightProgress(vuelo: VueloDTO, simulationMode: boolean, referenceTime?: Date | null): number {
  if (simulationMode) {
    return vuelo.progresoVuelo
  }
  return calcularProgresoLocal(vuelo, referenceTime ?? new Date())
}

function isFlightInProgress(vuelo: VueloDTO, simulationMode: boolean, referenceTime: Date | null): boolean {
  if (vuelo.estado === 'CULMINADO' || vuelo.estado === 'CANCELADO') return false
  const progress = getFlightProgress(vuelo, simulationMode, referenceTime)
  return progress > 0 && progress < 100
}

function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function bearing(from: [number, number], to: [number, number]): number {
  const dLon = (to[1] - from[1]) * Math.PI / 180
  const lat1 = from[0] * Math.PI / 180
  const lat2 = to[0] * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  const θ = Math.atan2(y, x)
  return ((θ * 180 / Math.PI) + 360) % 360
}

function interpolatePosition(from: [number, number], to: [number, number], t: number): [number, number] {
  const offset = Math.min(2.0, Math.abs(to[1] - from[1]) * 0.02)
  const midLat = (from[0] + to[0]) / 2 + offset
  const midLon = (from[1] + to[1]) / 2
  const lat = (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * midLat + t * t * to[0]
  const lon = (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * midLon + t * t * to[1]
  return [lat, lon]
}

function airportCoords(code: string, airportMap: Map<string, AeropuertoDTO>): [number, number] | null {
  const airport = airportMap.get(code)
  const staticData = AIRPORTS_DATA[code]
  const lat = airport?.latitud && airport.latitud !== 0 ? airport.latitud : staticData?.latitud
  const lon = airport?.longitud && airport.longitud !== 0 ? airport.longitud : staticData?.longitud
  if (lat === undefined || lon === undefined) return null
  return [lat, lon]
}

function bezierPoints(from: [number, number], to: [number, number], steps: number): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    pts.push(interpolatePosition(from, to, i / steps))
  }
  return pts
}

function applyTransform(mk: L.Marker, angle: number) {
  const el = mk.getElement()?.querySelector('.airplane-body') as HTMLElement | null
  if (el) el.style.transform = `rotate(${angle}deg)`
}

interface RoutePair {
  pending: L.Polyline
}

interface FlightAnim {
  vuelo: VueloDTO
  from: [number, number]
  to: [number, number]
  pts?: [number, number][]
  displayedProgress: number
  startProgress: number
  targetProgress: number
  transitionStartedAt: number
  transitionDurationMs: number
  snapshotAt: number
}

interface SimClockSnapshot {
  simulationTimeMs: number
  receivedAtMs: number
  rateMsPerRealMs: number
}

const DEFAULT_SIM_CLOCK_RATE = 240

function buildPendingRoutePoints(
  from: [number, number],
  to: [number, number],
  pts: [number, number][],
  progress: number,
): [number, number][] {
  const clampedProgress = Math.max(0, Math.min(100, progress))
  const tNorm = clampedProgress / 100
  const currentPos = interpolatePosition(from, to, tNorm)
  const splitIndex = Math.max(0, Math.min(pts.length - 1, Math.ceil(tNorm * (pts.length - 1))))
  const tail = pts.slice(Math.min(splitIndex + 1, pts.length))
  return [currentPos, ...tail]
}

function animatedProgress(anim: FlightAnim, now: number): number {
  const elapsed = now - anim.transitionStartedAt
  const fraction = Math.min(1, Math.max(0, elapsed / anim.transitionDurationMs))
  return anim.startProgress + (anim.targetProgress - anim.startProgress) * fraction
}

function shouldKeepFlightVisibleOnMap(vuelo: VueloDTO, simulationMode: boolean, selectedVueloId?: string | null): boolean {
  if (vuelo.id === selectedVueloId) return true
  if (simulationMode) return vuelo.estado === 'ACTIVO'
  return Boolean(vuelo.editable) || shouldDisplayFlight(vuelo.id)
}

function MapaAeropuertos({ aeropuertos, vuelos, selectedVueloId, selectedAeropuertoId, selectedEnvio = null, selectedEnvioRouteMode = 'actual', velocidad = 1, onAeropuertoClick, onVueloClick, mapTz, onMapTzChange, simulationMode = false, simulationTime = null, filteredFlightIds = null, filteredAirportIds = null }: Props) {
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const circleLayerRef = useRef<L.LayerGroup | null>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)
  const flightMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const airportMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const flightAngleRef = useRef<Map<string, number>>(new Map())
  const airportDataRef = useRef<Map<string, AeropuertoDTO>>(new Map())
  const persistentFlightsRef = useRef<Map<string, VueloDTO>>(new Map())
  const airportLookup = useMemo(() => buildAirportLookup(aeropuertos), [aeropuertos])
  const selectedRouteRef = useRef<L.LayerGroup | null>(null)
  const selectedStopsLayerRef = useRef<L.LayerGroup | null>(null)
  const selectedFlightRouteLineRef = useRef<L.Polyline | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)
  const routeLinesRef = useRef<Map<string, RoutePair>>(new Map())
  const flightAnimsRef = useRef<Map<string, FlightAnim>>(new Map())
  const visibleFlightIdsRef = useRef<Set<string>>(new Set())
  const rafIdRef = useRef<number>(0)
  const lastAnimationFrameRef = useRef(0)
  const velocidadRef = useRef(velocidad)
  const onVueloClickRef = useRef(onVueloClick)
  const onAeropuertoClickRef = useRef(onAeropuertoClick)
  const selectedVueloIdRef = useRef(selectedVueloId)
  const selectedAeropuertoIdRef = useRef(selectedAeropuertoId)
  const prevSelectionRef = useRef<string | null>(null)
  const prevViewRef = useRef<{ center: L.LatLng; zoom: number } | null>(null)
  const [showRouteLines, setShowRouteLines] = useState(true)
  const [routeDisplayMode, setRouteDisplayMode] = useState<RouteDisplayMode>('all')
  const [routeDirectionFilter, setRouteDirectionFilter] = useState<RouteDirectionFilter>('both')
  const [routeFilterQuery, setRouteFilterQuery] = useState('')
  const [selectedRouteAirports, setSelectedRouteAirports] = useState<string[]>([])
  const [showRouteFilterPanel, setShowRouteFilterPanel] = useState(false)
  const showRouteLinesRef = useRef(showRouteLines)
  const previousShowRouteLinesRef = useRef(showRouteLines)
  const autoDisabledRoutesForSelectionRef = useRef(false)
  const routeDisplayModeRef = useRef<RouteDisplayMode>(routeDisplayMode)
  const routeDirectionFilterRef = useRef<RouteDirectionFilter>(routeDirectionFilter)
  const selectedRouteAirportsRef = useRef<string[]>(selectedRouteAirports)
  const isZoomingRef = useRef(false)
  const simClockRef = useRef<SimClockSnapshot | null>(null)

  const updateSelectedFlightRouteOverlay = (flightId: string, progress: number) => {
    const selectedVuelo = persistentFlightsRef.current.get(flightId) ?? vuelos.find((v) => v.id === flightId)
    const routeLine = selectedFlightRouteLineRef.current
    if (!selectedVuelo || !routeLine) return
    if (progress <= 0 || progress >= 100 || selectedVuelo.estado === 'CULMINADO' || selectedVuelo.estado === 'CANCELADO') {
      routeLine.setLatLngs([])
      routeLine.setStyle({ opacity: 0 })
      return
    }
    const from: [number, number] = [selectedVuelo.latOrigen, selectedVuelo.lonOrigen]
    const to: [number, number] = [selectedVuelo.latDestino, selectedVuelo.lonDestino]
    const pts = bezierPoints(from, to, 40)
    const pendingPts = buildPendingRoutePoints(from, to, pts, progress)
    routeLine.setLatLngs(pendingPts.length >= 2 ? pendingPts : [])
  }

  const updateBaseFlightRouteOverlay = (flightId: string, progress: number) => {
    const anim = flightAnimsRef.current.get(flightId)
    const pair = routeLinesRef.current.get(flightId)
    if (!anim?.pts || !pair) return
    const pendingPts = buildPendingRoutePoints(anim.from, anim.to, anim.pts, progress)
    pair.pending.setLatLngs(pendingPts.length >= 2 ? pendingPts : [])
  }

  const getSimulationNow = (frameNow?: number): Date | null => {
    if (!simulationMode) return null
    const clock = simClockRef.current
    if (!clock) return simulationTime ? parseUtc(simulationTime) : null
    const realNow = frameNow ?? performance.now()
    const elapsedRealMs = Math.max(0, realNow - clock.receivedAtMs)
    return new Date(clock.simulationTimeMs + (elapsedRealMs * clock.rateMsPerRealMs))
  }

  const dynamicZoom = useMemo(() => {
    const z = 2 + window.innerWidth / 2000
    return Math.round(z * 4) / 4
  }, [])
  const routeAirportOptions = useMemo(() => {
    return [...airportLookup.keys()]
      .map((code) => ({
        code,
        city: getAirportCityResolved(code, airportLookup) || code,
        country: getAirportCountryResolved(code, airportLookup) || '',
        search: normalizeSearch([
          code,
          getAirportCityResolved(code, airportLookup) || '',
          getAirportCountryResolved(code, airportLookup) || '',
        ].join(' ')),
      }))
      .sort((a, b) => a.city.localeCompare(b.city))
  }, [airportLookup])
  const filteredRouteAirportOptions = useMemo(() => {
    const query = normalizeSearch(routeFilterQuery)
    if (!query) return routeAirportOptions
    return routeAirportOptions.filter((option) => option.search.includes(query))
  }, [routeAirportOptions, routeFilterQuery])
  const selectedRouteAirportsLabel = useMemo(() => {
    if (routeDisplayMode === 'all') return 'Todos'
    if (selectedRouteAirports.length === 0) return 'Ninguno'
    if (selectedRouteAirports.length === 1) {
      const code = selectedRouteAirports[0]
      return getAirportCityResolved(code, airportLookup) || code
    }
    return `${selectedRouteAirports.length} aeropuertos`
  }, [routeDisplayMode, selectedRouteAirports, airportLookup])
  useEffect(() => {
    onVueloClickRef.current = onVueloClick
    onAeropuertoClickRef.current = onAeropuertoClick
    velocidadRef.current = velocidad
    selectedVueloIdRef.current = selectedVueloId
    selectedAeropuertoIdRef.current = selectedAeropuertoId
    showRouteLinesRef.current = showRouteLines
    routeDisplayModeRef.current = routeDisplayMode
    routeDirectionFilterRef.current = routeDirectionFilter
    selectedRouteAirportsRef.current = selectedRouteAirports
  }, [onVueloClick, onAeropuertoClick, velocidad, selectedVueloId, selectedAeropuertoId, showRouteLines, routeDisplayMode, routeDirectionFilter, selectedRouteAirports])

  useEffect(() => {
    if (selectedVueloId) {
      if (!autoDisabledRoutesForSelectionRef.current) {
        previousShowRouteLinesRef.current = showRouteLinesRef.current
        autoDisabledRoutesForSelectionRef.current = true
      }
      if (showRouteLinesRef.current) {
        setShowRouteLines(false)
      }
      return
    }

    if (autoDisabledRoutesForSelectionRef.current) {
      autoDisabledRoutesForSelectionRef.current = false
      setShowRouteLines(previousShowRouteLinesRef.current)
    }
  }, [selectedVueloId])

  useEffect(() => {
    if (!simulationMode || !simulationTime) {
      simClockRef.current = null
      return
    }

    const simulationDate = parseUtc(simulationTime)
    const now = performance.now()
    const previous = simClockRef.current
    let rateMsPerRealMs = previous?.rateMsPerRealMs ?? DEFAULT_SIM_CLOCK_RATE
    let simulationTimeMs = simulationDate.getTime()

    if (previous) {
      const realDelta = now - previous.receivedAtMs
      const simulationDelta = simulationDate.getTime() - previous.simulationTimeMs
      const projectedSimulationNow = previous.simulationTimeMs + (Math.max(0, realDelta) * previous.rateMsPerRealMs)
      simulationTimeMs = Math.max(simulationTimeMs, projectedSimulationNow)

      if (realDelta > 0 && simulationDelta > 0) {
        const instantRate = simulationDelta / realDelta
        rateMsPerRealMs = (previous.rateMsPerRealMs * 0.85) + (instantRate * 0.15)
      }
    }

    simClockRef.current = {
      simulationTimeMs,
      receivedAtMs: now,
      rateMsPerRealMs,
    }
  }, [simulationMode, simulationTime])

  function removeRoute(id: string) {
    const pair = routeLinesRef.current.get(id)
    if (!pair) return
    routeLayerRef.current?.removeLayer(pair.pending)
    routeLinesRef.current.delete(id)
  }

  function removeAllRoutes() {
    routeLinesRef.current.forEach((pair) => {
      routeLayerRef.current?.removeLayer(pair.pending)
    })
    routeLinesRef.current.clear()
  }

  function shouldDisplayRouteForFlight(vuelo: VueloDTO): boolean {
    if (!showRouteLinesRef.current) return false
    if (routeDisplayModeRef.current === 'all') return true
    const selectedCodes = selectedRouteAirportsRef.current
    if (selectedCodes.length === 0) return false
    const matchesOutbound = selectedCodes.includes(vuelo.origen)
    const matchesInbound = selectedCodes.includes(vuelo.destino)
    if (routeDirectionFilterRef.current === 'outbound') return matchesOutbound
    if (routeDirectionFilterRef.current === 'inbound') return matchesInbound
    return matchesOutbound || matchesInbound
  }

  useEffect(() => {
    if (vuelos.length === 0) {
      // Limpiar todos los aviones cuando no hay vuelos
      persistentFlightsRef.current.clear()
      flightMarkersRef.current.forEach((mk) => markerLayerRef.current?.removeLayer(mk))
      flightMarkersRef.current.clear()
      flightAngleRef.current.clear()
      flightAnimsRef.current.clear()
      removeAllRoutes()
      return
    }

    const persistedIds = new Set(persistentFlightsRef.current.keys())
    const incomingIds = new Set(vuelos.map((v) => v.id))

    if (persistedIds.size > 0 && ![...incomingIds].some((id) => persistedIds.has(id))) {
      persistentFlightsRef.current.clear()
      flightMarkersRef.current.forEach((mk) => markerLayerRef.current?.removeLayer(mk))
      flightMarkersRef.current.clear()
      flightAngleRef.current.clear()
      flightAnimsRef.current.clear()
      removeAllRoutes()
    }

    persistedIds.forEach((id) => {
      if (!incomingIds.has(id)) {
        persistentFlightsRef.current.delete(id)
        const mk = flightMarkersRef.current.get(id)
        if (mk) {
          markerLayerRef.current?.removeLayer(mk)
          flightMarkersRef.current.delete(id)
          flightAngleRef.current.delete(id)
        }
        flightAnimsRef.current.delete(id)
        removeRoute(id)
      }
    })

    const realNow = simulationMode ? null : new Date()
    vuelos.forEach((v) => {
      const progresoLocal = getFlightProgress(v, simulationMode, realNow)
      const isActive = simulationMode
        ? v.estado === 'ACTIVO' && progresoLocal > 0 && progresoLocal < 100
        : progresoLocal > 0 && progresoLocal < 100
      const isVisible = shouldKeepFlightVisibleOnMap(v, simulationMode, selectedVueloId)
      if (!isActive || !isVisible) {
        persistentFlightsRef.current.delete(v.id)
        const mk = flightMarkersRef.current.get(v.id)
        if (mk) {
          markerLayerRef.current?.removeLayer(mk)
          flightMarkersRef.current.delete(v.id)
          flightAngleRef.current.delete(v.id)
        }
        flightAnimsRef.current.delete(v.id)
        removeRoute(v.id)
      } else {
        persistentFlightsRef.current.set(v.id, v)
      }
    })
  }, [vuelos, selectedVueloId, simulationMode])

  useEffect(() => {
    if (mapContainerRef.current && !mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: INITIAL_CENTER,
        zoom: dynamicZoom,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        zoomSnap: 0.25,
        zoomDelta: 0.25,
        wheelPxPerZoomLevel: 120,
        minZoom: Math.max(2, dynamicZoom - 0.5),
        maxZoom: 13,
        maxBounds: WORLD_BOUNDS,
        maxBoundsViscosity: 1.0
      })

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 13,
      }).addTo(map)

      circleLayerRef.current = L.layerGroup().addTo(map)
      routeLayerRef.current = L.layerGroup().addTo(map)
      markerLayerRef.current = L.layerGroup().addTo(map)
      mapRef.current = map

      map.on('zoom', () => {
        flightMarkersRef.current.forEach((mk, id) => {
          const angle = flightAngleRef.current.get(id) ?? 0
          applyTransform(mk, angle)
        })
      })

      map.on('zoomstart', () => {
        isZoomingRef.current = true
        routeLinesRef.current.forEach((pair) => {
          pair.pending.setStyle({ opacity: 0 })
        })
        selectedFlightRouteLineRef.current?.setStyle({ opacity: 0 })
      })

      map.on('zoomend', () => {
        routeLinesRef.current.forEach((pair, id) => {
          const anim = flightAnimsRef.current.get(id)
          if (anim) {
            updateBaseFlightRouteOverlay(id, anim.displayedProgress)
          }
          pair.pending.setStyle({ opacity: showRouteLinesRef.current ? 0.25 : 0 })
        })
        if (selectedVueloIdRef.current && selectedFlightRouteLineRef.current) {
          const selectedVuelo = persistentFlightsRef.current.get(selectedVueloIdRef.current) ?? vuelos.find((v) => v.id === selectedVueloIdRef.current)
          const anim = flightAnimsRef.current.get(selectedVueloIdRef.current)
          const progress = anim?.displayedProgress ?? 0
          if (selectedVuelo && isFlightInProgress(selectedVuelo, simulationMode, getSimulationNow())) {
            updateSelectedFlightRouteOverlay(selectedVueloIdRef.current, progress)
            selectedFlightRouteLineRef.current.setStyle({ opacity: 0.95 })
          } else {
            selectedFlightRouteLineRef.current.setLatLngs([])
            selectedFlightRouteLineRef.current.setStyle({ opacity: 0 })
          }
        }
        isZoomingRef.current = false
        map.setMaxBounds(WORLD_BOUNDS)
      })
    }

    const resizeObserver = new ResizeObserver(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize()
      }
    })
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current)
    }

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = 0
      }
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        flightMarkersRef.current.clear()
        airportMarkersRef.current.clear()
        persistentFlightsRef.current.clear()
        flightAnimsRef.current.clear()
      }
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!circleLayerRef.current) return

    airportDataRef.current.clear()
    aeropuertos.forEach((a) => airportDataRef.current.set(a.codigoOACI, a))

    const currentCodes = new Set(aeropuertos.map((a) => a.codigoOACI))
    airportMarkersRef.current.forEach((mk, code) => {
      if (!currentCodes.has(code)) {
        circleLayerRef.current?.removeLayer(mk)
        airportMarkersRef.current.delete(code)
      }
    })

    aeropuertos.forEach((a) => {
      const existing = airportMarkersRef.current.get(a.codigoOACI)
      const color = aeropuertoColor(a.ocupacionActual, a.capacidadMaxima)
      const cityName = getAirportCityResolved(a.codigoOACI, airportLookup) || a.codigoOACI
      const label = cityName
      const passesPanelFilter = !filteredAirportIds || filteredAirportIds.has(a.codigoOACI) || a.codigoOACI === selectedAeropuertoIdRef.current

      const staticData = AIRPORTS_DATA[a.codigoOACI]
      const lat = (a.latitud && a.latitud !== 0) ? a.latitud : (staticData?.latitud ?? 0)
      const lon = (a.longitud && a.longitud !== 0) ? a.longitud : (staticData?.longitud ?? 0)

      const airportTooltip = () => {
        const ratio = a.capacidadMaxima > 0 ? a.ocupacionActual / a.capacidadMaxima : 0
        return `<b>${a.codigoOACI} - ${cityName}</b><br>Ocupación: ${a.ocupacionActual} / ${a.capacidadMaxima} (${Math.round(ratio * 100)}%)`
      }

      if (existing) {
        existing.setIcon(airportIcon(color, label, a.codigoOACI === selectedAeropuertoIdRef.current))
        existing.setLatLng([lat, lon])
        existing.setTooltipContent(airportTooltip())
        existing.setOpacity(passesPanelFilter ? 1 : 0)
        const element = existing.getElement()
        if (element) element.style.pointerEvents = passesPanelFilter ? 'auto' : 'none'
      } else {
        const code = a.codigoOACI
        const mk = L.marker([lat, lon], { icon: airportIcon(color, label, code === selectedAeropuertoIdRef.current) })
        mk.bindTooltip(airportTooltip(), { direction: 'top', offset: L.point(0, -14) })
        mk.on('click', () => {
          const current = airportDataRef.current.get(code)
          if (current) onAeropuertoClickRef.current?.(current)
        })
        mk.setOpacity(passesPanelFilter ? 1 : 0)
        circleLayerRef.current?.addLayer(mk)
        airportMarkersRef.current.set(code, mk)
      }
    })
  }, [aeropuertos, filteredAirportIds])

  useEffect(() => {
    if (!mapRef.current) return
    const simulationNow = simulationMode ? getSimulationNow() : null
    const selection = selectedEnvio
      ? `envio:${selectedEnvio.id}:${selectedEnvioRouteMode}`
      : selectedVueloId
      ? `vuelo:${selectedVueloId}`
      : selectedAeropuertoId
        ? `aeropuerto:${selectedAeropuertoId}`
        : null
    const selectionChanged = selection !== prevSelectionRef.current

    if (selectionChanged) {
      if (selectedRouteRef.current) {
        mapRef.current.removeLayer(selectedRouteRef.current)
        selectedRouteRef.current = null
        selectedFlightRouteLineRef.current = null
      }
      if (selectedStopsLayerRef.current) {
        mapRef.current.removeLayer(selectedStopsLayerRef.current)
        selectedStopsLayerRef.current = null
      }
    }

    if (selection && prevSelectionRef.current === null) {
      prevViewRef.current = { center: mapRef.current.getCenter(), zoom: mapRef.current.getZoom() }
    }

    const airportMap = new Map(aeropuertos.map((a) => [a.codigoOACI, a]))

    if (selectedEnvio) {
      const routeCodes = selectedEnvioRouteMode === 'anterior'
        ? (selectedEnvio.rutaAnteriorAeropuertos || [])
        : (selectedEnvio.rutaAeropuertos || [])
      const routeFlights = selectedEnvioRouteMode === 'anterior'
        ? (selectedEnvio.rutaAnteriorVuelos || [])
        : (selectedEnvio.rutaVuelos || [])
      const points = routeCodes
        .map((code) => ({ code, coords: airportCoords(code, airportMap) }))
        .filter((point): point is { code: string; coords: [number, number] } => Boolean(point.coords))

      if (points.length >= 2 && mapRef.current) {
        const latLngs = points.map((point) => point.coords)
        if (selectionChanged) {
          mapRef.current.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40], animate: true, maxZoom: 5 })
        }

        if (selectionChanged) {
          const selectedRouteLayer = L.layerGroup().addTo(mapRef.current)
          L.polyline(latLngs, {
            color: selectedEnvioRouteMode === 'anterior' ? '#f97316' : MAP_SELECTION_COLOR,
            weight: 3,
            opacity: 0.95,
            dashArray: selectedEnvioRouteMode === 'anterior' ? '8, 8' : undefined,
          }).addTo(selectedRouteLayer)
          selectedRouteRef.current = selectedRouteLayer

          const stopsLayer = L.layerGroup().addTo(mapRef.current)
          points.forEach((point, index) => {
            const color = index === 0 ? '#22c55e' : index === points.length - 1 ? '#ef4444' : '#38bdf8'
            const role = index === 0 ? 'Origen' : index === points.length - 1 ? 'Destino' : `Escala ${index}`
            const flightId = routeFlights[index - 1]
            const marker = L.circleMarker(point.coords, {
              radius: index === 0 || index === points.length - 1 ? 8 : 6,
              color,
              fillColor: color,
              fillOpacity: 0.35,
              weight: 2,
            }).bindTooltip([
              `<b>${role}</b>`,
              getAirportCityResolved(point.code, airportLookup) || point.code,
              flightId ? `UT: ${flightId}` : null,
            ].filter(Boolean).join('<br>'))
            stopsLayer.addLayer(marker)
          })
          selectedStopsLayerRef.current = stopsLayer
        }
      }
    } else if (selectedVueloId) {
      const selectedVuelo = persistentFlightsRef.current.get(selectedVueloId) ?? vuelos.find((v) => v.id === selectedVueloId)
      const selectedFlightActive = selectedVuelo
        ? isFlightInProgress(selectedVuelo, simulationMode, simulationNow)
        : false
      if (selectedVuelo && selectedFlightActive && mapRef.current) {
        const from: [number, number] = [selectedVuelo.latOrigen, selectedVuelo.lonOrigen]
        const to: [number, number] = [selectedVuelo.latDestino, selectedVuelo.lonDestino]
        const anim = flightAnimsRef.current.get(selectedVueloId)
        const progress = anim?.displayedProgress ?? (simulationNow ? calcularProgresoEnSimulacion(selectedVuelo, simulationNow) : selectedVuelo.progresoVuelo)
        const pos = interpolatePosition(from, to, progress / 100)
        if (selectionChanged) {
          mapRef.current.setView(pos, Math.min(mapRef.current.getZoom() + 1, 5), { animate: true })
        }
        if (selectionChanged) {
          const pts = bezierPoints(from, to, 40)
          const pendingPts = buildPendingRoutePoints(from, to, pts, progress)
          const selectedRouteLayer = L.layerGroup().addTo(mapRef.current)

          if (pendingPts.length >= 2) {
            const routeLine = L.polyline(pendingPts, {
              dashArray: '6, 8',
              color: MAP_SELECTION_COLOR,
              weight: 3,
              opacity: 0.95,
              lineCap: 'round',
            }).addTo(selectedRouteLayer)
            selectedFlightRouteLineRef.current = routeLine
          }

          selectedRouteRef.current = selectedRouteLayer

          const stopsLayer = L.layerGroup().addTo(mapRef.current)
          stopsLayer.addLayer(L.circleMarker(from, {
            radius: 8,
            color: '#22c55e',
            fillColor: '#22c55e',
            fillOpacity: 0.3,
            weight: 2,
          }))
          stopsLayer.addLayer(L.circleMarker(to, {
            radius: 8,
            color: '#ef4444',
            fillColor: '#ef4444',
            fillOpacity: 0.3,
            weight: 2,
          }))
          selectedStopsLayerRef.current = stopsLayer
        }
      } else if (selectedFlightRouteLineRef.current) {
        selectedFlightRouteLineRef.current.setLatLngs([])
        selectedFlightRouteLineRef.current.setStyle({ opacity: 0 })
      }
    } else if (selectedAeropuertoId) {
      const marker = airportMarkersRef.current.get(selectedAeropuertoId)
      if (marker && selectionChanged) {
        mapRef.current.setView(marker.getLatLng(), Math.min(mapRef.current.getZoom() + 1, 5), { animate: true })
      }
    } else if (prevSelectionRef.current !== null && prevViewRef.current) {
      mapRef.current.setView(prevViewRef.current.center, prevViewRef.current.zoom, { animate: true })
      prevViewRef.current = null
    }

    prevSelectionRef.current = selection

    const vueloMap = new Map(vuelos.map((v) => [v.id, v]))
    flightMarkersRef.current.forEach((mk, id) => {
      const isSelected = id === selectedVueloId
      const v = vueloMap.get(id) || persistentFlightsRef.current.get(id)
      const carga = v?.cargaActual ?? 0
      const cap = v?.capacidad ?? 1
      mk.setIcon(getAirplaneIcon(isSelected, carga, cap))
      const angle = flightAngleRef.current.get(id)
      if (angle !== undefined) {
        requestAnimationFrame(() => applyTransform(mk, angle))
      }
    })

    airportMarkersRef.current.forEach((mk, code) => {
      const airport = airportMap.get(code)
      if (!airport) return
      const cityName = getAirportCityResolved(code, airportLookup) || code
      const color = aeropuertoColor(airport.ocupacionActual, airport.capacidadMaxima)
      mk.setIcon(airportIcon(color, cityName, code === selectedAeropuertoId))
      const passesPanelFilter = !filteredAirportIds || filteredAirportIds.has(code) || code === selectedAeropuertoId
      mk.setOpacity(passesPanelFilter ? 1 : 0)
      const element = mk.getElement()
      if (element) element.style.pointerEvents = passesPanelFilter ? 'auto' : 'none'
    })
  }, [selectedEnvio, selectedEnvioRouteMode, selectedVueloId, selectedAeropuertoId, vuelos, aeropuertos, airportLookup, filteredAirportIds])

  useEffect(() => {
    if (!markerLayerRef.current) return

    const realNow = new Date()
    const frameNow = performance.now()
    const displayFlights = Array.from(persistentFlightsRef.current.values()).filter((v) => {
      const progreso = getFlightProgress(v, simulationMode, realNow)
      const passesPanelFilter = !filteredFlightIds || filteredFlightIds.has(v.id) || v.id === selectedVueloIdRef.current
      return progreso > 0 && progreso < 100 && passesPanelFilter
    })
    const displayIds = new Set(displayFlights.map((v) => v.id))
    visibleFlightIdsRef.current = displayIds

      flightMarkersRef.current.forEach((mk, id) => {
        if (!displayIds.has(id)) {
          mk.setOpacity(0)
          const element = mk.getElement()
          if (element) element.style.pointerEvents = 'none'
          const route = routeLinesRef.current.get(id)
          route?.pending.setStyle({ opacity: 0 })
        }
      })

    displayFlights.forEach((v) => {
      const from: [number, number] = [v.latOrigen, v.lonOrigen]
      const to: [number, number] = [v.latDestino, v.lonDestino]
      const isSelected = v.id === selectedVueloIdRef.current
      const tooltipText = tooltipForFlight(v, airportLookup, simulationMode, realNow ?? undefined)
      const pts = bezierPoints(from, to, ROUTE_POINT_COUNT)
      const progresoActual = getFlightProgress(v, simulationMode, realNow)
      const tNorm = progresoActual / 100

      const existingAnim = flightAnimsRef.current.get(v.id)
      if (existingAnim) {
        const currentProgress = simulationMode ? existingAnim.displayedProgress : progresoActual
        const snapshotInterval = Math.min(20_000, Math.max(1_000, frameNow - existingAnim.snapshotAt))
        existingAnim.vuelo = v
        existingAnim.from = from
        existingAnim.to = to
        existingAnim.pts = pts
        existingAnim.startProgress = currentProgress
        existingAnim.targetProgress = Math.max(currentProgress, progresoActual)
        existingAnim.transitionStartedAt = frameNow
        existingAnim.transitionDurationMs = simulationMode ? snapshotInterval : 1
        existingAnim.snapshotAt = frameNow
      } else {
        flightAnimsRef.current.set(v.id, {
          vuelo: v,
          from,
          to,
          pts,
          displayedProgress: progresoActual,
          startProgress: progresoActual,
          targetProgress: progresoActual,
          transitionStartedAt: frameNow,
          transitionDurationMs: 1,
          snapshotAt: frameNow,
        })
      }

      let mk = flightMarkersRef.current.get(v.id)
      if (!mk) {
        const startPos = interpolatePosition(from, to, tNorm)
        mk = L.marker(startPos, { icon: getAirplaneIcon(isSelected, v.cargaActual, v.capacidad) })
        mk.bindTooltip(tooltipText, { direction: 'top', offset: L.point(0, -14) })
        const flightId = v.id
        mk.on('click', () => {
          const current = flightAnimsRef.current.get(flightId)?.vuelo
          if (current) onVueloClickRef.current?.(current)
        })
        markerLayerRef.current?.addLayer(mk)
        flightMarkersRef.current.set(v.id, mk)

        const angle = bearing(
          interpolatePosition(from, to, Math.max(0, tNorm - 0.01)),
          interpolatePosition(from, to, Math.min(1, tNorm + 0.01))
        )
        flightAngleRef.current.set(v.id, angle)
        applyTransform(mk, angle)
      } else {
        mk.setOpacity(1)
        const element = mk.getElement()
        if (element) element.style.pointerEvents = 'auto'
        mk.setIcon(getAirplaneIcon(isSelected, v.cargaActual, v.capacidad))
        mk.setTooltipContent(tooltipText)
      }


    })
  }, [vuelos, selectedVueloId, simulationMode, filteredFlightIds])

  useEffect(() => {
    routeLinesRef.current.forEach((pair, id) => {
      const vuelo = flightAnimsRef.current.get(id)?.vuelo
      const visible = vuelo ? shouldDisplayRouteForFlight(vuelo) : false
      pair.pending.setStyle({ opacity: visible ? 0.25 : 0 })
    })
  }, [showRouteLines, routeDisplayMode, routeDirectionFilter, selectedRouteAirports])

  useEffect(() => {
    const animate = (frameNow: number) => {
      if (frameNow - lastAnimationFrameRef.current < 33) {
        rafIdRef.current = requestAnimationFrame(animate)
        return
      }
      lastAnimationFrameRef.current = frameNow
      const realNow = simulationMode ? null : new Date()
      flightAnimsRef.current.forEach((anim, id) => {
        if (!visibleFlightIdsRef.current.has(id)) return
        const mk = flightMarkersRef.current.get(id)
        if (!mk) return

        const currentProgress = simulationMode
          ? animatedProgress(anim, frameNow)
          : calcularProgresoLocal(anim.vuelo, realNow!)
        anim.displayedProgress = currentProgress
        if (id === selectedVueloIdRef.current) {
          updateSelectedFlightRouteOverlay(id, currentProgress)
        }
        if (currentProgress >= 100) {
          markerLayerRef.current?.removeLayer(mk)
          flightMarkersRef.current.delete(id)
          flightAngleRef.current.delete(id)
          flightAnimsRef.current.delete(id)
          removeRoute(id)
          return
        }

        const tNorm = currentProgress / 100
        const pos = interpolatePosition(anim.from, anim.to, tNorm)
        mk.setLatLng(pos)

        const delta = 0.005
        const tBefore = Math.max(0, tNorm - delta)
        const tAfter = Math.min(1, tNorm + delta)
        const posBefore = interpolatePosition(anim.from, anim.to, tBefore)
        const posAfter = interpolatePosition(anim.from, anim.to, tAfter)
        const angle = bearing(posBefore, posAfter)
        flightAngleRef.current.set(id, angle)
        applyTransform(mk, angle)

        if (!isZoomingRef.current && anim.pts) {
          const splitIndex = Math.round(tNorm * (anim.pts.length - 1))
          const pair = routeLinesRef.current.get(id)
          const routeVisible = shouldDisplayRouteForFlight(anim.vuelo)

          if (!pair) {
            if (routeVisible) {
              const pendingLine = L.polyline(buildPendingRoutePoints(anim.from, anim.to, anim.pts, currentProgress), {
                dashArray: '4, 6',
                color: '#6b7280',
                weight: 1.5,
                opacity: 0.25,
              })
              routeLayerRef.current?.addLayer(pendingLine)
          routeLinesRef.current.set(id, { pending: pendingLine })
            }
            return
          }

          if (!routeVisible) {
            pair.pending.setStyle({ opacity: 0 })
            return
          }

          if (splitIndex >= anim.pts.length) {
            return
          }

          pair.pending.setLatLngs(anim.pts.slice(splitIndex))
          pair.pending.setStyle({ opacity: 0.25 })
        }
      })

      rafIdRef.current = requestAnimationFrame(animate)
    }

    rafIdRef.current = requestAnimationFrame(animate)
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = 0
      }
    }
  }, [])

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-16 right-2 z-[1000] bg-gray-800/90 rounded-lg border border-gray-600 p-2 space-y-2 w-[270px] max-w-[calc(100%-1rem)]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-300">Rutas</span>
          <button
            onClick={() => setShowRouteLines(!showRouteLines)}
            className={`relative w-10 h-5 rounded-full transition-colors ${showRouteLines ? 'bg-emerald-500' : 'bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${showRouteLines ? 'translate-x-5' : ''}`} />
          </button>
          <button
            onClick={() => setShowRouteFilterPanel((prev) => !prev)}
            className="ml-auto rounded border border-gray-600 px-2 py-0.5 text-[11px] text-gray-200 hover:bg-gray-700"
          >
            {showRouteFilterPanel ? 'Ocultar filtro' : 'Filtrar'}
          </button>
        </div>
        {showRouteLines && (
          <div className="text-[11px] text-gray-400">
            {selectedRouteAirportsLabel}
          </div>
        )}
        {showRouteLines && showRouteFilterPanel && (
          <div className="space-y-2 border-t border-gray-700 pt-2">
            <div className="space-y-1">
              <span className="text-[11px] text-gray-300">Aeropuertos</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setRouteDisplayMode('all')}
                  className={`rounded px-2 py-1 text-[11px] ${routeDisplayMode === 'all' ? 'bg-sky-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                >
                  Todos
                </button>
                <button
                  onClick={() => {
                    setRouteDisplayMode('selected')
                    setSelectedRouteAirports([])
                  }}
                  className={`rounded px-2 py-1 text-[11px] ${routeDisplayMode === 'selected' && selectedRouteAirports.length === 0 ? 'bg-sky-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                >
                  Ninguno
                </button>
                <button
                  onClick={() => setRouteDisplayMode('selected')}
                  className={`rounded px-2 py-1 text-[11px] ${routeDisplayMode === 'selected' && selectedRouteAirports.length > 0 ? 'bg-sky-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                >
                  Seleccion
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-gray-300">Tipo</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setRouteDirectionFilter('both')}
                  className={`rounded px-2 py-1 text-[11px] ${routeDirectionFilter === 'both' ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                >
                  Ambas
                </button>
                <button
                  onClick={() => setRouteDirectionFilter('outbound')}
                  className={`rounded px-2 py-1 text-[11px] ${routeDirectionFilter === 'outbound' ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                >
                  Salen
                </button>
                <button
                  onClick={() => setRouteDirectionFilter('inbound')}
                  className={`rounded px-2 py-1 text-[11px] ${routeDirectionFilter === 'inbound' ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                >
                  Llegan
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <input
                value={routeFilterQuery}
                onChange={(e) => setRouteFilterQuery(e.target.value)}
                placeholder="Buscar ciudad, pais o codigo"
                className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-[11px] text-white placeholder:text-gray-400 focus:outline-none focus:border-sky-500"
              />
              <div className="max-h-32 overflow-y-auto rounded border border-gray-700 bg-gray-900/70">
                {filteredRouteAirportOptions.map((option) => {
                  const checked = selectedRouteAirports.includes(option.code)
                  return (
                    <label key={option.code} className="flex cursor-pointer items-start gap-2 border-b border-gray-800 px-2 py-1.5 text-[11px] text-gray-200 last:border-b-0 hover:bg-gray-800/80">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setRouteDisplayMode('selected')
                          setSelectedRouteAirports((prev) => (
                            prev.includes(option.code)
                              ? prev.filter((code) => code !== option.code)
                              : [...prev, option.code]
                          ))
                        }}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-white">{option.city}</span>
                        <span className="block text-gray-400">{option.country || option.code} · {option.code}</span>
                      </span>
                    </label>
                  )
                })}
                {filteredRouteAirportOptions.length === 0 && (
                  <div className="px-2 py-2 text-[11px] text-gray-400">
                    No hay aeropuertos que coincidan.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-300">Zona horaria:</span>
          <select
            value={mapTz}
            onChange={(e) => onMapTzChange(Number(e.target.value))}
            className="bg-gray-700 text-xs text-white rounded px-1 py-0.5 border border-gray-600 focus:outline-none focus:border-sky-500"
          >
            {TIMEZONE_OPTIONS.map(opt => (
              <option key={opt.offset} value={opt.offset}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>



      <div ref={mapContainerRef} className="w-full h-full rounded-lg" />
    </div>
  )
}

export default memo(MapaAeropuertos)
