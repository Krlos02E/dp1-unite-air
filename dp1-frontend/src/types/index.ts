export interface VueloDTO {
  id: string;
  origen: string;
  destino: string;
  latOrigen: number;
  lonOrigen: number;
  latDestino: number;
  lonDestino: number;
  salidaUtc: string;
  llegadaUtc: string;
  capacidad: number;
  cargaActual: number;
  progresoVuelo: number;
  estado?: string;
  programacionId?: number | null;
  editable?: boolean;
  recurrente?: boolean;
}

export interface AeropuertoDTO {
  codigoOACI: string;
  latitud: number;
  longitud: number;
  ciudad?: string;
  pais?: string;
  capacidadMaxima: number;
  ocupacionActual: number;
  vuelosEntrantes: string[];
  vuelosSalientes: string[];
  vuelosCanceladosSalientes: string[];
  editable?: boolean;
}

export interface AlmacenDTO {
  codigoOACI: string;
  ciudad?: string;
  pais?: string;
  continente?: string;
  gmtOffsetMinutos: number;
  capacidadMaxima: number;
  latitud: number;
  longitud: number;
  editable?: boolean;
  ocupacionActual?: number;
}

export type AlmacenContexto = 'OPERACION' | 'SIMULACION';

export interface ProgramacionVueloDTO {
  id?: number;
  origenOACI: string;
  destinoOACI: string;
  horaSalidaLocal: string;
  horaLlegadaLocal: string;
  capacidad: number;
}

export interface PlanificacionLogDTO {
  id: number;
  timestampEjecucion: string;
  duracionMs: number;
  paquetesProcesados: number;
  rutasAsignadas: number;
  paquetesNoAsignados: number;
  costoTotal: number;
  estado: string;
  mensajeError?: string | null;
  detallesJson?: string | null;
}

export interface LogEntry {
  timestamp: string;
  tipo: 'INFO' | 'WARN' | 'ERROR' | 'COLAPSO' | 'REPLAN';
  mensaje: string;
  modulo?: string;
  detalle?: string;
}

export interface SimulationState {
  sessionId: string;
  status?: string;
  startedAt?: string;
  simulationTime: string;
  fechaInicio?: string;
  ultimaPlanificacionSimulada?: string;
  horizontePlanificacionMinutos?: number;
  duracionUltimaPlanificacionSeg?: number;
  ultimaPlanificacionSinRuta?: number;
  planificacionEstable?: boolean;
  vuelos: VueloDTO[];
  aeropuertos: AeropuertoDTO[];
  maletasEntregadas: number;
  maletasEnTransito: number;
  vuelosCulminados: number;
  vuelosEnTransito: number;
  vuelosCancelados: number;
  progreso: number;
  colapsada: boolean;
  motivoColapso: string;
  elapsedRealtimeSeconds?: number;
  logs: LogEntry[];
  envios?: EnvioEstado[];
  maletas?: MaletaEstado[];
}

export interface ActiveSimulationInfo {
  activa: boolean;
  sessionId?: string;
  status?: string;
  progreso?: number;
  startedAt?: string;
  simulationStartedAt?: string;
  fechaInicio?: string;
  elapsedRealtimeSeconds?: number;
  latestFinishedState?: SimulationState;
}

export interface AuthResponse {
  success: boolean;
  username: string;
  role: string;
  message: string;
}

export interface CargaResult {
  success: boolean;
  message: string;
  aeropuertosCount: number;
  vuelosCount: number;
  paquetesCount: number;
}

export interface DashboardData {
  maletasEntregadasHoy: number;
  maletasEnTransito: number;
  totalVuelos: number;
  totalAeropuertos: number;
  aeropuertos: AeropuertoDTO[];
  vuelosActivos: VueloDTO[];
}

export interface EnvioEntrada {
  destino: string;
  fechaLocal: string;
  horaLocal: string;
  cantidad: number;
  timezone: string;
  clienteId?: string;
}

export interface CancelarVueloResult {
  success: boolean;
  message: string;
  vueloId?: string;
}

export interface CancelarVueloRequest {
  vueloId: string;
  contexto?: AlmacenContexto;
  sessionId?: string;
}

export interface DescancelarVueloResult {
  success: boolean;
  message: string;
  vueloId?: string;
}

export interface AgregarEnviosResult {
  success: boolean;
  message: string;
  enviosAgregados: number;
  detalles?: { id: string; origen: string; destino: string; cantidad: number; clienteId: string }[];
}

export interface EnvioIncremental {
  id: string;
  origen: string;
  destino: string;
  fecha: string;
  hora: string;
  cantidad: number;
  clienteId: string;
}

export interface EnviosIncrementalesResponse {
  total: number;
  envios: EnvioIncremental[];
}

export interface ContextSharedState {
  contexto: AlmacenContexto;
  version: number;
  updatedAt: string;
  reason: string;
}

export interface EnvioEstado {
  id: string;
  origen: string;
  destino: string;
  clienteId?: string;
  estado: 'EN_ESPERA' | 'EMBARCADO' | 'EN_VUELO' | 'ENTREGADO';
  aeropuertoActual: string;
  vueloEsperado: string | null;
  vueloActual: string | null;
  ultimoVuelo?: string | null;
  ultimaLlegadaUtc?: string | null;
  rutaAeropuertos?: string[];
  rutaVuelos?: string[];
  rutaAnteriorAeropuertos?: string[] | null;
  rutaAnteriorVuelos?: string[] | null;
  cantidad: number;
}

export interface MaletaEstado extends EnvioEstado {
  envioId: string;
  indice: number;
  subrutaIndex?: number;
}

export interface EnvioBusquedaResponse {
  total: number;
  envios: EnvioEstado[];
}

export interface MaletaBusquedaResponse {
  total: number;
  maletas: MaletaEstado[];
}
