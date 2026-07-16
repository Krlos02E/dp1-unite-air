package pe.edu.pucp.uniteair.dp1backend.service;

import org.springframework.stereotype.Service;
import pe.edu.pucp.uniteair.dp1backend.config.AeropuertoCoordenadas;
import pe.edu.pucp.uniteair.dp1backend.dto.AeropuertoDTO;
import pe.edu.pucp.uniteair.dp1backend.cache.SimulationCache;
import pe.edu.pucp.uniteair.dp1backend.dto.LogEntry;
import pe.edu.pucp.uniteair.dp1backend.dto.SimulationState;
import pe.edu.pucp.uniteair.dp1backend.dto.SimulacionConfigRequest;
import pe.edu.pucp.uniteair.dp1backend.dto.VueloDTO;
import pe.edu.pucp.uniteair.dp1backend.engine.SimulationEngine;
import pe.edu.pucp.uniteair.dp1backend.entity.Almacen;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.entity.SimulationSession;
import pe.edu.pucp.uniteair.dp1backend.repository.SimulationSessionRepository;
import tasf.config.Config_Simulacion;
import tasf.core.Dataset;
import tasf.model.Vuelo;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class SimulationService {

    private final SimulationSessionRepository sessionRepository;
    private final SimulationCache simulationCache;
    private final SimulationEngine simulationEngine;
    private final CargaArchivosService cargaArchivosService;
    private final DatasetContextService datasetContextService;
    private final AlmacenService almacenService;
    private final SimulationContextService simulationContextService;

    public SimulationService(SimulationSessionRepository sessionRepository,
                             SimulationCache simulationCache,
                             SimulationEngine simulationEngine,
                             CargaArchivosService cargaArchivosService,
                             DatasetContextService datasetContextService,
                             AlmacenService almacenService,
                             SimulationContextService simulationContextService) {
        this.sessionRepository = sessionRepository;
        this.simulationCache = simulationCache;
        this.simulationEngine = simulationEngine;
        this.cargaArchivosService = cargaArchivosService;
        this.datasetContextService = datasetContextService;
        this.almacenService = almacenService;
        this.simulationContextService = simulationContextService;
    }

    public SimulationState iniciarSimulacion(SimulacionConfigRequest req, Dataset dataset) {
        String sessionId = UUID.randomUUID().toString();

        LocalDate fecha = req.getFechaInicio() != null
                ? LocalDate.parse(req.getFechaInicio(), DateTimeFormatter.ISO_LOCAL_DATE)
                : LocalDate.now();
        LocalTime hora = req.getHoraInicio() != null
                ? LocalTime.parse(req.getHoraInicio(), DateTimeFormatter.ISO_LOCAL_TIME)
                : LocalTime.now();
        LocalDateTime fechaInicio = LocalDateTime.of(fecha, hora);

        int duracionDias = req.getDuracionDias() > 0 ? req.getDuracionDias() : 3;
        String algoritmo = req.getAlgoritmo() != null ? req.getAlgoritmo() : "ALNS";
        double velocidad = req.getVelocidad() > 0 ? req.getVelocidad() : 1.0;

        Config_Simulacion config = new Config_Simulacion();
        config.setAeropuertoHub("SKBO");
        config.setMinimaConexion(java.time.Duration.ofMinutes(10));
        config.setIteracionesALNS(10);
        config.setMaxRutasPorPaquete(5);
        config.setMaxEscalas(2);
        config.setVentanaActualizacionPesos(5);
        config.setEvaporacionFeromona(0.4);

        System.out.println("[SimulationService] iniciarSimulacion sessionId=" + sessionId
                + " fecha=" + fecha
                + " hora=" + hora
                + " duracionDias=" + duracionDias
                + " algoritmo=" + algoritmo
                + " iteracionesALNS=" + config.getIteracionesALNS()
                + " maxRutas=" + config.getMaxRutasPorPaquete());
        // Evita lanzar una segunda planificacion pesada de operacion mientras la simulacion
        // ya esta calculando su propia planificacion inicial.
        cargaArchivosService.cargarDatasetConFechas(fecha, duracionDias, false);
        Dataset ultimoDataset = cargaArchivosService.obtenerUltimoDataset();
        System.out.println("[SimulationService] ultimoDataset paquetes="
                + (ultimoDataset != null ? ultimoDataset.getPaquetes().size() : -1)
                + " vuelos="
                + (ultimoDataset != null ? ultimoDataset.getVuelos().size() : -1));
        dataset = datasetContextService.construirDatasetEfectivo(
                AlmacenContexto.SIMULACION,
                ultimoDataset,
                fecha,
                duracionDias + 2
        );
        System.out.println("[SimulationService] dataset simulacion efectivo paquetes="
                + (dataset != null ? dataset.getPaquetes().size() : -1)
                + " vuelos="
                + (dataset != null ? dataset.getVuelos().size() : -1)
                + " (dataset completo para la simulacion; ALNS usa ventana rodante aparte)");
        if (dataset == null) {
            return SimulationState.builder()
                    .sessionId(sessionId)
                    .status("ERROR")
                    .startedAt(LocalDateTime.now())
                    .simulationTime(fechaInicio)
                    .fechaInicio(fechaInicio)
                    .horizontePlanificacionMinutos(180)
                    .planificacionEstable(false)
                    .vuelos(new ArrayList<>())
                    .aeropuertos(new ArrayList<>())
                    .maletasEntregadas(0)
                    .maletasEnTransito(0)
                    .vuelosCulminados(0)
                    .vuelosEnTransito(0)
                    .vuelosCancelados(0)
                    .progreso(0)
                    .colapsada(false)
                    .elapsedRealtimeSeconds(0L)
                    .logs(List.of(LogEntry.builder()
                            .timestamp(LocalDateTime.now())
                            .tipo("ERROR")
                            .mensaje("No se pudo cargar el dataset para las fechas seleccionadas")
                            .build()))
                    .maletas(new ArrayList<>())
                    .build();
            }

        SimulationSession session = SimulationSession.builder()
                .sessionId(sessionId)
                .isNewSession(true)
                .estado("PLANIFICANDO")
                .duracionDias(duracionDias)
                .fechaInicio(fechaInicio)
                .fechaActualSimulacion(fechaInicio)
                .velocidad(velocidad)
                .algoritmo(algoritmo)
                .progresoPorcentaje(0)
                .createdAt(LocalDateTime.now())
                .build();
        sessionRepository.save(session);

        ArrayList<LogEntry> logs = new ArrayList<>();
        logs.add(LogEntry.builder()
                .timestamp(LocalDateTime.now())
                .tipo("INFO")
                .mensaje("Iniciando planificación de rutas...")
                .build());

        SimulationState initialState = SimulationState.builder()
                .sessionId(sessionId)
                .status("PLANIFICANDO")
                .startedAt(session.getCreatedAt())
                .simulationTime(fechaInicio)
                .fechaInicio(fechaInicio)
                .horizontePlanificacionMinutos(180)
                .planificacionEstable(false)
                .vuelos(new ArrayList<>())
                .aeropuertos(new ArrayList<>())
                .maletasEntregadas(0)
                .maletasEnTransito(0)
                .vuelosCulminados(0)
                .vuelosEnTransito(0)
                .vuelosCancelados(0)
                .progreso(0)
                .colapsada(false)
                .elapsedRealtimeSeconds(0L)
                .logs(logs)
                .maletas(new ArrayList<>())
                .build();
        simulationCache.put(sessionId, initialState);

        simulationEngine.ejecutarSimulacion(sessionId, dataset, config, algoritmo,
                duracionDias, fechaInicio, velocidad);

        return simulationCache.get(sessionId);
    }

    public Map<String, Object> obtenerInfoSesionActivaDesdeEstado(SimulationState state) {
        SimulationState lastFinishedState = simulationCache.getLastFinishedState();
        if (state == null) {
            Map<String, Object> payload = new HashMap<>();
            payload.put("activa", false);
            if (lastFinishedState != null) {
                payload.put("latestFinishedState", lastFinishedState);
            }
            return payload;
        }
        long elapsed = state.getStartedAt() != null
                ? Duration.between(state.getStartedAt(), LocalDateTime.now()).getSeconds()
                : 0;
        boolean activa = state.getStatus() != null
                && !"COMPLETADA".equals(state.getStatus())
                && !"COLAPSADA".equals(state.getStatus())
                && !"ERROR".equals(state.getStatus());
        Map<String, Object> payload = new HashMap<>();
        payload.put("activa", activa);
        payload.put("sessionId", state.getSessionId());
        payload.put("status", state.getStatus());
        payload.put("progreso", state.getProgreso());
        payload.put("startedAt", state.getStartedAt());
        payload.put("simulationStartedAt", state.getFechaInicio());
        payload.put("elapsedRealtimeSeconds", Math.max(0, elapsed));
        payload.put("fechaInicio", state.getFechaInicio());
        if (lastFinishedState != null) {
            payload.put("latestFinishedState", lastFinishedState);
        }
        return payload;
    }

    public SimulationState obtenerUltimoReporteFinal() {
        return simulationCache.getLastFinishedState();
    }

    public SimulationState obtenerEstado(String sessionId) {
        SimulationState state = simulationCache.get(sessionId);
        if (state == null) {
            state = simulationCache.getStable(sessionId);
        }
        if (state == null) {
            var session = sessionRepository.findById(sessionId).orElse(null);
            if (session != null) {
                long elapsed = session.getCreatedAt() != null
                        ? Duration.between(session.getCreatedAt(), LocalDateTime.now()).getSeconds()
                        : 0;
                return SimulationState.builder()
                        .sessionId(sessionId)
                        .status(session.getEstado())
                        .startedAt(session.getCreatedAt())
                        .simulationTime(session.getFechaActualSimulacion())
                        .fechaInicio(session.getFechaInicio())
                        .horizontePlanificacionMinutos(180)
                        .planificacionEstable(false)
                        .maletasEntregadas(0)
                        .maletasEnTransito(0)
                        .vuelosCulminados(0)
                        .vuelosEnTransito(0)
                        .vuelosCancelados(0)
                        .progreso(session.getProgresoPorcentaje())
                        .colapsada("COLAPSADA".equals(session.getEstado()))
                        .motivoColapso(session.getMotivoColapso())
                        .elapsedRealtimeSeconds(Math.max(0, elapsed))
                        .logs(new ArrayList<>())
                        .maletas(new ArrayList<>())
                        .build();
            }
            return null;
        }
        List<LogEntry> logs = state.getLogs();
        if (logs != null && logs.size() > 50) {
            logs = logs.subList(logs.size() - 50, logs.size());
        }
        long elapsed = state.getStartedAt() != null
                ? Duration.between(state.getStartedAt(), LocalDateTime.now()).getSeconds()
                : 0;
        return SimulationState.builder()
                .sessionId(state.getSessionId())
                .status(state.getStatus())
                .startedAt(state.getStartedAt())
                .simulationTime(state.getSimulationTime())
                .fechaInicio(state.getFechaInicio())
                .ultimaPlanificacionSimulada(state.getUltimaPlanificacionSimulada())
                .horizontePlanificacionMinutos(state.getHorizontePlanificacionMinutos())
                .duracionUltimaPlanificacionSeg(state.getDuracionUltimaPlanificacionSeg())
                .ultimaPlanificacionSinRuta(state.getUltimaPlanificacionSinRuta())
                .planificacionEstable(state.getPlanificacionEstable())
                .elapsedRealtimeSeconds(Math.max(0, elapsed))
                .vuelos(state.getVuelos())
                .aeropuertos(state.getAeropuertos())
                .maletasEntregadas(state.getMaletasEntregadas())
                .maletasEnTransito(state.getMaletasEnTransito())
                .vuelosCulminados(state.getVuelosCulminados())
                .vuelosEnTransito(state.getVuelosEnTransito())
                .vuelosCancelados(state.getVuelosCancelados())
                .progreso(state.getProgreso())
                .colapsada(state.isColapsada())
                .motivoColapso(state.getMotivoColapso())
                .logs(logs != null ? new ArrayList<>(logs) : null)
                .envios(state.getEnvios())
                .maletas(state.getMaletas())
                .build();
    }

    public SimulationSession obtenerSesionActiva() {
        String activeSessionId = simulationCache.getActiveSessionId();
        if (activeSessionId != null) {
            var activeSession = sessionRepository.findById(activeSessionId).orElse(null);
            if (activeSession != null
                    && Arrays.asList("PLANIFICANDO", "EJECUTANDO").contains(activeSession.getEstado())
                    && simulationEngine.isSimulacionActiva(activeSessionId)) {
                return activeSession;
            }
        }

        var candidateSession = sessionRepository
                .findTopByEstadoInOrderByCreatedAtDesc(Arrays.asList("PLANIFICANDO", "EJECUTANDO"))
                .orElse(null);

        if (candidateSession == null) {
            return null;
        }

        if (simulationEngine.isSimulacionActiva(candidateSession.getSessionId())) {
            return candidateSession;
        }

        if (candidateSession.getCreatedAt() != null
                && Duration.between(candidateSession.getCreatedAt(), LocalDateTime.now()).getSeconds() < 30) {
            return candidateSession;
        }

        candidateSession.setEstado("ERROR");
        candidateSession.setMotivoColapso("Simulación interrumpida: el proceso del backend ya no estaba activo.");
        sessionRepository.save(candidateSession);
        return null;
    }

    public SimulationState detenerSimulacion(String sessionId) {
        simulationEngine.detenerSimulacion(sessionId);
        SimulationState state = simulationCache.get(sessionId);
        if (state == null) {
            state = simulationCache.getStable(sessionId);
        }
        var session = sessionRepository.findById(sessionId).orElse(null);
        if (session != null) {
            session.setEstado("COMPLETADA");
            session.setProgresoPorcentaje(100);
            sessionRepository.save(session);
        }
        if (state != null) {
            SimulationState completedState = SimulationState.builder()
                    .sessionId(state.getSessionId())
                    .status("COMPLETADA")
                    .startedAt(state.getStartedAt())
                    .simulationTime(state.getSimulationTime())
                    .fechaInicio(state.getFechaInicio())
                    .ultimaPlanificacionSimulada(state.getUltimaPlanificacionSimulada())
                    .horizontePlanificacionMinutos(state.getHorizontePlanificacionMinutos())
                    .duracionUltimaPlanificacionSeg(state.getDuracionUltimaPlanificacionSeg())
                    .ultimaPlanificacionSinRuta(state.getUltimaPlanificacionSinRuta())
                    .planificacionEstable(state.getPlanificacionEstable())
                    .vuelos(state.getVuelos())
                    .aeropuertos(state.getAeropuertos())
                    .maletasEntregadas(state.getMaletasEntregadas())
                    .maletasEnTransito(state.getMaletasEnTransito())
                    .vuelosCulminados(state.getVuelosCulminados())
                    .vuelosEnTransito(state.getVuelosEnTransito())
                    .vuelosCancelados(state.getVuelosCancelados())
                    .progreso(100)
                    .colapsada(false)
                    .motivoColapso(state.getMotivoColapso())
                    .elapsedRealtimeSeconds(state.getElapsedRealtimeSeconds())
                    .logs(state.getLogs())
                    .envios(state.getEnvios())
                    .maletas(state.getMaletas())
                    .build();
            simulationCache.put(sessionId, completedState);
            simulationCache.putStable(sessionId, completedState);
            simulationContextService.reiniciarContextoSimulacion();
            return completedState;
        }
        simulationContextService.reiniciarContextoSimulacion();
        return null;
    }

    public void pausarSimulacion(String sessionId) {
        simulationEngine.pausarSimulacion(sessionId);
    }

    public void reanudarSimulacion(String sessionId) {
        simulationEngine.reanudarSimulacion(sessionId);
    }

    public void refrescarEstadoVisualSesionActivaSimulacion() {
        SimulationSession activeSession = obtenerSesionActiva();
        if (activeSession == null) {
            return;
        }
        refrescarEstadoVisualSimulacion(activeSession.getSessionId());
    }

    public void refrescarEstadoVisualSimulacion(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            return;
        }

        SimulationState currentState = simulationCache.get(sessionId);
        if (currentState == null) {
            currentState = simulationCache.getStable(sessionId);
        }
        if (currentState == null) {
            return;
        }

        SimulationSession session = sessionRepository.findById(sessionId).orElse(null);
        Dataset baseDataset = cargaArchivosService.obtenerUltimoDataset();
        if (session == null || baseDataset == null) {
            return;
        }

        LocalDate fechaInicio = session.getFechaInicio() != null
                ? session.getFechaInicio().toLocalDate()
                : LocalDate.now();
        int diasVentana = Math.max(session.getDuracionDias() + 2, 1);
        LocalDateTime simulationTime = currentState.getSimulationTime() != null
                ? currentState.getSimulationTime()
                : session.getFechaActualSimulacion();

        Dataset effectiveDataset = datasetContextService.construirDatasetEfectivo(
                AlmacenContexto.SIMULACION,
                baseDataset,
                fechaInicio,
                diasVentana
        );

        List<AeropuertoDTO> refreshedAeropuertos = construirAeropuertosContextuales(
                effectiveDataset,
                currentState.getAeropuertos()
        );
        List<VueloDTO> refreshedVuelos = construirVuelosContextuales(
                effectiveDataset,
                currentState.getVuelos(),
                simulationTime
        );

        SimulationState refreshedState = SimulationState.builder()
                .sessionId(currentState.getSessionId())
                .status(currentState.getStatus())
                .startedAt(currentState.getStartedAt())
                .simulationTime(currentState.getSimulationTime())
                .vuelos(refreshedVuelos)
                .aeropuertos(refreshedAeropuertos)
                .maletasEntregadas(currentState.getMaletasEntregadas())
                .maletasEnTransito(currentState.getMaletasEnTransito())
                .vuelosCulminados(currentState.getVuelosCulminados())
                .vuelosEnTransito(currentState.getVuelosEnTransito())
                .vuelosCancelados(currentState.getVuelosCancelados())
                .progreso(currentState.getProgreso())
                .colapsada(currentState.isColapsada())
                .motivoColapso(currentState.getMotivoColapso())
                .elapsedRealtimeSeconds(currentState.getElapsedRealtimeSeconds())
                .logs(currentState.getLogs())
                .envios(currentState.getEnvios())
                .maletas(currentState.getMaletas())
                .build();

        simulationCache.put(sessionId, refreshedState);
        if ("EJECUTANDO".equals(refreshedState.getStatus()) || "COMPLETADA".equals(refreshedState.getStatus())) {
            simulationCache.putStable(sessionId, refreshedState);
        }
    }

    private List<AeropuertoDTO> construirAeropuertosContextuales(
            Dataset dataset,
            List<AeropuertoDTO> currentAeropuertos
    ) {
        if (dataset == null) {
            return currentAeropuertos != null ? currentAeropuertos : List.of();
        }

        Map<String, AeropuertoDTO> currentMap = new LinkedHashMap<>();
        if (currentAeropuertos != null) {
            currentAeropuertos.forEach(aeropuerto -> currentMap.put(aeropuerto.getCodigoOACI(), aeropuerto));
        }

        Set<String> vuelosCancelados = cargaArchivosService.obtenerVuelosCancelados(AlmacenContexto.SIMULACION);
        Map<String, List<String>> entrantesMap = new LinkedHashMap<>();
        Map<String, List<String>> salientesMap = new LinkedHashMap<>();
        Map<String, List<String>> canceladosMap = new LinkedHashMap<>();

        for (Vuelo vuelo : dataset.getVuelos()) {
            String origen = vuelo.getOrigen().getCodigoOACI();
            String destino = vuelo.getDestino().getCodigoOACI();
            entrantesMap.computeIfAbsent(destino, key -> new ArrayList<>()).add(vuelo.getId());
            salientesMap.computeIfAbsent(origen, key -> new ArrayList<>()).add(vuelo.getId());
            if (vuelosCancelados.contains(vuelo.getId())) {
                canceladosMap.computeIfAbsent(origen, key -> new ArrayList<>()).add(vuelo.getId());
            }
        }

        Map<String, Almacen> almacenMap = almacenService.getMapaAlmacenes(AlmacenContexto.SIMULACION);
        Set<String> codigos = new LinkedHashSet<>(dataset.getAeropuertos().keySet());
        codigos.addAll(almacenMap.keySet());
        codigos.addAll(currentMap.keySet());

        List<AeropuertoDTO> aeropuertos = new ArrayList<>();
        for (String codigo : codigos) {
            Almacen almacen = almacenMap.get(codigo);
            AeropuertoDTO current = currentMap.get(codigo);
            double[] coord = AeropuertoCoordenadas.get(codigo);
            double latitud = almacen != null ? almacen.getLatitud() : (current != null ? current.getLatitud() : coord[0]);
            double longitud = almacen != null ? almacen.getLongitud() : (current != null ? current.getLongitud() : coord[1]);
            aeropuertos.add(AeropuertoDTO.builder()
                    .codigoOACI(codigo)
                    .latitud(latitud)
                    .longitud(longitud)
                    .ciudad(almacen != null ? almacen.getCiudad() : (current != null ? current.getCiudad() : null))
                    .pais(almacen != null ? almacen.getPais() : (current != null ? current.getPais() : null))
                    .capacidadMaxima(almacen != null
                            ? almacen.getCapacidadMaxima()
                            : (current != null ? current.getCapacidadMaxima() : 0))
                    .ocupacionActual(current != null ? current.getOcupacionActual() : 0)
                    .vuelosEntrantes(entrantesMap.getOrDefault(codigo, List.of()))
                    .vuelosSalientes(salientesMap.getOrDefault(codigo, List.of()))
                    .vuelosCanceladosSalientes(canceladosMap.getOrDefault(codigo, List.of()))
                    .build());
        }
        return aeropuertos;
    }

    private List<VueloDTO> construirVuelosContextuales(
            Dataset dataset,
            List<VueloDTO> currentVuelos,
            LocalDateTime simulationTime
    ) {
        if (dataset == null) {
            return currentVuelos != null ? currentVuelos : List.of();
        }

        Map<String, VueloDTO> currentMap = new LinkedHashMap<>();
        if (currentVuelos != null) {
            currentVuelos.forEach(vuelo -> currentMap.put(vuelo.getId(), vuelo));
        }

        LocalDateTime referencia = simulationTime != null ? simulationTime : LocalDateTime.now();
        Set<String> vuelosCancelados = cargaArchivosService.obtenerVuelosCancelados(AlmacenContexto.SIMULACION);
        Map<String, Almacen> almacenMap = almacenService.getMapaAlmacenes(AlmacenContexto.SIMULACION);

        return dataset.getVuelos().stream()
                .map(vuelo -> {
                    VueloDTO current = currentMap.get(vuelo.getId());
                    double[] origenCoord = AeropuertoCoordenadas.get(vuelo.getOrigen().getCodigoOACI());
                    double[] destinoCoord = AeropuertoCoordenadas.get(vuelo.getDestino().getCodigoOACI());
                    Almacen almacenOrigen = almacenMap.get(vuelo.getOrigen().getCodigoOACI());
                    Almacen almacenDestino = almacenMap.get(vuelo.getDestino().getCodigoOACI());

                    String estado;
                    if (vuelosCancelados.contains(vuelo.getId())) {
                        estado = "CANCELADO";
                    } else if (vuelo.getLlegadaUtc() != null && referencia.isAfter(vuelo.getLlegadaUtc())) {
                        estado = "CULMINADO";
                    } else if (vuelo.getSalidaUtc() != null && referencia.isAfter(vuelo.getSalidaUtc())) {
                        estado = "ACTIVO";
                    } else {
                        estado = "PROGRAMADO";
                    }

                    return VueloDTO.builder()
                            .id(vuelo.getId())
                            .origen(vuelo.getOrigen().getCodigoOACI())
                            .destino(vuelo.getDestino().getCodigoOACI())
                            .latOrigen(almacenOrigen != null ? almacenOrigen.getLatitud() : origenCoord[0])
                            .lonOrigen(almacenOrigen != null ? almacenOrigen.getLongitud() : origenCoord[1])
                            .latDestino(almacenDestino != null ? almacenDestino.getLatitud() : destinoCoord[0])
                            .lonDestino(almacenDestino != null ? almacenDestino.getLongitud() : destinoCoord[1])
                            .salidaUtc(current != null ? current.getSalidaUtc() : vuelo.getSalidaUtc())
                            .llegadaUtc(current != null ? current.getLlegadaUtc() : vuelo.getLlegadaUtc())
                            .capacidad(vuelo.getCapacidadCarga())
                            .cargaActual(current != null ? current.getCargaActual() : 0)
                            .progresoVuelo(current != null ? current.getProgresoVuelo() : 0)
                            .estado(estado)
                            .programacionId(extraerProgramacionId(vuelo.getId()))
                            .editable(vuelo.getId() != null && vuelo.getId().startsWith("USR-"))
                            .recurrente(vuelo.getId() != null && vuelo.getId().startsWith("USR-"))
                            .build();
                })
                .collect(Collectors.toList());
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
}
