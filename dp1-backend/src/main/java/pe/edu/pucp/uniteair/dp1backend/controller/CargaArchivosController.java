package pe.edu.pucp.uniteair.dp1backend.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import pe.edu.pucp.uniteair.dp1backend.cache.SimulationCache;
import pe.edu.pucp.uniteair.dp1backend.config.AeropuertoCoordenadas;
import pe.edu.pucp.uniteair.dp1backend.dto.AeropuertoDTO;
import pe.edu.pucp.uniteair.dp1backend.dto.SimulationState;
import pe.edu.pucp.uniteair.dp1backend.dto.VueloDTO;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.service.CargaArchivosService;
import pe.edu.pucp.uniteair.dp1backend.service.AlmacenService;
import pe.edu.pucp.uniteair.dp1backend.service.ContextSyncStateService;
import pe.edu.pucp.uniteair.dp1backend.service.DatasetContextService;
import pe.edu.pucp.uniteair.dp1backend.service.RelojOperativoService;
import pe.edu.pucp.uniteair.dp1backend.entity.Almacen;
import pe.edu.pucp.uniteair.dp1backend.util.TimezoneSedeResolver;
import tasf.core.Dataset;
import tasf.model.Paquete;
import tasf.model.Vuelo;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/carga")
public class CargaArchivosController {
    private final CargaArchivosService cargaArchivosService;
    private final AlmacenService almacenService;
    private final ContextSyncStateService contextSyncStateService;
    private final DatasetContextService datasetContextService;
    private final SimulationCache simulationCache;
    private final RelojOperativoService relojOperativoService;

    public CargaArchivosController(CargaArchivosService cargaArchivosService,
                                   AlmacenService almacenService,
                                   ContextSyncStateService contextSyncStateService,
                                   DatasetContextService datasetContextService,
                                   SimulationCache simulationCache,
                                   RelojOperativoService relojOperativoService) {
        this.cargaArchivosService = cargaArchivosService;
        this.almacenService = almacenService;
        this.contextSyncStateService = contextSyncStateService;
        this.datasetContextService = datasetContextService;
        this.simulationCache = simulationCache;
        this.relojOperativoService = relojOperativoService;
    }

    @PostMapping("/upload")
    public ResponseEntity<Map<String, Object>> uploadFiles(
            @RequestParam(value = "planes_vuelo", required = false) MultipartFile planesVuelo,
            @RequestParam(value = "aeropuertos", required = false) MultipartFile aeropuertos,
            @RequestParam("timezone") String timezone,
            @RequestParam("envios") MultipartFile envios) {
        String origenDetectado = inferirOrigenPorTimezone(timezone);
        String timezoneCanonica = TimezoneSedeResolver.normalizarTimezoneCanonica(timezone);

        boolean tieneDatasetCompleto = (planesVuelo != null && !planesVuelo.isEmpty())
                || (aeropuertos != null && !aeropuertos.isEmpty());

        if (tieneDatasetCompleto) {
            var result = cargaArchivosService.cargarArchivos(
                    planesVuelo,
                    aeropuertos,
                    envios,
                    origenDetectado,
                    timezoneCanonica
            );
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("success", result.success());
            body.put("message", result.message());
            body.put("aeropuertosCount", result.aeropuertosCount());
            body.put("vuelosCount", result.vuelosCount());
            body.put("paquetesCount", result.paquetesCount());
            if (result.datasetId() != null) {
                body.put("datasetId", result.datasetId());
            }
            if (!result.success()) {
                return ResponseEntity.badRequest().body(body);
            }
            return ResponseEntity.ok(body);
        }

        try {
            List<Paquete> paquetes = cargaArchivosService.cargarEnviosDesdeArchivo(envios, origenDetectado);
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "Envios cargados exitosamente desde archivo",
                    "paquetesCount", paquetes.size()
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                "message", e.getMessage()
            ));
        }
    }

    private String inferirOrigenPorTimezone(String timezone) {
        return TimezoneSedeResolver.inferirAeropuertoPorTimezone(timezone);
    }

    @GetMapping("/aeropuertos")
    public ResponseEntity<List<AeropuertoDTO>> obtenerAeropuertos(
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto
    ) {
        boolean esSimulacion = contexto == AlmacenContexto.SIMULACION;
        if (contexto == AlmacenContexto.SIMULACION) {
            SimulationState estadoSimulacion = obtenerEstadoSimulacionActivo();
            if (estadoSimulacion != null && estadoSimulacion.getAeropuertos() != null) {
                return ResponseEntity.ok(
                        combinarAeropuertosConAlmacenes(estadoSimulacion.getAeropuertos(), contexto)
                );
            }
        }

        Dataset dataset = construirDatasetEfectivoParaContexto(contexto);
        if (dataset == null) {
            return ResponseEntity.ok(List.of());
        }
        LocalDateTime ahora = contexto == AlmacenContexto.OPERACION
                ? relojOperativoService.obtenerTiempoActualUtc()
                : LocalDateTime.now(ZoneOffset.UTC);
        Set<String> vuelosCancelados = cargaArchivosService.obtenerVuelosCancelados(contexto);

        Map<String, List<String>> entrantesMap = new HashMap<>();
        Map<String, List<String>> salientesMap = new HashMap<>();
        Map<String, List<String>> canceladosMap = new HashMap<>();

        for (Vuelo v : dataset.getVuelos()) {
            String origen = v.getOrigen().getCodigoOACI();
            String destino = v.getDestino().getCodigoOACI();
            entrantesMap.computeIfAbsent(destino, k -> new ArrayList<>()).add(v.getId());
            salientesMap.computeIfAbsent(origen, k -> new ArrayList<>()).add(v.getId());
            if (vuelosCancelados.contains(v.getId())) {
                canceladosMap.computeIfAbsent(origen, k -> new ArrayList<>()).add(v.getId());
            }
        }

        Map<String, Almacen> almacenMap = almacenService.getMapaAlmacenes(contexto);
        Set<String> codigos = new LinkedHashSet<>(dataset.getAeropuertos().keySet());
        codigos.addAll(almacenMap.keySet());

        List<AeropuertoDTO> aeropuertos = codigos.stream()
                .map(codigo -> {
                    var aeropuerto = dataset.getAeropuertos().get(codigo);
                    double[] coord = AeropuertoCoordenadas.get(codigo);
                    Almacen alm = almacenMap.get(codigo);
                    String ciudad = alm != null ? alm.getCiudad() : null;
                    String pais = alm != null ? alm.getPais() : null;
                    double latitud = alm != null ? alm.getLatitud() : (coord != null ? coord[0] : 0.0);
                    double longitud = alm != null ? alm.getLongitud() : (coord != null ? coord[1] : 0.0);
                    int capacidadMaxima = alm != null ? alm.getCapacidadMaxima() : (aeropuerto != null ? aeropuerto.getCapacidadMaxima() : 0);
                    int ocup = (!esSimulacion && aeropuerto != null)
                            ? cargaArchivosService.getOcupacionAeropuerto(codigo, ahora)
                            : 0;
                    return AeropuertoDTO.builder()
                            .codigoOACI(codigo)
                            .latitud(latitud)
                            .longitud(longitud)
                            .ciudad(ciudad)
                            .pais(pais)
                            .capacidadMaxima(capacidadMaxima)
                            .ocupacionActual(ocup)
                            .vuelosEntrantes(entrantesMap.getOrDefault(codigo, List.of()))
                            .vuelosSalientes(salientesMap.getOrDefault(codigo, List.of()))
                            .vuelosCanceladosSalientes(canceladosMap.getOrDefault(codigo, List.of()))
                            .build();
                })
                .collect(Collectors.toList());
        return ResponseEntity.ok(aeropuertos);
    }

    @GetMapping("/estado-compartido")
    public ResponseEntity<Map<String, Object>> obtenerEstadoCompartido(
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto
    ) {
        return ResponseEntity.ok(contextSyncStateService.snapshot(contexto));
    }

    private List<AeropuertoDTO> combinarAeropuertosConAlmacenes(
            List<AeropuertoDTO> baseAeropuertos,
            AlmacenContexto contexto
    ) {
        Map<String, Almacen> almacenMap = almacenService.getMapaAlmacenes(contexto);
        Map<String, AeropuertoDTO> combinados = new LinkedHashMap<>();

        for (AeropuertoDTO aeropuerto : baseAeropuertos) {
            Almacen almacen = almacenMap.get(aeropuerto.getCodigoOACI());
            combinados.put(aeropuerto.getCodigoOACI(), aplicarAlmacenSobreAeropuerto(aeropuerto, almacen));
        }

        for (Almacen almacen : almacenMap.values()) {
            combinados.computeIfAbsent(
                    almacen.getCodigoOACI(),
                    codigo -> aplicarAlmacenSobreAeropuerto(
                            AeropuertoDTO.builder()
                                    .codigoOACI(codigo)
                                    .ocupacionActual(0)
                                    .vuelosEntrantes(List.of())
                                    .vuelosSalientes(List.of())
                                    .vuelosCanceladosSalientes(List.of())
                                    .build(),
                            almacen
                    )
            );
        }

        return new ArrayList<>(combinados.values());
    }

    private AeropuertoDTO aplicarAlmacenSobreAeropuerto(AeropuertoDTO base, Almacen almacen) {
        if (almacen == null) {
            return base;
        }

        double latitud = almacen.getLatitud();
        double longitud = almacen.getLongitud();
        int capacidadMaxima = almacen.getCapacidadMaxima();

        return AeropuertoDTO.builder()
                .codigoOACI(base.getCodigoOACI())
                .latitud(latitud != 0 ? latitud : base.getLatitud())
                .longitud(longitud != 0 ? longitud : base.getLongitud())
                .ciudad(almacen.getCiudad() != null ? almacen.getCiudad() : base.getCiudad())
                .pais(almacen.getPais() != null ? almacen.getPais() : base.getPais())
                .capacidadMaxima(capacidadMaxima > 0 ? capacidadMaxima : base.getCapacidadMaxima())
                .ocupacionActual(base.getOcupacionActual())
                .vuelosEntrantes(base.getVuelosEntrantes() != null ? base.getVuelosEntrantes() : List.of())
                .vuelosSalientes(base.getVuelosSalientes() != null ? base.getVuelosSalientes() : List.of())
                .vuelosCanceladosSalientes(
                        base.getVuelosCanceladosSalientes() != null ? base.getVuelosCanceladosSalientes() : List.of()
                )
                .build();
    }

    @GetMapping("/vuelos")
    public ResponseEntity<List<VueloDTO>> obtenerVuelos(
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto
    ) {
        boolean esSimulacion = contexto == AlmacenContexto.SIMULACION;
        if (contexto == AlmacenContexto.SIMULACION) {
            SimulationState estadoSimulacion = obtenerEstadoSimulacionActivo();
            if (estadoSimulacion != null && estadoSimulacion.getVuelos() != null) {
                List<VueloDTO> vuelosContexto = construirVuelosDTO(
                        contexto,
                        true,
                        estadoSimulacion.getSimulationTime() != null
                                ? estadoSimulacion.getSimulationTime()
                                : relojOperativoService.obtenerTiempoActualUtc()
                );
                return ResponseEntity.ok(
                        combinarVuelosConContexto(estadoSimulacion.getVuelos(), vuelosContexto)
                );
            }
        }

        LocalDateTime referenciaOperacion = contexto == AlmacenContexto.OPERACION
                ? cargaArchivosService.obtenerTiempoOperativoActualUtc()
                : relojOperativoService.obtenerTiempoActualUtc();
        return ResponseEntity.ok(
                construirVuelosDTO(contexto, esSimulacion, referenciaOperacion)
        );
    }

    private List<VueloDTO> construirVuelosDTO(
            AlmacenContexto contexto,
            boolean esSimulacion,
            LocalDateTime referenciaUtc
    ) {
        Dataset dataset = construirDatasetEfectivoParaContexto(contexto);
        if (dataset == null) {
            return List.of();
        }

        Set<String> vuelosCancelados = cargaArchivosService.obtenerVuelosCancelados(contexto);
        boolean operacionSoloManual = contexto == AlmacenContexto.OPERACION && !cargaArchivosService.usaPaquetesBaseEnOperacion();
        LocalDateTime ahora = referenciaUtc != null ? referenciaUtc : relojOperativoService.obtenerTiempoActualUtc();
        Map<String, Almacen> almacenMap = almacenService.getMapaAlmacenes(contexto);
        List<VueloDTO> vuelos = new ArrayList<>();

        for (Vuelo v : dataset.getVuelos()) {
            double[] orig = AeropuertoCoordenadas.get(v.getOrigen().getCodigoOACI());
            double[] dest = AeropuertoCoordenadas.get(v.getDestino().getCodigoOACI());
            Almacen almOrigen = almacenMap.get(v.getOrigen().getCodigoOACI());
            Almacen almDestino = almacenMap.get(v.getDestino().getCodigoOACI());
            double latOrigen = resolverLatitud(almOrigen, orig);
            double lonOrigen = resolverLongitud(almOrigen, orig);
            double latDestino = resolverLatitud(almDestino, dest);
            double lonDestino = resolverLongitud(almDestino, dest);
            int carga = esSimulacion ? 0 : cargaArchivosService.getCargaVuelo(v.getId());
            double progreso = calcularProgreso(v, ahora);

            String estado;
            if (vuelosCancelados.contains(v.getId())) {
                estado = "CANCELADO";
            } else if (progreso >= 100.0) {
                estado = "CULMINADO";
            } else if (progreso > 0.0) {
                estado = "ACTIVO";
            } else {
                estado = "PROGRAMADO";
            }

            boolean editable = v.getId() != null && v.getId().startsWith("USR-");
            if (operacionSoloManual && carga <= 0 && !editable && !vuelosCancelados.contains(v.getId())) {
                continue;
            }

            vuelos.add(VueloDTO.builder()
                    .id(v.getId())
                    .origen(v.getOrigen().getCodigoOACI())
                    .destino(v.getDestino().getCodigoOACI())
                    .latOrigen(latOrigen)
                    .lonOrigen(lonOrigen)
                    .latDestino(latDestino)
                    .lonDestino(lonDestino)
                    .salidaUtc(v.getSalidaUtc())
                    .llegadaUtc(v.getLlegadaUtc())
                    .capacidad(v.getCapacidadCarga())
                    .cargaActual(carga)
                    .progresoVuelo(progreso)
                    .estado(estado)
                    .programacionId(extraerProgramacionId(v.getId()))
                    .editable(editable)
                    .recurrente(editable)
                    .build());
        }

        return vuelos;
    }

    private List<VueloDTO> combinarVuelosConContexto(
            List<VueloDTO> vuelosEstado,
            List<VueloDTO> vuelosContexto
    ) {
        Map<String, VueloDTO> combinados = new LinkedHashMap<>();
        Map<String, VueloDTO> contextoMap = new LinkedHashMap<>();

        for (VueloDTO vuelo : vuelosContexto) {
            combinados.put(vuelo.getId(), vuelo);
            contextoMap.put(vuelo.getId(), vuelo);
        }

        for (VueloDTO vuelo : vuelosEstado) {
            VueloDTO contexto = contextoMap.get(vuelo.getId());
            if (contexto == null) {
                combinados.put(vuelo.getId(), vuelo);
                continue;
            }

            combinados.put(vuelo.getId(), VueloDTO.builder()
                    .id(vuelo.getId())
                    .origen(vuelo.getOrigen())
                    .destino(vuelo.getDestino())
                    .latOrigen(contexto.getLatOrigen())
                    .lonOrigen(contexto.getLonOrigen())
                    .latDestino(contexto.getLatDestino())
                    .lonDestino(contexto.getLonDestino())
                    .salidaUtc(vuelo.getSalidaUtc())
                    .llegadaUtc(vuelo.getLlegadaUtc())
                    .capacidad(contexto.getCapacidad())
                    .cargaActual(vuelo.getCargaActual())
                    .progresoVuelo(vuelo.getProgresoVuelo())
                    .estado("CANCELADO".equals(contexto.getEstado()) ? "CANCELADO" : vuelo.getEstado())
                    .programacionId(contexto.getProgramacionId())
                    .editable(contexto.isEditable() || vuelo.isEditable())
                    .recurrente(contexto.isRecurrente() || vuelo.isRecurrente())
                    .build());
        }

        return new ArrayList<>(combinados.values());
    }

    private double resolverLatitud(Almacen almacen, double[] coordenadasFallback) {
        if (almacen != null) {
            return almacen.getLatitud();
        }
        return coordenadasFallback != null && coordenadasFallback.length > 0 ? coordenadasFallback[0] : 0.0;
    }

    private double resolverLongitud(Almacen almacen, double[] coordenadasFallback) {
        if (almacen != null) {
            return almacen.getLongitud();
        }
        return coordenadasFallback != null && coordenadasFallback.length > 1 ? coordenadasFallback[1] : 0.0;
    }

    private double calcularProgreso(Vuelo vuelo, LocalDateTime referenciaUtc) {
        if (vuelo == null || referenciaUtc == null || vuelo.getSalidaUtc() == null || vuelo.getLlegadaUtc() == null) {
            return 0.0;
        }
        long totalSegundos = java.time.Duration.between(vuelo.getSalidaUtc(), vuelo.getLlegadaUtc()).getSeconds();
        if (totalSegundos <= 0) {
            return 0.0;
        }
        long transcurrido = java.time.Duration.between(vuelo.getSalidaUtc(), referenciaUtc).getSeconds();
        if (transcurrido <= 0) {
            return 0.0;
        }
        if (transcurrido >= totalSegundos) {
            return 100.0;
        }
        return (double) transcurrido / totalSegundos * 100.0;
    }

    private Long extraerProgramacionId(String vueloId) {
        if (vueloId == null || !vueloId.startsWith("USR-")) {
            return null;
        }
        String[] partes = vueloId.split("-");
        if (partes.length < 3) {
            return null;
        }
        try {
            return Long.parseLong(partes[1]);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private SimulationState obtenerEstadoSimulacionActivo() {
        String sessionId = simulationCache.getActiveSessionId();
        if (sessionId == null) {
            return null;
        }
        return simulationCache.get(sessionId);
    }

    private Dataset construirDatasetEfectivoParaContexto(AlmacenContexto contexto) {
        Dataset base = cargaArchivosService.obtenerUltimoDataset();
        if (base == null) {
            return null;
        }

        if (contexto != AlmacenContexto.SIMULACION) {
            return datasetContextService.construirDatasetEfectivo(contexto, base);
        }

        SimulationState estadoSimulacion = obtenerEstadoSimulacionActivo();
        if (estadoSimulacion == null) {
            return datasetContextService.construirDatasetEfectivo(contexto, base);
        }

        LocalDateTime fechaInicioSesion = estadoSimulacion.getFechaInicio() != null
                ? estadoSimulacion.getFechaInicio()
                : estadoSimulacion.getSimulationTime();
        LocalDateTime tiempoReferencia = estadoSimulacion.getSimulationTime() != null
                ? estadoSimulacion.getSimulationTime()
                : fechaInicioSesion;

        if (fechaInicioSesion == null || tiempoReferencia == null) {
            return datasetContextService.construirDatasetEfectivo(contexto, base);
        }

        int diasVentana = (int) ChronoUnit.DAYS.between(
                fechaInicioSesion.toLocalDate(),
                tiempoReferencia.toLocalDate()
        ) + 3;

        return datasetContextService.construirDatasetEfectivo(
                contexto,
                base,
                fechaInicioSesion.toLocalDate(),
                Math.max(diasVentana, 1)
        );
    }
}
