import { HttpClient } from './HttpClient'
import type {
  CargaResult,
  AeropuertoDTO,
  VueloDTO,
  CancelarVueloRequest,
  CancelarVueloResult,
  DescancelarVueloResult,
  EnvioEntrada,
  AgregarEnviosResult,
  EnviosIncrementalesResponse,
  EnvioBusquedaResponse,
  MaletaBusquedaResponse,
  AlmacenDTO,
  AlmacenContexto,
  ProgramacionVueloDTO,
  PlanificacionLogDTO,
  ContextSharedState,
} from '../types'

class CargaArchivosService extends HttpClient {
  upload(
    files: { planes_vuelo?: File; aeropuertos?: File; envios?: File },
    timezone: string,
    onProgress?: (pct: number) => void
  ): Promise<CargaResult> {
    const formData = new FormData()
    if (files.planes_vuelo) formData.append('planes_vuelo', files.planes_vuelo)
    if (files.aeropuertos) formData.append('aeropuertos', files.aeropuertos)
    if (files.envios) formData.append('envios', files.envios)
    formData.append('timezone', timezone)

    return this.instance.post('/carga/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      },
    }).then((r) => r.data as CargaResult)
  }

  obtenerAeropuertos(contexto: AlmacenContexto = 'OPERACION'): Promise<AeropuertoDTO[]> {
    return this.get<AeropuertoDTO[]>('/carga/aeropuertos', { contexto })
  }

  obtenerVuelos(contexto: AlmacenContexto = 'OPERACION'): Promise<VueloDTO[]> {
    return this.get<VueloDTO[]>('/carga/vuelos', { contexto })
  }

  obtenerEstadoCompartido(contexto: AlmacenContexto = 'OPERACION'): Promise<ContextSharedState> {
    return this.get<ContextSharedState>('/carga/estado-compartido', { contexto })
  }

  cancelarVuelo(request: CancelarVueloRequest): Promise<CancelarVueloResult> {
    return this.instance.post('/vuelos/cancelar', request)
      .then((r) => r.data as CancelarVueloResult)
  }

  descancelarVuelo(vueloId: string, contexto: AlmacenContexto = 'OPERACION'): Promise<DescancelarVueloResult> {
    return this.instance.post('/vuelos/descancelar', { vueloId, contexto })
      .then((r) => r.data as DescancelarVueloResult)
  }

  obtenerVuelosCancelados(contexto: AlmacenContexto = 'OPERACION'): Promise<string[]> {
    return this.get<string[]>('/vuelos/cancelados', { contexto })
  }

  obtenerProgramacionesVuelo(contexto: AlmacenContexto = 'OPERACION'): Promise<ProgramacionVueloDTO[]> {
    return this.get<ProgramacionVueloDTO[]>('/vuelos/programaciones', { contexto })
  }

  crearProgramacionVuelo(data: ProgramacionVueloDTO, contexto: AlmacenContexto = 'OPERACION'): Promise<ProgramacionVueloDTO> {
    return this.instance.post('/vuelos/programaciones', data, { params: { contexto } }).then((r) => r.data)
  }

  actualizarProgramacionVuelo(id: number, data: ProgramacionVueloDTO, contexto: AlmacenContexto = 'OPERACION'): Promise<ProgramacionVueloDTO> {
    return this.instance.put(`/vuelos/programaciones/${id}`, data, { params: { contexto } }).then((r) => r.data)
  }

  eliminarProgramacionVuelo(id: number, contexto: AlmacenContexto = 'OPERACION'): Promise<void> {
    return this.instance.delete(`/vuelos/programaciones/${id}`, { params: { contexto } }).then(() => undefined)
  }

  obtenerLogsPlanificacion(): Promise<PlanificacionLogDTO[]> {
    return this.get<PlanificacionLogDTO[]>('/planificacion/logs')
  }

  agregarEnvios(envios: EnvioEntrada[]): Promise<AgregarEnviosResult> {
    return this.instance.post('/envios', { envios })
      .then((r) => r.data as AgregarEnviosResult)
  }

  obtenerEnviosIncrementales(): Promise<EnviosIncrementalesResponse> {
    return this.get<EnviosIncrementalesResponse>('/envios/incrementales')
  }

  buscarEnvios(query: string): Promise<EnvioBusquedaResponse> {
    return this.get<EnvioBusquedaResponse>(`/envios/buscar?q=${encodeURIComponent(query)}`)
  }

  listarEnvios(estados?: string, origen?: string, horas?: number): Promise<EnvioBusquedaResponse> {
    const params = new URLSearchParams()
    if (estados) params.set('estados', estados)
    if (origen) params.set('origen', origen)
    if (horas !== undefined) params.set('horas', String(horas))
    const qs = params.toString()
    return this.get<EnvioBusquedaResponse>(`/envios/lista${qs ? '?' + qs : ''}`)
  }

  listarMaletas(estados?: string, origen?: string, horas?: number): Promise<MaletaBusquedaResponse> {
    const params = new URLSearchParams()
    if (estados) params.set('estados', estados)
    if (origen) params.set('origen', origen)
    if (horas !== undefined) params.set('horas', String(horas))
    const qs = params.toString()
    return this.get<MaletaBusquedaResponse>(`/envios/maletas/lista${qs ? '?' + qs : ''}`)
  }

  // ---- Almacenes CRUD ----
  obtenerAlmacenes(contexto: AlmacenContexto = 'OPERACION'): Promise<AlmacenDTO[]> {
    return this.get<AlmacenDTO[]>('/almacenes', { contexto })
  }

  crearAlmacen(data: AlmacenDTO, contexto: AlmacenContexto = 'OPERACION'): Promise<AlmacenDTO> {
    return this.instance.post('/almacenes', data, { params: { contexto } }).then((r) => r.data)
  }

  actualizarAlmacen(codigo: string, data: Partial<AlmacenDTO>, contexto: AlmacenContexto = 'OPERACION'): Promise<AlmacenDTO> {
    return this.instance.put(`/almacenes/${codigo}`, data, { params: { contexto } }).then((r) => r.data)
  }

  eliminarAlmacen(codigo: string, contexto: AlmacenContexto = 'OPERACION'): Promise<void> {
    return this.instance.delete(`/almacenes/${codigo}`, { params: { contexto } }).then(() => undefined)
  }
}

export const cargaArchivosService = new CargaArchivosService()
