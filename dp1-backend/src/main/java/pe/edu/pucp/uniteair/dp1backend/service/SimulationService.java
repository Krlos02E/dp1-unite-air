package pe.edu.pucp.uniteair.dp1backend.service;

import org.springframework.stereotype.Service;
import pe.edu.pucp.uniteair.dp1backend.cache.SimulationCache;
import pe.edu.pucp.uniteair.dp1backend.dto.LogEntry;
import pe.edu.pucp.uniteair.dp1backend.dto.SimulationState;
import pe.edu.pucp.uniteair.dp1backend.dto.SimulacionConfigRequest;
import pe.edu.pucp.uniteair.dp1backend.engine.SimulationEngine;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.entity.SimulationSession;
import pe.edu.pucp.uniteair.dp1backend.repository.SimulationSessionRepository;
import tasf.config.Config_Simulacion;
import tasf.core.Dataset;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class SimulationService {

    private final SimulationSessionRepository sessionRepository;
    private final SimulationCache simulationCache;
    private final SimulationEngine simulationEngine;
    private final CargaArchivosService cargaArchivosService;
    private final DatasetContextService datasetContextService;

    public SimulationService(SimulationSessionRepository sessionRepository,
                             SimulationCache simulationCache,
                             SimulationEngine simulationEngine,
                             CargaArchivosService cargaArchivosService,
                             DatasetContextService datasetContextService) {
        this.sessionRepository = sessionRepository;
        this.simulationCache = simulationCache;
        this.simulationEngine = simulationEngine;
        this.cargaArchivosService = cargaArchivosService;
        this.datasetContextService = datasetContextService;
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

    public SimulationState detenerSimulacion(String sessionId) {
        simulationEngine.detenerSimulacion(sessionId);
        var session = sessionRepository.findById(sessionId).orElse(null);
        if (session != null) {
            session.setEstado("COMPLETADA");
            sessionRepository.save(session);
        }
        return simulationCache.get(sessionId);
    }

    public void pausarSimulacion(String sessionId) {
        simulationEngine.pausarSimulacion(sessionId);
    }

    public void reanudarSimulacion(String sessionId) {
        simulationEngine.reanudarSimulacion(sessionId);
    }
}
