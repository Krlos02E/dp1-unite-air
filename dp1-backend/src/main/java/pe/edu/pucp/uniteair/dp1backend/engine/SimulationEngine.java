package pe.edu.pucp.uniteair.dp1backend.engine;

import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import pe.edu.pucp.uniteair.dp1backend.cache.SimulationCache;
import pe.edu.pucp.uniteair.dp1backend.config.AeropuertoCoordenadas;
import pe.edu.pucp.uniteair.dp1backend.dto.*;
import pe.edu.pucp.uniteair.dp1backend.entity.Almacen;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.repository.SimulationSessionRepository;
import pe.edu.pucp.uniteair.dp1backend.service.AlmacenService;
import pe.edu.pucp.uniteair.dp1backend.service.CargaArchivosService;
import pe.edu.pucp.uniteair.dp1backend.service.ContextSyncStateService;
import pe.edu.pucp.uniteair.dp1backend.service.DatasetContextService;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationContextService;
import tasf.config.Config_Simulacion;
import tasf.core.AsignacionPaquete;
import tasf.core.Dataset;
import tasf.core.EstadoOperacional;
import tasf.core.PlanificacionUtils;
import tasf.core.RutaConCantidad;
import tasf.core.Solucion;
import tasf.model.Aeropuerto;
import tasf.model.Paquete;
import tasf.model.Vuelo;
import tasf.model.Ruta;
import pe.edu.pucp.uniteair.dp1backend.dto.EnvioSimulacionDTO;
import tasf.strategy.TwoPhaseOrchestrator;
import tasf.strategy.PlanificadorRutasStrategy;
import tasf.strategy.alns.ALNS_RutasPlanner;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class SimulationEngine {


    private static final int REPLAN_SIM_INTERVAL_HOURS = 1;
    private static final int SIMULATION_STEP_MINUTES = 5;
    private static final int ROLLING_LOOKAHEAD_MINUTES = 120;
    private static final int FLIGHT_WINDOW_LOOKBACK_HOURS = 24;
    private static final int FLIGHT_WINDOW_FORWARD_BUFFER_HOURS = 48;
    private static final int DESTINATION_PICKUP_MINUTES = 15;

    private final SimulationCache simulationCache;
    private final SimulationSessionRepository sessionRepository;
    private final CargaArchivosService cargaArchivosService;
    private final AlmacenService almacenService;
    private final DatasetContextService datasetContextService;
    private final ContextSyncStateService contextSyncStateService;
    private final SimulationContextService simulationContextService;
    private final ObjectMapper objectMapper;
    private final Map<String, CompletableFuture<Void>> activeSimulations = new ConcurrentHashMap<>();
    private final Map<String, Boolean> cancellationFlags = new ConcurrentHashMap<>();
    private final Map<String, Boolean> pauseFlags = new ConcurrentHashMap<>();

    // Precalculated caches per session to avoid O(n*m) in every update
    private final Map<String, List<AeropuertoDTO>> airportBaseCache = new ConcurrentHashMap<>();
    private final Map<String, Map<String, double[]>> flightCoordCache = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Long>> flightDurationCache = new ConcurrentHashMap<>();
    private final Map<String, Dataset> sessionDatasetCache = new ConcurrentHashMap<>();
    private final Map<String, Long> sessionContextVersionCache = new ConcurrentHashMap<>();

    private record ReplanificacionResultado(
            Map<String, Ruta> rutas,
            Map<String, AsignacionPaquete> splits,
            int pendientes,
            int rutasNuevas,
            int rutasComprometidas,
            int asignadosTrasReplan,
            int nuevasAsignaciones,
            int rutasReasignadas,
            int rutasMantenidas,
            int sinRuta,
            double duracionSeg,
            LocalDateTime simTime
    ) {}

    private record PlanificacionSnapshot(
            LocalDateTime simTime,
            int sinRuta,
            double duracionSeg
    ) {}

    public SimulationEngine(SimulationCache simulationCache,
                            SimulationSessionRepository sessionRepository,
                            CargaArchivosService cargaArchivosService,
                            AlmacenService almacenService,
                            DatasetContextService datasetContextService,
                            ContextSyncStateService contextSyncStateService,
                            SimulationContextService simulationContextService,
                            ObjectMapper objectMapper) {
        this.simulationCache = simulationCache;
        this.sessionRepository = sessionRepository;
        this.cargaArchivosService = cargaArchivosService;
        this.almacenService = almacenService;
        this.datasetContextService = datasetContextService;
        this.contextSyncStateService = contextSyncStateService;
        this.simulationContextService = simulationContextService;
        this.objectMapper = objectMapper;
    }

    public void pausarSimulacion(String sessionId) {
        pauseFlags.put(sessionId, true);
    }

    private void persistStateSnapshot(String sessionId, SimulationState state) {
        if (sessionId == null || state == null) {
            return;
        }
        sessionRepository.findById(sessionId).ifPresent(session -> {
            try {
                session.setDatasetJson(objectMapper.writeValueAsString(state));
                sessionRepository.save(session);
            } catch (Exception ignored) {
                // Avoid breaking the simulation loop if persistence fails.
            }
        });
    }

    public void reanudarSimulacion(String sessionId) {
        pauseFlags.remove(sessionId);
    }

    public boolean isSimulacionActiva(String sessionId) {
        CompletableFuture<Void> future = activeSimulations.get(sessionId);
        return future != null && !future.isDone() && !future.isCancelled();
    }

    public boolean isPausada(String sessionId) {
        return pauseFlags.getOrDefault(sessionId, false);
    }

    private void esperarSiPausada(String sessionId) throws InterruptedException {
        while (pauseFlags.getOrDefault(sessionId, false)) {
            Thread.sleep(200);
        }
    }

    @Async("taskExecutor")
    public CompletableFuture<Void> ejecutarSimulacion(String sessionId, Dataset dataset,
                                                       Config_Simulacion config, String algoritmo,
                                                       int duracionDias, LocalDateTime fechaInicio, double velocidad) {
        CompletableFuture<Void> future = new CompletableFuture<>();
        activeSimulations.put(sessionId, future);
        CompletableFuture.runAsync(() -> {
            try {
                int duracionHoras = duracionDias * 24;
                int duracionMinutos = duracionHoras * 60;
                int totalSteps = duracionMinutos / SIMULATION_STEP_MINUTES;
                EstadoOperacional estado = new EstadoOperacional();
                Map<String, Integer> cargaVuelo = new ConcurrentHashMap<>();
                Map<String, Integer> ocupacionAeropuerto = new ConcurrentHashMap<>();
                List<LogEntry> logs = new ArrayList<>();
                int maletasEntregadas = 0;
                int maletasEnTransito = 0;

        PlanificadorRutasStrategy planner = new ALNS_RutasPlanner();
                TwoPhaseOrchestrator orchestrator = new TwoPhaseOrchestrator(planner);

                PlanificacionUtils.limpiarCacheGlobal();

                // Precalculate airport and flight coordinate caches once per session
                precalcularCaches(sessionId, dataset);
                sessionDatasetCache.put(sessionId, dataset);
                sessionContextVersionCache.put(sessionId, obtenerVersionContextoSimulacion());

                // Variables compartidas entre hilos
                final int[] stepRef = {0};
                final LocalDateTime[] simTimeRef = {fechaInicio};
                final Solucion[] solucionRef = {null};
                final double[] duracionPlanificacionInicialRef = {0.0};
                final Map<String, Ruta> rutasAnteriores = new ConcurrentHashMap<>();
                final Map<String, AsignacionPaquete> asignacionesSplit = new ConcurrentHashMap<>();

                // Inicializar visualización inmediatamente con datos del dataset
                logs.add(LogEntry.builder()
                        .timestamp(fechaInicio)
                        .tipo("INFO")
                        .mensaje("Planificando rutas...")
                        .build());
                System.out.println("[SimulationEngine] sessionId=" + sessionId
                        + " fechaInicio=" + fechaInicio
                        + " duracionDias=" + duracionDias
                        + " dataset.paquetes=" + dataset.getPaquetes().size()
                        + " dataset.vuelos=" + dataset.getVuelos().size()
                        + " ventanaPlanificacionMin=" + ROLLING_LOOKAHEAD_MINUTES
                        + " stepMin=" + SIMULATION_STEP_MINUTES);
                actualizarEstadoEnCache(sessionId, fechaInicio, dataset, cargaVuelo, ocupacionAeropuerto,
                        0, 0, 0, duracionMinutos, false, null, logs, "PLANIFICANDO", fechaInicio, null, rutasAnteriores, asignacionesSplit, null);

                // Hilo de planificación
                Thread planificadorThread = new Thread(() -> {
                    System.out.println("[2/4] Algoritmo: " + algoritmo);
                    System.out.println("[3/4] Algoritmo ejecutando...");
                    long tPlanStart = System.nanoTime();
                    Dataset datasetActual = obtenerDatasetSesionActualizado(sessionId, dataset);
                    List<Paquete> paquetesIniciales = filtrarPaquetesPendientesEnVentana(
                            datasetActual,
                            config,
                            Collections.emptyMap(),
                            Collections.emptySet(),
                            fechaInicio,
                            fechaInicio,
                            ROLLING_LOOKAHEAD_MINUTES
                    );
                    LocalDateTime finVentanaInicial = fechaInicio.plusMinutes(ROLLING_LOOKAHEAD_MINUTES);
                    Dataset datasetInicial = construirDatasetPlanificacion(sessionId, datasetActual, paquetesIniciales, fechaInicio);
                    System.out.println("[VENTANA] Inicio=" + fechaInicio
                            + " fin=" + finVentanaInicial
                            + " paquetesEnVentana=" + paquetesIniciales.size()
                            + " de datasetCompleto=" + datasetActual.getPaquetes().size()
                            + " vuelosPlanificacion=" + datasetInicial.getVuelos().size()
                            + " ventanaVuelos=[" + fechaInicio.minusHours(FLIGHT_WINDOW_LOOKBACK_HOURS)
                            + ", " + finVentanaInicial.plusHours(FLIGHT_WINDOW_FORWARD_BUFFER_HOURS) + "]");
                    datasetActual.getPaquetes().stream().limit(5).forEach(paquete ->
                            System.out.println("[SimulationEngine] paquete dataset id=" + paquete.getId()
                                    + " creacion=" + PlanificacionUtils.getCreacionUtc(paquete, datasetActual, config)));
                    Solucion sol = paquetesIniciales.isEmpty()
                            ? new Solucion("VentanaRodante-" + algoritmo)
                            : orchestrator.ejecutarFlujoCompleto(datasetInicial, config);
                    long tPlanEnd = System.nanoTime();
                    long duracionMs = (tPlanEnd - tPlanStart) / 1_000_000;
                    double duracionSeg = duracionMs / 1000.0;
                    duracionPlanificacionInicialRef[0] = duracionSeg;
                    System.out.printf("[4/4] Planificación completada [%dms | %.3fs]%n", duracionMs, duracionSeg);
                    System.out.printf("[VENTANA] Paquetes iniciales planificados: %d%n", paquetesIniciales.size());
                    solucionRef[0] = sol;
                });
                planificadorThread.setDaemon(true);
                planificadorThread.start();

                // Esperar a que termine la planificación
                planificadorThread.join();

                Solucion solucion = solucionRef[0];
                if (solucion == null) {
                    throw new IllegalStateException("La planificación no produjo una solución");
                }

                Map<String, Ruta> rutas = new HashMap<>(solucion.getRutasAsignadas());
                Dataset datasetActual = obtenerDatasetSesionActualizado(sessionId, dataset);
                asignacionesSplit.clear();
                Set<String> noAsignados = calcularNoAsignadosEnVentana(
                        datasetActual,
                        config,
                        rutas,
                        fechaInicio,
                        Collections.emptySet(),
                        fechaInicio,
                        ROLLING_LOOKAHEAD_MINUTES
                );
                boolean hayColapso = false;
                PlanificacionSnapshot ultimaPlanificacion = new PlanificacionSnapshot(
                        fechaInicio,
                        noAsignados.size(),
                        duracionPlanificacionInicialRef[0]
                );
                MaletasResumen resumenInicial = calcularResumenMaletas(datasetActual, rutas, fechaInicio, fechaInicio);
                maletasEntregadas = resumenInicial.entregadas();
                maletasEnTransito = resumenInicial.enTransito();

                // Construir EstadoOperacional de referencia con las rutas asignadas
                // Esto es la fuente de verdad para carga de vuelos y ocupacion de aeropuertos
                EstadoOperacional estadoRef = PlanificacionUtils.construirEstadoConAsignaciones(rutas, datasetActual, config);

                // Poblar cargaVuelo desde el estado operacional (fuente de verdad)
                cargaVuelo.clear();
                for (Vuelo v : datasetActual.getVuelos()) {
                    int carga = estadoRef.getCargaVuelo(v.getId());
                    if (carga > 0) {
                        cargaVuelo.put(v.getId(), carga);
                    }
                }
                System.out.println("[DIAG] cargaVuelo size=" + cargaVuelo.size());
                cargaVuelo.entrySet().stream().limit(5).forEach(e ->
                    System.out.println("[DIAG]   " + e.getKey() + " -> " + e.getValue())
                );

                System.out.println("=== Ejecucion Completada ===");
                System.out.printf("Paquetes totales: %d, rutas asignadas: %d%n",
                        datasetActual.getPaquetes().size(), rutas.size());
                System.out.println("Asignados: " + rutas.size() + " | Sin asignar: " + noAsignados.size());
                System.out.println("Colapso: " + (hayColapso ? "SI" : "NO"));
                System.out.println("Costo total: " + (long) solucion.getCostoTotal());
                System.out.printf("[METRICAS] Fase1 rutas=%.0fms | Fase2 asignacion=%.0fms | Fase3 evaluacion=%.0fms%n",
                        solucion.getMetricas().getOrDefault("msFase1Rutas", -1.0),
                        solucion.getMetricas().getOrDefault("msFase2Asignacion", -1.0),
                        solucion.getMetricas().getOrDefault("msFase3Evaluacion", -1.0));
                System.out.printf("[METRICAS] ALNS reheats=%.0f | paquetesConSplit=%.0f | noAsignados=%.0f | colapsos=%.0f%n",
                        solucion.getMetricas().getOrDefault("reheats", -1.0),
                        solucion.getMetricas().getOrDefault("paquetesConSplit", -1.0),
                        solucion.getMetricas().getOrDefault("paquetesNoAsignados", -1.0),
                        solucion.getMetricas().getOrDefault("eventosColapso", -1.0));

                logs.add(LogEntry.builder()
                        .timestamp(fechaInicio)
                        .tipo("INFO")
                        .mensaje(String.format("Planificación completada: %d rutas asignadas, %d no asignados",
                                rutas.size(), noAsignados.size()))
                        .build());

                if (!noAsignados.isEmpty()) {
                    String motivo = "Ventana inicial con " + noAsignados.size() + " paquetes sin ruta; continuaran en espera para la replanificacion";
                    logs.add(LogEntry.builder()
                            .timestamp(fechaInicio)
                            .tipo("WARN")
                            .mensaje(motivo)
                            .build());
                }

                logs.add(LogEntry.builder()
                        .timestamp(simTimeRef[0])
                        .tipo("INFO")
                        .mensaje(String.format("Continuando simulación desde paso %d/%d", stepRef[0], totalSteps))
                        .build());

                // Calcular entregas retroactivas hasta el punto donde quedó la visualización
                Set<String> rutasEntregadas = new HashSet<>();
                LocalDateTime simTimeActual = simTimeRef[0];
                int stepActual = stepRef[0];
                final CompletableFuture<ReplanificacionResultado>[] replanFutureRef = new CompletableFuture[]{null};

                MaletasResumen resumenInicio = calcularResumenMaletas(datasetActual, rutas, simTimeActual, fechaInicio);
                maletasEntregadas = resumenInicio.entregadas();
                maletasEnTransito = resumenInicio.enTransito();
                for (Map.Entry<String, Ruta> entry : rutas.entrySet()) {
                    Ruta ruta = entry.getValue();
                    if (ruta == null || ruta.getVuelos().isEmpty()) continue;
                    Vuelo ultimo = ruta.getVuelos().get(ruta.getVuelos().size() - 1);
                    if (simTimeActual.isAfter(ultimo.getLlegadaUtc().plusMinutes(DESTINATION_PICKUP_MINUTES))) {
                        rutasEntregadas.add(entry.getKey());
                    }
                }

                // Continuar simulación desde el paso actual
                for (int step = stepActual; step <= totalSteps; step++) {
                    if (cancellationFlags.getOrDefault(sessionId, false)) break;
                    esperarSiPausada(sessionId);

                    LocalDateTime simTime = fechaInicio.plusMinutes((long) step * SIMULATION_STEP_MINUTES);
                    datasetActual = obtenerDatasetSesionActualizado(sessionId, dataset);

                    CompletableFuture<ReplanificacionResultado> replanFuture = replanFutureRef[0];
                    if (replanFuture != null && replanFuture.isDone()) {
                        try {
                            ReplanificacionResultado resultado = replanFuture.join();
                            Map<String, Ruta> rutasPrevias = new HashMap<>(rutas);
                            rutas = new HashMap<>(resultado.rutas());
                            registrarRutasAnteriores(rutasPrevias, rutas, rutasAnteriores);
                            asignacionesSplit.clear();
                            asignacionesSplit.putAll(resultado.splits());

                            estadoRef = PlanificacionUtils.construirEstadoConAsignaciones(rutas, datasetActual, config);
                            cargaVuelo.clear();
                            for (Vuelo v : datasetActual.getVuelos()) {
                                int carga = estadoRef.getCargaVuelo(v.getId());
                                if (carga > 0) cargaVuelo.put(v.getId(), carga);
                            }

                            logs.add(LogEntry.builder()
                                    .timestamp(resultado.simTime())
                                    .tipo("REPLAN")
                                    .mensaje(String.format(
                                            "Planificacion ventana +%dmin: %d pendientes -> %d asignados, %d nuevas asignaciones, %d reasignadas, %d mantenidas, %d sin ruta; %d rutas nuevas; %d rutas comprometidas; algoritmo %.3fs",
                                            ROLLING_LOOKAHEAD_MINUTES,
                                            resultado.pendientes(),
                                            resultado.asignadosTrasReplan(),
                                            resultado.nuevasAsignaciones(),
                                            resultado.rutasReasignadas(),
                                            resultado.rutasMantenidas(),
                                            resultado.sinRuta(),
                                            resultado.rutasNuevas(),
                                            resultado.rutasComprometidas(),
                                            resultado.duracionSeg()
                                    ))
                                    .build());
                            ultimaPlanificacion = new PlanificacionSnapshot(
                                    resultado.simTime(),
                                    resultado.sinRuta(),
                                    resultado.duracionSeg()
                            );
                        } catch (Exception e) {
                            System.err.println("[Simulacion] Error aplicando re-planificacion t=" + simTime
                                    + ": " + e.getMessage());
                        } finally {
                            replanFutureRef[0] = null;
                        }
                    }

                    for (Map.Entry<String, Ruta> entry : rutas.entrySet()) {
                        String rutaId = entry.getKey();
                        if (rutasEntregadas.contains(rutaId)) continue;
                        Paquete paquete = dataset.getPaquetePorId(rutaId);
                        int cantidad = paquete != null ? paquete.getCantidad() : 1;
                        Ruta ruta = entry.getValue();
                        if (!ruta.getVuelos().isEmpty()) {
                            Vuelo ultimo = ruta.getVuelos().get(ruta.getVuelos().size() - 1);
                            LocalDateTime tiempoEntrega = ultimo.getLlegadaUtc().plusMinutes(DESTINATION_PICKUP_MINUTES);
                            if (simTime.isAfter(tiempoEntrega)) {
                                maletasEntregadas += cantidad;
                                maletasEnTransito -= cantidad;
                                rutasEntregadas.add(rutaId);
                            }
                        }
                    }

                    MaletasResumen resumenHora = calcularResumenMaletas(dataset, rutas, simTime, fechaInicio);
                    maletasEntregadas = resumenHora.entregadas();
                    maletasEnTransito = resumenHora.enTransito();

                    // Re-planificacion cada hora simulada con ventana rodante de 3 horas simuladas.
                    if (step > stepActual
                            && step % ((REPLAN_SIM_INTERVAL_HOURS * 60) / SIMULATION_STEP_MINUTES) == 0
                            && replanFutureRef[0] == null
                            && !cancellationFlags.getOrDefault(sessionId, false)) {
                        final Map<String, Ruta> rutasSnapshot = new HashMap<>(rutas);
                        final Set<String> rutasEntregadasSnapshot = new HashSet<>(rutasEntregadas);
                        final Map<String, AsignacionPaquete> splitsSnapshot = new HashMap<>(asignacionesSplit);
                        final LocalDateTime simTimeReplan = simTime;
                        final Dataset datasetReplan = datasetActual;
                        System.out.println("[Simulacion] Re-plan async iniciado t=" + simTimeReplan
                                + " ventana=+" + ROLLING_LOOKAHEAD_MINUTES + "min");
                        replanFutureRef[0] = CompletableFuture.supplyAsync(() ->
                                replanificarVentanaRodante(
                                        sessionId,
                                        orchestrator,
                                        datasetReplan,
                                        config,
                                        rutasSnapshot,
                                        rutasEntregadasSnapshot,
                                        splitsSnapshot,
                                        simTimeReplan,
                                        fechaInicio
                                )
                        );
                    }


                    for (Aeropuerto a : datasetActual.getAeropuertos().values()) {
                        int ocup = estadoRef.getOcupacionHora(a.getCodigoOACI(), simTime);
                        ocupacionAeropuerto.put(a.getCodigoOACI(), ocup);
                    }

                    if (step > 0 && step % ((12 * 60) / SIMULATION_STEP_MINUTES) == 0) {
                        int horaSimulada = step / (60 / SIMULATION_STEP_MINUTES);
                        logs.add(LogEntry.builder()
                                .timestamp(simTime)
                                .tipo("INFO")
                                .mensaje(String.format("Hora %d: %d maletas entregadas, %d en tránsito",
                                        horaSimulada, maletasEntregadas, maletasEnTransito))
                                .build());
                    }

                    actualizarEstadoEnCache(sessionId, simTime, datasetActual, cargaVuelo, ocupacionAeropuerto,
                            maletasEntregadas, maletasEnTransito, step * SIMULATION_STEP_MINUTES, duracionMinutos, false, null, logs, "EJECUTANDO", fechaInicio, rutas, rutasAnteriores, asignacionesSplit, ultimaPlanificacion);

                    long sleepMs = (long) ((15000.0 * SIMULATION_STEP_MINUTES / 60.0) / Math.max(0.5, velocidad));
                    if (sleepMs > 0) {
                        Thread.sleep(sleepMs);
                    }
                }

                if (!cancellationFlags.getOrDefault(sessionId, false)) {
                    var session = sessionRepository.findById(sessionId).orElse(null);
                    if (session != null) {
                        session.setEstado("COMPLETADA");
                        session.setProgresoPorcentaje(100);
                        sessionRepository.save(session);
                    }
                    SimulationState finalState = simulationCache.getStable(sessionId);
                    if (finalState == null) {
                        finalState = simulationCache.get(sessionId);
                    }
                    if (finalState != null) {
                        SimulationState completed = SimulationState.builder()
                                .sessionId(sessionId)
                                .status("COMPLETADA")
                                .startedAt(finalState.getStartedAt())
                                .simulationTime(finalState.getSimulationTime())
                                .fechaInicio(finalState.getFechaInicio())
                                .ultimaPlanificacionSimulada(finalState.getUltimaPlanificacionSimulada())
                                .horizontePlanificacionMinutos(finalState.getHorizontePlanificacionMinutos())
                                .duracionUltimaPlanificacionSeg(finalState.getDuracionUltimaPlanificacionSeg())
                                .ultimaPlanificacionSinRuta(finalState.getUltimaPlanificacionSinRuta())
                                .planificacionEstable(finalState.getPlanificacionEstable())
                                .vuelos(finalState.getVuelos())
                                .aeropuertos(finalState.getAeropuertos())
                                .maletasEntregadas(finalState.getMaletasEntregadas())
                                .maletasEnTransito(finalState.getMaletasEnTransito())
                                .vuelosCulminados(finalState.getVuelosCulminados())
                                .vuelosEnTransito(finalState.getVuelosEnTransito())
                                .vuelosCancelados(finalState.getVuelosCancelados())
                                .progreso(100)
                                .colapsada(false)
                                .motivoColapso(finalState.getMotivoColapso())
                                .elapsedRealtimeSeconds(calcularElapsedRealtimeSeconds(finalState.getStartedAt()))
                                .logs(finalState.getLogs())
                                .envios(finalState.getEnvios())
                                .maletas(finalState.getMaletas())
                                .build();
                        simulationCache.put(sessionId, completed);
                        simulationCache.putStable(sessionId, completed);
                        persistStateSnapshot(sessionId, completed);
                    }
                    simulationContextService.reiniciarContextoSimulacion();
                }
                future.complete(null);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                future.completeExceptionally(e);
            } catch (Exception e) {
                System.err.println("[ERROR] Simulación " + sessionId + " falló: " + e.getMessage());
                e.printStackTrace();
                future.completeExceptionally(e);
                try {
                    var session = sessionRepository.findById(sessionId).orElse(null);
                    if (session != null) {
                        session.setEstado("ERROR");
                        session.setMotivoColapso("Error interno: " + e.getMessage());
                        sessionRepository.save(session);
                    }
                } catch (Exception ignored) {}
            } finally {
                activeSimulations.remove(sessionId);
                cancellationFlags.remove(sessionId);
                pauseFlags.remove(sessionId);
                airportBaseCache.remove(sessionId);
                flightCoordCache.remove(sessionId);
                flightDurationCache.remove(sessionId);
                sessionDatasetCache.remove(sessionId);
                sessionContextVersionCache.remove(sessionId);
            }
        });

        return future;
    }

    private ReplanificacionResultado replanificarVentanaRodante(
            String sessionId,
            TwoPhaseOrchestrator orchestrator,
            Dataset dataset,
            Config_Simulacion config,
            Map<String, Ruta> rutasActuales,
            Set<String> rutasEntregadas,
            Map<String, AsignacionPaquete> asignacionesSplitActuales,
            LocalDateTime simTime,
            LocalDateTime fechaInicio
    ) {
        LocalDateTime limitePlanificacion = simTime.plusMinutes(ROLLING_LOOKAHEAD_MINUTES);
        Map<String, Ruta> rutasComprometidas = new HashMap<>();
        List<Paquete> pendientes = new ArrayList<>();

        for (Paquete paquete : dataset.getPaquetes()) {
            if (paqueteFueCreadoAntesDelInicio(paquete, fechaInicio)) {
                continue;
            }
            String paqueteId = paquete.getId();
            if (rutasEntregadas.contains(paqueteId)) {
                continue;
            }

            Ruta rutaActual = rutasActuales.get(paqueteId);
            if (rutaActual != null && !rutaActual.getVuelos().isEmpty()) {
                Vuelo primerVuelo = rutaActual.getVuelos().get(0);
                if (!primerVuelo.getSalidaUtc().isAfter(simTime)) {
                    rutasComprometidas.put(paqueteId, rutaActual);
                    continue;
                }
            }

            LocalDateTime creacionUtc = PlanificacionUtils.getCreacionUtc(paquete, dataset, config);
            if (!creacionUtc.isAfter(limitePlanificacion)) {
                pendientes.add(paquete);
            }
        }

        if (pendientes.isEmpty()) {
            Map<String, AsignacionPaquete> splitsComprometidos = new HashMap<>();
            for (Map.Entry<String, AsignacionPaquete> entry : asignacionesSplitActuales.entrySet()) {
                if (rutasComprometidas.containsKey(entry.getKey())) {
                    splitsComprometidos.put(entry.getKey(), entry.getValue());
                }
            }
            return new ReplanificacionResultado(
                    rutasComprometidas,
                    splitsComprometidos,
                    0,
                    0,
                    rutasComprometidas.size(),
                    0,
                    0,
                    0,
                    0,
                    0,
                    0.0,
                    simTime
            );
        }

        PlanificacionUtils.limpiarCacheGlobal();
        Dataset datasetPendientes = construirDatasetPlanificacion(sessionId, dataset, pendientes, simTime);
        long tPlanStart = System.nanoTime();
        Solucion solParcial = orchestrator.ejecutarFlujoCompleto(datasetPendientes, config);
        long duracionMs = (System.nanoTime() - tPlanStart) / 1_000_000;
        double duracionSeg = duracionMs / 1000.0;
        Map<String, Ruta> rutasMerge = new HashMap<>(rutasComprometidas);
        rutasMerge.putAll(solParcial.getRutasAsignadas());
        Map<String, AsignacionPaquete> splitsMerge = new HashMap<>();
        for (Map.Entry<String, AsignacionPaquete> entry : asignacionesSplitActuales.entrySet()) {
            if (rutasComprometidas.containsKey(entry.getKey())) {
                splitsMerge.put(entry.getKey(), entry.getValue());
            }
        }

        int asignadosTrasReplan = 0;
        int nuevasAsignaciones = 0;
        int rutasReasignadas = 0;
        int rutasMantenidas = 0;
        int sinRuta = 0;
        for (Paquete paquete : pendientes) {
            String paqueteId = paquete.getId();
            Ruta rutaAntes = rutasActuales.get(paqueteId);
            Ruta rutaDespues = solParcial.getRutasAsignadas().get(paqueteId);

            if (rutaDespues == null) {
                sinRuta++;
                continue;
            }

            asignadosTrasReplan++;
            if (rutaAntes == null) {
                nuevasAsignaciones++;
                continue;
            }

            if (mismaRuta(rutaAntes, rutaDespues)) {
                rutasMantenidas++;
            } else {
                rutasReasignadas++;
            }
        }

        System.out.println("[Simulacion] Re-plan real-time t=" + simTime
                + " pendientes=" + pendientes.size()
                + " nuevas=" + solParcial.getRutasAsignadas().size()
                + " comprometidas=" + rutasComprometidas.size()
                + " asignados=" + asignadosTrasReplan
                + " nuevasAsignaciones=" + nuevasAsignaciones
                + " reasignadas=" + rutasReasignadas
                + " mantenidas=" + rutasMantenidas
                + " sinRuta=" + sinRuta
                + " algoritmo=" + String.format(Locale.ROOT, "%.3fs", duracionSeg));

        return new ReplanificacionResultado(
                rutasMerge,
                splitsMerge,
                pendientes.size(),
                solParcial.getRutasAsignadas().size(),
                rutasComprometidas.size(),
                asignadosTrasReplan,
                nuevasAsignaciones,
                rutasReasignadas,
                rutasMantenidas,
                sinRuta,
                duracionSeg,
                simTime
        );
    }

    private boolean mismaRuta(Ruta actual, Ruta nueva) {
        if (actual == null || nueva == null) {
            return actual == nueva;
        }
        return actual.getVuelos().stream().map(Vuelo::getId).collect(Collectors.joining("|"))
                .equals(nueva.getVuelos().stream().map(Vuelo::getId).collect(Collectors.joining("|")));
    }

    private Dataset construirDatasetPlanificacion(
            String sessionId,
            Dataset datasetBase,
            List<Paquete> paquetesPlanificacion,
            LocalDateTime simTime
    ) {
        LocalDateTime inicioVuelos = simTime.minusHours(FLIGHT_WINDOW_LOOKBACK_HOURS);
        LocalDateTime finVuelos = simTime
                .plusMinutes(ROLLING_LOOKAHEAD_MINUTES)
                .plusHours(FLIGHT_WINDOW_FORWARD_BUFFER_HOURS);
        Set<String> vuelosCancelados = cargaArchivosService.obtenerVuelosCancelados(AlmacenContexto.SIMULACION);

        List<Vuelo> vuelosFiltrados = datasetBase.getVuelos().stream()
                .filter(vuelo -> !vuelosCancelados.contains(vuelo.getId()))
                .filter(vuelo -> !vuelo.getSalidaUtc().isBefore(inicioVuelos)
                        && !vuelo.getSalidaUtc().isAfter(finVuelos))
                .toList();

        Map<String, Aeropuerto> aeropuertosFiltrados = new HashMap<>();
        for (Paquete paquete : paquetesPlanificacion) {
            Aeropuerto origen = datasetBase.getAeropuerto(paquete.getOrigenOACI());
            Aeropuerto destino = datasetBase.getAeropuerto(paquete.getDestinoOACI());
            if (origen != null) {
                aeropuertosFiltrados.put(origen.getCodigoOACI(), origen);
            }
            if (destino != null) {
                aeropuertosFiltrados.put(destino.getCodigoOACI(), destino);
            }
        }
        for (Vuelo vuelo : vuelosFiltrados) {
            aeropuertosFiltrados.put(vuelo.getOrigen().getCodigoOACI(), vuelo.getOrigen());
            aeropuertosFiltrados.put(vuelo.getDestino().getCodigoOACI(), vuelo.getDestino());
        }

        return new Dataset(aeropuertosFiltrados, vuelosFiltrados, paquetesPlanificacion);
    }

    private void registrarRutasAnteriores(
            Map<String, Ruta> rutasActuales,
            Map<String, Ruta> rutasNuevas,
            Map<String, Ruta> rutasAnteriores
    ) {
        for (Map.Entry<String, Ruta> entry : rutasNuevas.entrySet()) {
            Ruta actual = rutasActuales.get(entry.getKey());
            Ruta nueva = entry.getValue();
            if (actual == null) {
                continue;
            }
            String firmaActual = actual.getVuelos().stream()
                    .map(Vuelo::getId)
                    .collect(Collectors.joining("|"));
            String firmaNueva = nueva.getVuelos().stream()
                    .map(Vuelo::getId)
                    .collect(Collectors.joining("|"));
            if (!Objects.equals(firmaActual, firmaNueva)) {
                rutasAnteriores.put(entry.getKey(), actual);
            }
        }
    }

    private List<String> construirRutaVuelos(Ruta ruta) {
        if (ruta == null || ruta.getVuelos().isEmpty()) {
            return new ArrayList<>();
        }
        return ruta.getVuelos().stream()
                .map(Vuelo::getId)
                .collect(Collectors.toCollection(ArrayList::new));
    }

    private List<String> construirRutaAeropuertos(Paquete paquete, Ruta ruta) {
        LinkedHashSet<String> rutaAeropuertos = new LinkedHashSet<>();
        rutaAeropuertos.add(paquete.getOrigenOACI());
        if (ruta != null) {
            for (Vuelo vuelo : ruta.getVuelos()) {
                rutaAeropuertos.add(vuelo.getOrigen().getCodigoOACI());
                rutaAeropuertos.add(vuelo.getDestino().getCodigoOACI());
            }
        }
        rutaAeropuertos.add(paquete.getDestinoOACI());
        return new ArrayList<>(rutaAeropuertos);
    }

    private List<MaletaSimulacionDTO> construirMaletasPaquete(
            Paquete paquete,
            LocalDateTime simTime,
            Map<String, Ruta> rutasAnteriores,
            Map<String, AsignacionPaquete> asignacionesSplit,
            Map<String, Ruta> rutasAsignadas
    ) {
        List<MaletaSimulacionDTO> maletas = new ArrayList<>();
        AsignacionPaquete asignacion = asignacionesSplit != null ? asignacionesSplit.get(paquete.getId()) : null;
        Ruta rutaAnterior = rutasAnteriores != null ? rutasAnteriores.get(paquete.getId()) : null;
        Ruta rutaAsignada = rutasAsignadas != null ? rutasAsignadas.get(paquete.getId()) : null;
        int indiceGlobal = 1;

        if (asignacion != null && !asignacion.isEmpty()) {
            int subrutaIndex = 1;
            for (RutaConCantidad rc : asignacion.getRutas()) {
                for (int i = 0; i < rc.getCantidad(); i++) {
                    maletas.add(construirMaleta(paquete, indiceGlobal++, subrutaIndex, rc.getRuta(), rutaAnterior, simTime));
                }
                subrutaIndex++;
            }
        }

        while (indiceGlobal <= paquete.getCantidad()) {
            maletas.add(construirMaleta(paquete, indiceGlobal++, 1, rutaAsignada, rutaAnterior, simTime));
        }

        return maletas;
    }

    private MaletaSimulacionDTO construirMaleta(
            Paquete paquete,
            int indice,
            int subrutaIndex,
            Ruta ruta,
            Ruta rutaAnterior,
            LocalDateTime simTime
    ) {
        String aeropuertoActual = paquete.getOrigenOACI();
        String vueloActual = null;
        String vueloEsperado = null;
        LocalDateTime ultimaLlegada = null;
        String estado = "EN_ESPERA";

        if (ruta != null && !ruta.getVuelos().isEmpty()) {
            List<Vuelo> vuelosRuta = ruta.getVuelos();
            ultimaLlegada = vuelosRuta.get(vuelosRuta.size() - 1).getLlegadaUtc();
            Vuelo vueloEnCurso = null;
            Vuelo proximoVuelo = null;
            for (Vuelo v : vuelosRuta) {
                if (!simTime.isBefore(v.getSalidaUtc()) && simTime.isBefore(v.getLlegadaUtc())) {
                    vueloEnCurso = v;
                    break;
                }
                if (simTime.isBefore(v.getSalidaUtc()) && proximoVuelo == null) {
                    proximoVuelo = v;
                }
            }
            if (vueloEnCurso != null) {
                estado = "EN_VUELO";
                vueloActual = vueloEnCurso.getId();
                aeropuertoActual = vueloEnCurso.getOrigen().getCodigoOACI();
            } else if (!simTime.isBefore(vuelosRuta.get(vuelosRuta.size() - 1).getLlegadaUtc())) {
                LocalDateTime tiempoEntrega = vuelosRuta.get(vuelosRuta.size() - 1)
                        .getLlegadaUtc()
                        .plusMinutes(DESTINATION_PICKUP_MINUTES);
                aeropuertoActual = paquete.getDestinoOACI();
                estado = simTime.isAfter(tiempoEntrega) ? "ENTREGADO" : "EN_ESPERA";
            } else if (proximoVuelo != null) {
                estado = "EMBARCADO";
                vueloEsperado = proximoVuelo.getId();
                aeropuertoActual = proximoVuelo.getOrigen().getCodigoOACI();
            }
        }

        return MaletaSimulacionDTO.builder()
                .id(paquete.getId() + "-BAG-" + String.format("%03d", indice))
                .envioId(paquete.getId())
                .indice(indice)
                .subrutaIndex(subrutaIndex)
                .origen(paquete.getOrigenOACI())
                .destino(paquete.getDestinoOACI())
                .estado(estado)
                .aeropuertoActual(aeropuertoActual)
                .vueloActual(vueloActual)
                .vueloEsperado(vueloEsperado)
                .ultimaLlegadaUtc(ultimaLlegada != null ? ultimaLlegada.toString() : null)
                .rutaAeropuertos(construirRutaAeropuertos(paquete, ruta))
                .rutaVuelos(construirRutaVuelos(ruta))
                .rutaAnteriorAeropuertos(rutaAnterior != null ? construirRutaAeropuertos(paquete, rutaAnterior) : null)
                .rutaAnteriorVuelos(rutaAnterior != null ? construirRutaVuelos(rutaAnterior) : null)
                .cantidad(1)
                .build();
    }

    private List<Paquete> filtrarPaquetesPendientesEnVentana(
            Dataset dataset,
            Config_Simulacion config,
            Map<String, Ruta> rutasActuales,
            Set<String> rutasEntregadas,
            LocalDateTime simTime,
            LocalDateTime fechaInicio
    ) {
        return filtrarPaquetesPendientesEnVentana(
                dataset,
                config,
                rutasActuales,
                rutasEntregadas,
                simTime,
                fechaInicio,
                ROLLING_LOOKAHEAD_MINUTES
        );
    }

    private List<Paquete> filtrarPaquetesPendientesEnVentana(
            Dataset dataset,
            Config_Simulacion config,
            Map<String, Ruta> rutasActuales,
            Set<String> rutasEntregadas,
            LocalDateTime simTime,
            LocalDateTime fechaInicio,
            int horizonteMinutos
    ) {
        LocalDateTime limitePlanificacion = simTime.plusMinutes(horizonteMinutos);
        List<Paquete> pendientes = new ArrayList<>();

        for (Paquete paquete : dataset.getPaquetes()) {
            if (paqueteFueCreadoAntesDelInicio(paquete, fechaInicio)) {
                continue;
            }
            String paqueteId = paquete.getId();
            if (rutasEntregadas.contains(paqueteId)) {
                continue;
            }

            Ruta rutaActual = rutasActuales.get(paqueteId);
            if (rutaActual != null && !rutaActual.getVuelos().isEmpty()) {
                Vuelo primerVuelo = rutaActual.getVuelos().get(0);
                if (!primerVuelo.getSalidaUtc().isAfter(simTime)) {
                    continue;
                }
            }

            LocalDateTime creacionUtc = PlanificacionUtils.getCreacionUtc(paquete, dataset, config);
            if (!creacionUtc.isAfter(limitePlanificacion)) {
                pendientes.add(paquete);
            }
        }

        return pendientes;
    }

    private Set<String> calcularNoAsignadosEnVentana(
            Dataset dataset,
            Config_Simulacion config,
            Map<String, Ruta> rutas,
            LocalDateTime simTime,
            Set<String> rutasEntregadas,
            LocalDateTime fechaInicio
    ) {
        return calcularNoAsignadosEnVentana(
                dataset,
                config,
                rutas,
                simTime,
                rutasEntregadas,
                fechaInicio,
                ROLLING_LOOKAHEAD_MINUTES
        );
    }

    private Set<String> calcularNoAsignadosEnVentana(
            Dataset dataset,
            Config_Simulacion config,
            Map<String, Ruta> rutas,
            LocalDateTime simTime,
            Set<String> rutasEntregadas,
            LocalDateTime fechaInicio,
            int horizonteMinutos
    ) {
        LocalDateTime limitePlanificacion = simTime.plusMinutes(horizonteMinutos);
        Set<String> noAsignados = new HashSet<>();
        for (Paquete paquete : dataset.getPaquetes()) {
            if (paqueteFueCreadoAntesDelInicio(paquete, fechaInicio)) {
                continue;
            }
            if (rutasEntregadas.contains(paquete.getId())) {
                continue;
            }
            LocalDateTime creacionUtc = PlanificacionUtils.getCreacionUtc(paquete, dataset, config);
            if (!creacionUtc.isAfter(limitePlanificacion) && !rutas.containsKey(paquete.getId())) {
                noAsignados.add(paquete.getId());
            }
        }
        return noAsignados;
    }

    private boolean paqueteFueCreadoAntesDelInicio(Paquete paquete, LocalDateTime fechaInicio) {
        if (paquete == null || fechaInicio == null) {
            return false;
        }
        LocalDateTime creacionUtc = LocalDateTime.of(paquete.getFecha(), paquete.getHora());
        return creacionUtc.isBefore(fechaInicio);
    }

    public void detenerSimulacion(String sessionId) {
        cancellationFlags.put(sessionId, true);
        CompletableFuture<Void> future = activeSimulations.get(sessionId);
        if (future != null) {
            future.cancel(true);
        }
        activeSimulations.remove(sessionId);
        pauseFlags.remove(sessionId);
        airportBaseCache.remove(sessionId);
        flightCoordCache.remove(sessionId);
        flightDurationCache.remove(sessionId);
        sessionDatasetCache.remove(sessionId);
        sessionContextVersionCache.remove(sessionId);
    }

    private long obtenerVersionContextoSimulacion() {
        Object version = contextSyncStateService.snapshot(AlmacenContexto.SIMULACION).get("version");
        return version instanceof Number ? ((Number) version).longValue() : 0L;
    }

    private Dataset obtenerDatasetSesionActualizado(String sessionId, Dataset fallbackDataset) {
        long currentVersion = obtenerVersionContextoSimulacion();
        Dataset cachedDataset = sessionDatasetCache.get(sessionId);
        Long cachedVersion = sessionContextVersionCache.get(sessionId);
        if (cachedDataset != null && cachedVersion != null && cachedVersion == currentVersion) {
            return cachedDataset;
        }

        var session = sessionRepository.findById(sessionId).orElse(null);
        Dataset baseDataset = cargaArchivosService.obtenerUltimoDataset();
        if (session == null || baseDataset == null) {
            Dataset safeFallback = cachedDataset != null ? cachedDataset : fallbackDataset;
            if (safeFallback != null) {
                sessionDatasetCache.put(sessionId, safeFallback);
                sessionContextVersionCache.put(sessionId, currentVersion);
            }
            return safeFallback;
        }

        LocalDate fechaBase = session.getFechaInicio() != null
                ? session.getFechaInicio().toLocalDate()
                : LocalDate.now();
        int diasVentana = Math.max(session.getDuracionDias() + FLIGHT_WINDOW_FORWARD_BUFFER_HOURS / 24, 1);
        Dataset effectiveDataset = datasetContextService.construirDatasetEfectivo(
                AlmacenContexto.SIMULACION,
                baseDataset,
                fechaBase,
                diasVentana
        );
        precalcularCaches(sessionId, effectiveDataset);
        sessionDatasetCache.put(sessionId, effectiveDataset);
        sessionContextVersionCache.put(sessionId, currentVersion);
        return effectiveDataset;
    }

    private void actualizarSesionColapsada(String sessionId, String motivo, int hora, int totalHoras) {
        var session = sessionRepository.findById(sessionId).orElse(null);
        if (session != null) {
            session.setEstado("COLAPSADA");
            session.setMotivoColapso(motivo);
            session.setProgresoPorcentaje(Math.min(100, (hora * 100) / Math.max(1, totalHoras)));
            sessionRepository.save(session);
        }
    }

    private MaletasResumen calcularResumenMaletas(
            Dataset dataset,
            Map<String, Ruta> rutasAsignadas,
            LocalDateTime simTime,
            LocalDateTime fechaInicio
    ) {
        if (dataset == null || simTime == null) {
            return new MaletasResumen(0, 0);
        }

        int entregadas = 0;
        int enTransito = 0;
        Map<String, Ruta> rutas = rutasAsignadas != null ? rutasAsignadas : Collections.emptyMap();

        for (Paquete paquete : dataset.getPaquetes()) {
            if (paqueteFueCreadoAntesDelInicio(paquete, fechaInicio)) {
                continue;
            }
            LocalDateTime creacionUtc = LocalDateTime.of(paquete.getFecha(), paquete.getHora());
            if (creacionUtc.isAfter(simTime)) {
                continue;
            }

            int cantidad = paquete.getCantidad();
            Ruta ruta = rutas.get(paquete.getId());
            if (ruta == null || ruta.getVuelos().isEmpty()) {
                continue;
            }

            List<Vuelo> vuelosRuta = ruta.getVuelos();
            Vuelo vueloEnCurso = null;
            Vuelo proximoVuelo = null;
            for (Vuelo v : vuelosRuta) {
                if (!simTime.isBefore(v.getSalidaUtc()) && simTime.isBefore(v.getLlegadaUtc())) {
                    vueloEnCurso = v;
                    break;
                }
                if (simTime.isBefore(v.getSalidaUtc()) && proximoVuelo == null) {
                    proximoVuelo = v;
                }
            }

            if (vueloEnCurso != null || proximoVuelo != null) {
                enTransito += cantidad;
                continue;
            }

            Vuelo ultimo = vuelosRuta.get(vuelosRuta.size() - 1);
            LocalDateTime tiempoEntrega = ultimo.getLlegadaUtc().plusMinutes(DESTINATION_PICKUP_MINUTES);
            if (!simTime.isBefore(ultimo.getLlegadaUtc()) && !simTime.isAfter(tiempoEntrega)) {
                enTransito += cantidad;
                continue;
            }

            if (simTime.isAfter(tiempoEntrega)) {
                entregadas += cantidad;
            }
        }

        return new MaletasResumen(entregadas, enTransito);
    }

    private record MaletasResumen(int entregadas, int enTransito) {}

    private void precalcularCaches(String sessionId, Dataset dataset) {
        Map<String, Almacen> almacenMap = almacenService.getMapaAlmacenes(AlmacenContexto.SIMULACION);
        Map<String, List<String>> entrantesMap = new HashMap<>();
        Map<String, List<String>> salientesMap = new HashMap<>();
        for (Vuelo v : dataset.getVuelos()) {
            String origen = v.getOrigen().getCodigoOACI();
            String destino = v.getDestino().getCodigoOACI();
            entrantesMap.computeIfAbsent(destino, k -> new ArrayList<>()).add(v.getId());
            salientesMap.computeIfAbsent(origen, k -> new ArrayList<>()).add(v.getId());
        }

        List<AeropuertoDTO> airportBase = new ArrayList<>();
        Set<String> codigos = new LinkedHashSet<>(dataset.getAeropuertos().keySet());
        codigos.addAll(almacenMap.keySet());
        for (String codigo : codigos) {
            Aeropuerto a = dataset.getAeropuertos().get(codigo);
            double[] coord = AeropuertoCoordenadas.get(codigo);
            Almacen almacen = almacenMap.get(codigo);
            double latitud = almacen != null ? almacen.getLatitud() : (coord != null ? coord[0] : 0.0);
            double longitud = almacen != null ? almacen.getLongitud() : (coord != null ? coord[1] : 0.0);
            int capacidad = almacen != null ? almacen.getCapacidadMaxima() : (a != null ? a.getCapacidadMaxima() : 0);
            airportBase.add(AeropuertoDTO.builder()
                    .codigoOACI(codigo)
                    .latitud(latitud).longitud(longitud)
                    .ciudad(almacen != null ? almacen.getCiudad() : null)
                    .pais(almacen != null ? almacen.getPais() : null)
                    .capacidadMaxima(capacidad)
                    .ocupacionActual(0)
                    .vuelosEntrantes(entrantesMap.getOrDefault(codigo, new ArrayList<>()))
                    .vuelosSalientes(salientesMap.getOrDefault(codigo, new ArrayList<>()))
                    .build());
        }
        airportBaseCache.put(sessionId, airportBase);

        Map<String, double[]> flightCoords = new HashMap<>();
        Map<String, Long> flightDurations = new HashMap<>();
        for (Vuelo v : dataset.getVuelos()) {
            double[] orig = AeropuertoCoordenadas.get(v.getOrigen().getCodigoOACI());
            double[] dest = AeropuertoCoordenadas.get(v.getDestino().getCodigoOACI());
            Almacen almOrigen = almacenMap.get(v.getOrigen().getCodigoOACI());
            Almacen almDestino = almacenMap.get(v.getDestino().getCodigoOACI());
            double latOrigen = almOrigen != null ? almOrigen.getLatitud() : orig[0];
            double lonOrigen = almOrigen != null ? almOrigen.getLongitud() : orig[1];
            double latDestino = almDestino != null ? almDestino.getLatitud() : dest[0];
            double lonDestino = almDestino != null ? almDestino.getLongitud() : dest[1];
            flightCoords.put(v.getId(), new double[]{latOrigen, lonOrigen, latDestino, lonDestino});
            if (v.getSalidaUtc() != null && v.getLlegadaUtc() != null) {
                flightDurations.put(v.getId(), ChronoUnit.MINUTES.between(v.getSalidaUtc(), v.getLlegadaUtc()));
            }
        }
        flightCoordCache.put(sessionId, flightCoords);
        flightDurationCache.put(sessionId, flightDurations);
    }

    private void actualizarEstadoEnCache(String sessionId, LocalDateTime simTime, Dataset dataset,
                                          Map<String, Integer> cargaVuelo, Map<String, Integer> ocupacionAeropuerto,
                                          int maletasEntregadas, int maletasEnTransito,
                                          int hora, int totalHoras, boolean colapsada,
                                          String motivo, List<LogEntry> logs, String status,
                                          LocalDateTime fechaInicio,
                                          Map<String, Ruta> rutasAsignadas,
                                          Map<String, Ruta> rutasAnteriores,
                                          Map<String, AsignacionPaquete> asignacionesSplit,
                                          PlanificacionSnapshot ultimaPlanificacion) {
        // Monotonicity guard: never let simulation time/progress go backwards
        SimulationState prevState = simulationCache.get(sessionId);
        int prevHora = 0;
        int prevProgreso = 0;
        int prevEntregadas = 0;
        LocalDateTime startedAt = null;
        if (prevState != null) {
            prevHora = (prevState.getProgreso() * totalHoras) / 100;
            prevProgreso = prevState.getProgreso();
            prevEntregadas = prevState.getMaletasEntregadas();
            startedAt = prevState.getStartedAt();
        }
        int horaEfectiva = Math.max(hora, prevHora);
        int progresoSim = Math.min(100, totalHoras > 0 ? (horaEfectiva * 100) / totalHoras : 0);
        progresoSim = Math.max(progresoSim, prevProgreso);
        maletasEntregadas = Math.max(maletasEntregadas, prevEntregadas);
        maletasEnTransito = Math.max(0, maletasEnTransito);

        int vuelosCulminados = 0;
        int vuelosEnTransito = 0;
        int vuelosCancelados = 0;

        Set<String> vuelosCanceladosSet = cargaArchivosService.obtenerVuelosCancelados(AlmacenContexto.SIMULACION);

        List<VueloDTO> vuelosDTO = new ArrayList<>();
        Map<String, double[]> flightCoords = flightCoordCache.get(sessionId);
        Map<String, Long> flightDurations = flightDurationCache.get(sessionId);
        LocalDateTime fechaFin = fechaInicio.plusMinutes(totalHoras);
        for (Vuelo v : dataset.getVuelos()) {
            if (v.getSalidaUtc() != null && v.getSalidaUtc().isBefore(fechaInicio)) continue;
            // Los dos días extra del dataset son margen para el planificador, no parte
            // de la ventana que se presenta ni se contabiliza en la simulación.
            if (v.getSalidaUtc() != null && v.getSalidaUtc().isAfter(fechaFin)) continue;

            boolean isCancelled = vuelosCanceladosSet.contains(v.getId());
            double progreso = 0.0;
            Long totalMins = (flightDurations != null) ? flightDurations.get(v.getId()) : null;
            if (simTime != null && v.getSalidaUtc() != null && v.getLlegadaUtc() != null && totalMins != null && totalMins > 0) {
                long transcurrido = ChronoUnit.MINUTES.between(v.getSalidaUtc(), simTime);
                progreso = Math.min(100.0, Math.max(0.0, (double) transcurrido / totalMins * 100));
                if (simTime.isAfter(v.getLlegadaUtc())) progreso = 100.0;
                if (simTime.isBefore(v.getSalidaUtc())) progreso = 0.0;
            } else if (simTime != null && v.getSalidaUtc() != null && v.getLlegadaUtc() != null) {
                if (simTime.isAfter(v.getLlegadaUtc())) progreso = 100.0;
                if (simTime.isBefore(v.getSalidaUtc())) progreso = 0.0;
            }

            String estado;
            if (isCancelled) {
                estado = "CANCELADO";
                vuelosCancelados++;
            } else if (progreso >= 100.0) {
                estado = "CULMINADO";
                vuelosCulminados++;
            } else if (progreso > 0.0) {
                estado = "ACTIVO";
                vuelosEnTransito++;
            } else {
                estado = "PROGRAMADO";
            }

            if (flightCoords != null) {
                double[] coords = flightCoords.get(v.getId());
                if (coords != null) {
                    vuelosDTO.add(VueloDTO.builder()
                            .id(v.getId())
                            .origen(v.getOrigen().getCodigoOACI())
                            .destino(v.getDestino().getCodigoOACI())
                            .latOrigen(coords[0]).lonOrigen(coords[1])
                            .latDestino(coords[2]).lonDestino(coords[3])
                            .salidaUtc(v.getSalidaUtc())
                            .llegadaUtc(v.getLlegadaUtc())
                            .capacidad(v.getCapacidadCarga())
                            .cargaActual(cargaVuelo.getOrDefault(v.getId(), 0))
                            .progresoVuelo(progreso)
                            .estado(estado)
                            .programacionId(extraerProgramacionId(v.getId()))
                            .editable(v.getId() != null && v.getId().startsWith("USR-"))
                            .recurrente(v.getId() != null && v.getId().startsWith("USR-"))
                            .build());
                }
            }
        }

        // Pre-filter active flight IDs for current simTime
        Set<String> activeFlightIds = new HashSet<>();
        for (Vuelo v : dataset.getVuelos()) {
            if (v.getSalidaUtc() != null && v.getSalidaUtc().isBefore(fechaInicio)) continue;
            if (v.getSalidaUtc() != null && v.getSalidaUtc().isAfter(fechaFin)) continue;
            if (simTime != null && v.getSalidaUtc() != null && v.getLlegadaUtc() != null) {
                if (simTime.isAfter(v.getSalidaUtc()) && simTime.isBefore(v.getLlegadaUtc())) {
                    activeFlightIds.add(v.getId());
                }
            }
        }

        // Pre-calculate cancelled flights by origin airport
        Map<String, List<String>> canceladosPorOrigen = new HashMap<>();
        for (Vuelo v : dataset.getVuelos()) {
            if (vuelosCanceladosSet.contains(v.getId())) {
                String origen = v.getOrigen().getCodigoOACI();
                canceladosPorOrigen.computeIfAbsent(origen, k -> new ArrayList<>()).add(v.getId());
            }
        }

        List<AeropuertoDTO> aeropuertosDTO = new ArrayList<>();
        List<AeropuertoDTO> airportBase = airportBaseCache.get(sessionId);
        if (airportBase != null) {
            for (AeropuertoDTO base : airportBase) {
                int ocup = ocupacionAeropuerto.getOrDefault(base.getCodigoOACI(), 0);
                List<String> entrantes = base.getVuelosEntrantes().stream()
                        .filter(activeFlightIds::contains)
                        .collect(Collectors.toList());
                List<String> salientes = base.getVuelosSalientes().stream()
                        .filter(activeFlightIds::contains)
                        .collect(Collectors.toList());
                List<String> canceladosSalientes = canceladosPorOrigen.getOrDefault(base.getCodigoOACI(), new ArrayList<>());
                aeropuertosDTO.add(AeropuertoDTO.builder()
                        .codigoOACI(base.getCodigoOACI())
                        .latitud(base.getLatitud()).longitud(base.getLongitud())
                        .ciudad(base.getCiudad())
                        .pais(base.getPais())
                        .capacidadMaxima(base.getCapacidadMaxima())
                        .ocupacionActual(ocup)
                        .vuelosEntrantes(entrantes)
                        .vuelosSalientes(salientes)
                        .vuelosCanceladosSalientes(canceladosSalientes)
                        .build());
            }
        }

        List<EnvioSimulacionDTO> enviosDTO = new ArrayList<>();
        List<MaletaSimulacionDTO> maletasDTO = new ArrayList<>();
        if (simTime != null) {
            Map<String, Ruta> rutasVisibles = rutasAsignadas != null ? rutasAsignadas : Collections.emptyMap();
            for (Paquete paquete : dataset.getPaquetes()) {
                if (paqueteFueCreadoAntesDelInicio(paquete, fechaInicio)) {
                    continue;
                }
                LocalDateTime creacionUtc = LocalDateTime.of(paquete.getFecha(), paquete.getHora());
                if (creacionUtc.isAfter(simTime)) {
                    continue;
                }

                Ruta ruta = rutasVisibles.get(paquete.getId());
                Ruta rutaAnterior = rutasAnteriores != null ? rutasAnteriores.get(paquete.getId()) : null;
                String estado;
                String aeropuertoActual = paquete.getOrigenOACI();
                String vueloActual = null;
                String vueloEsperado = null;
                String ultimoVuelo = null;
                LocalDateTime ultimaLlegada = null;

                if (ruta == null || ruta.getVuelos().isEmpty()) {
                    estado = "EN_ESPERA";
                } else {
                    List<Vuelo> vuelosRuta = ruta.getVuelos();
                    ultimoVuelo = vuelosRuta.get(vuelosRuta.size() - 1).getId();
                    ultimaLlegada = vuelosRuta.get(vuelosRuta.size() - 1).getLlegadaUtc();
                    Vuelo vueloEnCurso = null;
                    Vuelo proximoVuelo = null;
                    for (Vuelo v : vuelosRuta) {
                        if (!simTime.isBefore(v.getSalidaUtc()) && simTime.isBefore(v.getLlegadaUtc())) {
                            vueloEnCurso = v;
                            break;
                        }
                        if (simTime.isBefore(v.getSalidaUtc()) && proximoVuelo == null) {
                            proximoVuelo = v;
                        }
                    }
                    if (vueloEnCurso != null) {
                        estado = "EN_VUELO";
                        vueloActual = vueloEnCurso.getId();
                        aeropuertoActual = vueloEnCurso.getOrigen().getCodigoOACI();
                    } else if (!simTime.isBefore(vuelosRuta.get(vuelosRuta.size() - 1).getLlegadaUtc())) {
                        LocalDateTime tiempoEntrega = vuelosRuta.get(vuelosRuta.size() - 1)
                                .getLlegadaUtc()
                                .plusMinutes(DESTINATION_PICKUP_MINUTES);
                        aeropuertoActual = paquete.getDestinoOACI();
                        estado = simTime.isAfter(tiempoEntrega) ? "ENTREGADO" : "EN_ESPERA";
                    } else if (proximoVuelo != null) {
                        estado = "EMBARCADO";
                        vueloEsperado = proximoVuelo.getId();
                        aeropuertoActual = proximoVuelo.getOrigen().getCodigoOACI();
                    } else {
                        estado = "EN_ESPERA";
                    }
                }

                enviosDTO.add(EnvioSimulacionDTO.builder()
                        .id(paquete.getId())
                        .origen(paquete.getOrigenOACI())
                        .destino(paquete.getDestinoOACI())
                        .estado(estado)
                        .aeropuertoActual(aeropuertoActual)
                        .vueloActual(vueloActual)
                        .vueloEsperado(vueloEsperado)
                        .ultimoVuelo(ultimoVuelo)
                        .ultimaLlegadaUtc(ultimaLlegada != null ? ultimaLlegada.toString() : null)
                        .rutaAeropuertos(construirRutaAeropuertos(paquete, ruta))
                        .rutaVuelos(construirRutaVuelos(ruta))
                        .rutaAnteriorAeropuertos(rutaAnterior != null ? construirRutaAeropuertos(paquete, rutaAnterior) : null)
                        .rutaAnteriorVuelos(rutaAnterior != null ? construirRutaVuelos(rutaAnterior) : null)
                        .cantidad(paquete.getCantidad())
                        .build());
                maletasDTO.addAll(construirMaletasPaquete(paquete, simTime, rutasAnteriores, asignacionesSplit, rutasVisibles));
            }
        }

        int enviosSinRuta = (int) enviosDTO.stream()
                .filter(envio -> envio.getRutaAeropuertos() == null || envio.getRutaAeropuertos().isEmpty())
                .count();
        boolean planificacionEstable = !colapsada
                && ultimaPlanificacion != null
                && ultimaPlanificacion.sinRuta() == 0
                && enviosSinRuta == 0;

        SimulationState state = SimulationState.builder()
                .sessionId(sessionId)
                .status(status)
                .startedAt(startedAt)
                .simulationTime(simTime)
                .fechaInicio(fechaInicio)
                .ultimaPlanificacionSimulada(ultimaPlanificacion != null ? ultimaPlanificacion.simTime() : null)
                .horizontePlanificacionMinutos(ROLLING_LOOKAHEAD_MINUTES)
                .duracionUltimaPlanificacionSeg(ultimaPlanificacion != null ? ultimaPlanificacion.duracionSeg() : null)
                .ultimaPlanificacionSinRuta(ultimaPlanificacion != null ? ultimaPlanificacion.sinRuta() : null)
                .planificacionEstable(planificacionEstable)
                .vuelos(vuelosDTO)
                .aeropuertos(aeropuertosDTO)
                .maletasEntregadas(maletasEntregadas)
                .maletasEnTransito(maletasEnTransito)
                .vuelosCulminados(vuelosCulminados)
                .vuelosEnTransito(vuelosEnTransito)
                .vuelosCancelados(vuelosCancelados)
                .progreso(progresoSim)
                .colapsada(colapsada)
                .motivoColapso(motivo)
                .elapsedRealtimeSeconds(calcularElapsedRealtimeSeconds(startedAt))
                .logs(new ArrayList<>(logs))
                .envios(enviosDTO)
                .maletas(maletasDTO)
                .build();

        simulationCache.put(sessionId, state);
        if (esEstadoEstable(state)) {
            simulationCache.putStable(sessionId, state);
        }
    }

    private boolean esEstadoEstable(SimulationState state) {
        if (state == null) {
            return false;
        }
        String status = state.getStatus();
        return ("EJECUTANDO".equals(status) || "COMPLETADA".equals(status))
                && Boolean.TRUE.equals(state.getPlanificacionEstable());
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

    private void actualizarEstadoColapsado(String sessionId, LocalDateTime simTime, LocalDateTime fechaInicio, String motivo, List<LogEntry> logs) {
        LocalDateTime startedAt = LocalDateTime.now();
        SimulationState updated = SimulationState.builder()
                .sessionId(sessionId)
                .status("COLAPSADA")
                .startedAt(startedAt)
                .simulationTime(simTime)
                .fechaInicio(fechaInicio)
                .vuelos(new ArrayList<>())
                .aeropuertos(new ArrayList<>())
                .maletasEntregadas(0)
                .maletasEnTransito(0)
                .progreso(0)
                .colapsada(true)
                .motivoColapso(motivo)
                .elapsedRealtimeSeconds(calcularElapsedRealtimeSeconds(startedAt))
                .logs(logs)
                .envios(new ArrayList<>())
                .maletas(new ArrayList<>())
                .build();
        simulationCache.put(sessionId, updated);
    }

    private long calcularElapsedRealtimeSeconds(LocalDateTime startedAt) {
        if (startedAt == null) {
            return 0L;
        }
        return Math.max(0L, Duration.between(startedAt, LocalDateTime.now()).getSeconds());
    }
}
