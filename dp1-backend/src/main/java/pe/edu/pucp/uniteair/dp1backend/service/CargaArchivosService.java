package pe.edu.pucp.uniteair.dp1backend.service;

import jakarta.annotation.PostConstruct;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.entity.VueloCancelado;
import pe.edu.pucp.uniteair.dp1backend.repository.VueloCanceladoRepository;
import tasf.config.Config_Simulacion;
import tasf.core.AsignacionPaquete;
import tasf.core.Dataset;
import tasf.core.EstadoOperacional;
import tasf.core.PlanificacionUtils;
import tasf.core.RutaConCantidad;
import tasf.core.Solucion;
import tasf.io.DatasetTextoLoader;
import tasf.model.Aeropuerto;
import tasf.model.Paquete;
import tasf.model.Ruta;
import tasf.model.Vuelo;
import tasf.strategy.TwoPhaseOrchestrator;
import tasf.strategy.alns.ALNS_RutasPlanner;

import java.time.Duration;
import java.time.ZoneOffset;
import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Service
public class CargaArchivosService {
    public static final String CLIENTE_PRUEBA_OPERACION_DIARIA = "0007729";

    private Dataset lastDataset;
    private volatile EstadoOperacional estadoOperacional;
    private volatile Map<String, Integer> cargaVueloCache;
    private volatile Map<String, Ruta> rutasAsignadas = new HashMap<>();
    private volatile Map<String, Ruta> rutasAnteriores = new HashMap<>();
    private volatile Map<String, AsignacionPaquete> asignacionesSplit = new HashMap<>();
    private volatile boolean planificando = false;
    private volatile List<Paquete> paquetesIncrementales = new ArrayList<>();
    private volatile boolean usarPaquetesBaseEnOperacion = false;
    private int contadorPaquetesIncrementales = 0;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "planificador-bg");
        t.setDaemon(true);
        return t;
    });
    private final DatasetContextService datasetContextService;
    private final VueloCanceladoRepository vueloCanceladoRepository;
    private final ContextSyncStateService contextSyncStateService;

    public CargaArchivosService(DatasetContextService datasetContextService,
                                VueloCanceladoRepository vueloCanceladoRepository,
                                ContextSyncStateService contextSyncStateService) {
        this.datasetContextService = datasetContextService;
        this.vueloCanceladoRepository = vueloCanceladoRepository;
        this.contextSyncStateService = contextSyncStateService;
    }

    public record CargaResult(boolean success, String message, int aeropuertosCount, int vuelosCount,
                              int paquetesCount, String datasetId) {}

    @PostConstruct
    public void init() {
        cargarDatasetPorDefecto();
    }

    public synchronized void cargarDatasetPorDefecto() {
        if (this.lastDataset != null) return;
        try {
            Path tempDir = Files.createTempDirectory("default_carga_");
            copiarRecursosACarpeta(tempDir);
            Dataset dataset = cargarDatasetEnTemp(tempDir, LocalDate.now(), 3);
            this.lastDataset = dataset;
            this.estadoOperacional = null;
            this.cargaVueloCache = null;
            this.rutasAsignadas = new HashMap<>();
            this.rutasAnteriores = new HashMap<>();
            this.asignacionesSplit = new HashMap<>();
            this.planificando = false;
            this.usarPaquetesBaseEnOperacion = false;
            deleteTempDir(tempDir);
            System.out.println("[CargaArchivosService] Dataset por defecto cargado. Paquetes: " + dataset.getPaquetes().size());
            lanzarPlanificacionEnBackground(dataset);
        } catch (Exception e) {
            System.err.println("No se pudo cargar dataset por defecto: " + e.getMessage());
        }
    }

    public synchronized void cargarDatasetConFechas(LocalDate fechaInicio, int dias) {
        cargarDatasetConFechas(fechaInicio, dias, true);
    }

    public synchronized void cargarDatasetConFechas(LocalDate fechaInicio, int dias, boolean lanzarPlanificacionOperacion) {
        try {
            Path tempDir = Files.createTempDirectory("simulacion_carga_");
            copiarRecursosACarpeta(tempDir);
            Dataset dataset = cargarDatasetEnTemp(tempDir, fechaInicio, dias);
            System.out.println("[CargaArchivosService] cargarDatasetConFechas fechaInicio=" + fechaInicio
                    + " dias=" + dias
                    + " paquetes=" + dataset.getPaquetes().size()
                    + " vuelos=" + dataset.getVuelos().size());
            this.lastDataset = dataset;
            this.estadoOperacional = null;
            this.cargaVueloCache = null;
            this.rutasAsignadas = new HashMap<>();
            this.rutasAnteriores = new HashMap<>();
            this.asignacionesSplit = new HashMap<>();
            this.planificando = false;
            this.usarPaquetesBaseEnOperacion = false;
            deleteTempDir(tempDir);
            if (lanzarPlanificacionOperacion) {
                lanzarPlanificacionEnBackground(dataset);
            } else {
                System.out.println("[CargaArchivosService] Dataset de simulacion cargado sin planificacion de operacion en background.");
            }
        } catch (Exception e) {
            System.err.println("No se pudo cargar dataset con fechas: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private void lanzarPlanificacionEnBackground(Dataset dataset) {
        if (dataset == null || dataset.getPaquetes().isEmpty()) return;
        if (planificando) return;
        planificando = true;
        Dataset datasetOperacion = construirDatasetPlanificable(AlmacenContexto.OPERACION, dataset);
        executor.submit(() -> {
            try {
                planificarDataset(datasetOperacion);
            } finally {
                planificando = false;
            }
        });
    }

    private Dataset cargarDatasetEnTemp(Path tempDir, LocalDate fechaInicio, int dias) throws IOException {
        int diasVuelos = dias + 2;
        Set<LocalDate> fechasFiltro = generarFechasSimulacion(fechaInicio, dias);
        return DatasetTextoLoader.cargarDataset(tempDir, fechaInicio, diasVuelos, 50000, fechasFiltro);
    }

    private Set<LocalDate> generarFechasSimulacion(LocalDate inicio, int dias) {
        return IntStream.range(0, dias)
                .mapToObj(inicio::plusDays)
                .collect(Collectors.toCollection(HashSet::new));
    }

    private static final String[] ICAO_ENVIOS = {
        "EBCI","EDDI","EHAM","EKCH","LATI","LBSF","LDZA","LKPR","LOWW",
        "OAKB","OERK","OJAI","OMDB","OOMS","OPKC","OSDI","OYSN",
        "SABE","SBBR","SCEL","SEQM","SGAS","SKBO",
        "SLLP","SPIM","SUAA","SVMI","UBBB","UMMS","VIDP"
    };

    private void copiarRecursosACarpeta(Path destino) throws IOException {
        copiarRecurso("default-data/input/aeropuertos/c.1inf54.26.1.v1.Aeropuerto.husos.v1.20250818__estudiantes.txt",
                destino.resolve("input/aeropuertos/c.Aeropuerto.txt"));
        copiarRecurso("default-data/input/vuelos/planes_vuelo.txt",
                destino.resolve("input/vuelos/planes_vuelo.txt"));
        for (String icao : ICAO_ENVIOS) {
            copiarRecurso("default-data/input/envios/_envios_" + icao + "_.txt",
                    destino.resolve("input/envios/_envios_" + icao + "_.txt"));
        }
    }

    private void copiarRecurso(String classpath, Path destino) throws IOException {
        Files.createDirectories(destino.getParent());
        try (InputStream is = getClass().getClassLoader().getResourceAsStream(classpath)) {
            if (is == null) {
                System.err.println("[WARN] Recurso no encontrado, se omite: " + classpath);
                return;
            }
            Files.copy(is, destino, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public synchronized CargaResult cargarArchivos(
            MultipartFile planesVuelo,
            MultipartFile aeropuertosFile,
            MultipartFile envios,
            String origenEnviosOaci
    ) {
        try {
            Path tempDir = Files.createTempDirectory("carga_");
            if (planesVuelo != null && !planesVuelo.isEmpty()) {
                saveToTemp(tempDir.resolve("input").resolve("vuelos"), planesVuelo, "planes_vuelo.txt");
            }
            if (aeropuertosFile != null && !aeropuertosFile.isEmpty()) {
                saveToTemp(tempDir.resolve("input").resolve("aeropuertos"), aeropuertosFile, "aeropuerto.txt");
            }
            if (envios != null && !envios.isEmpty()) {
                String origenNormalizado = normalizarOrigenEnvios(origenEnviosOaci);
                saveToTemp(tempDir.resolve("input").resolve("envios"), envios, "_envios_" + origenNormalizado + "_.txt");
            }

            LocalDate fechaInicio = LocalDate.now();
            Set<LocalDate> fechasFiltro = generarFechasSimulacion(fechaInicio, 3);
            Dataset dataset = DatasetTextoLoader.cargarDataset(tempDir, fechaInicio, 3, 50000, fechasFiltro);

            int aeropuertosCount = dataset.getAeropuertos().size();
            int vuelosCount = dataset.getVuelos().size();
            int paquetesCount = dataset.getPaquetes().size();

            String datasetId = UUID.randomUUID().toString();
            this.lastDataset = dataset;
            this.estadoOperacional = null;
            this.cargaVueloCache = null;
            this.rutasAsignadas = new HashMap<>();
            this.rutasAnteriores = new HashMap<>();
            this.asignacionesSplit = new HashMap<>();
            this.planificando = false;
            this.paquetesIncrementales = new ArrayList<>();
            this.contadorPaquetesIncrementales = 0;
            this.usarPaquetesBaseEnOperacion = true;

            lanzarPlanificacionEnBackground(dataset);

            deleteTempDir(tempDir);

            return new CargaResult(true, "Archivos cargados exitosamente", aeropuertosCount, vuelosCount, paquetesCount, datasetId);
        } catch (Exception e) {
            return new CargaResult(false, "Error al cargar archivos: " + e.getMessage(), 0, 0, 0, null);
        }
    }

    public synchronized Dataset obtenerUltimoDataset() {
        return lastDataset;
    }

    public synchronized void replanificarOperacionActual() {
        if (lastDataset == null) {
            return;
        }
        lanzarPlanificacionEnBackground(lastDataset);
    }

    public synchronized EstadoOperacional obtenerEstadoOperacional() {
        return estadoOperacional;
    }

    public synchronized boolean isPlanificando() {
        return planificando;
    }

    public int getCargaVuelo(String vueloId) {
        Map<String, Integer> cache = cargaVueloCache;
        return cache != null ? cache.getOrDefault(vueloId, 0) : 0;
    }

    public int getOcupacionAeropuerto(String codigoOACI, LocalDateTime horaUtc) {
        EstadoOperacional estado = estadoOperacional;
        return estado != null ? estado.getOcupacionHora(codigoOACI, horaUtc) : 0;
    }

    public static String obtenerClienteIdCompat(Paquete paquete) {
        if (paquete == null) {
            return CLIENTE_PRUEBA_OPERACION_DIARIA;
        }
        try {
            Method getter = paquete.getClass().getMethod("getClienteId");
            Object value = getter.invoke(paquete);
            if (value instanceof String clienteId && !clienteId.isBlank()) {
                return clienteId;
            }
        } catch (ReflectiveOperationException ignored) {
        }
        return CLIENTE_PRUEBA_OPERACION_DIARIA;
    }

    private static Paquete crearPaqueteCompat(
            String id,
            String origenOACI,
            LocalDate fecha,
            LocalTime hora,
            String destinoOACI,
            int cantidad,
            String referencia,
            String clienteId,
            boolean incremental
    ) {
        try {
            Constructor<Paquete> constructorNuevo = Paquete.class.getConstructor(
                    String.class,
                    String.class,
                    LocalDate.class,
                    LocalTime.class,
                    String.class,
                    int.class,
                    String.class,
                    String.class,
                    boolean.class
            );
            return constructorNuevo.newInstance(
                    id,
                    origenOACI,
                    fecha,
                    hora,
                    destinoOACI,
                    cantidad,
                    referencia,
                    clienteId,
                    incremental
            );
        } catch (NoSuchMethodException ignored) {
            try {
                Constructor<Paquete> constructorCompat = Paquete.class.getConstructor(
                        String.class,
                        String.class,
                        LocalDate.class,
                        LocalTime.class,
                        String.class,
                        int.class,
                        String.class
                );
                return constructorCompat.newInstance(
                        id,
                        origenOACI,
                        fecha,
                        hora,
                        destinoOACI,
                        cantidad,
                        referencia
                );
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException("No se pudo construir Paquete con la firma compatible", e);
            }
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("No se pudo construir Paquete con la firma nueva", e);
        }
    }

    private void planificarDataset(Dataset dataset) {
        List<Paquete> paquetes = combinarPaquetes(obtenerPaquetesBaseOperacion(), paquetesIncrementales);
        if (dataset == null || paquetes.isEmpty()) {
            this.estadoOperacional = new EstadoOperacional();
            this.cargaVueloCache = new HashMap<>();
            return;
        }
        try {
            Config_Simulacion config = new Config_Simulacion();
            config.setAeropuertoHub("SKBO");
            config.setMinimaConexion(java.time.Duration.ofMinutes(10));
            config.setIteracionesALNS(20);
            config.setMaxRutasPorPaquete(4);
            config.setMaxEscalas(2);
            config.setVentanaActualizacionPesos(5);
            config.setEvaporacionFeromona(0.4);

            Dataset datasetGestion = new Dataset(
                dataset.getAeropuertos(),
                dataset.getVuelos(),
                paquetes
            );

            PlanificacionUtils.limpiarCacheGlobal();
            TwoPhaseOrchestrator orchestrator = new TwoPhaseOrchestrator(new ALNS_RutasPlanner());
            var solucion = orchestrator.ejecutarFlujoCompleto(datasetGestion, config);
            var rutas = solucion.getRutasAsignadas();

            registrarRutasAnteriores(rutas);
            this.rutasAsignadas = new HashMap<>(rutas);
            this.asignacionesSplit = new HashMap<>();
            this.estadoOperacional = PlanificacionUtils.construirEstadoConAsignaciones(rutas, datasetGestion, config);
            Map<String, Integer> nuevoCache = new HashMap<>();
            for (Vuelo v : dataset.getVuelos()) {
                int carga = this.estadoOperacional.getCargaVuelo(v.getId());
                if (carga > 0) {
                    nuevoCache.put(v.getId(), carga);
                }
            }
            this.cargaVueloCache = nuevoCache;
            System.out.println("[CargaArchivosService] Planificación completada. Rutas: " + rutas.size()
                    + ", CargaVuelo entries: " + nuevoCache.size());
        } catch (Exception e) {
            System.err.println("[CargaArchivosService] Error en planificación: " + e.getMessage());
            e.printStackTrace();
            this.estadoOperacional = new EstadoOperacional();
            this.cargaVueloCache = new HashMap<>();
        }
    }

    private record EstadoEnvio(
        String estado,
        String aeropuertoActual,
        String vueloActual,
        String vueloEsperado,
        LocalDateTime ultimaLlegada
    ) {}

    private EstadoEnvio computarEstado(Paquete paquete, Ruta ruta, LocalDateTime ahoraUtc) {
        if (ruta == null || ruta.getVuelos().isEmpty()) {
            return new EstadoEnvio("EN_ESPERA", paquete.getOrigenOACI(), null, null, null);
        }

        List<Vuelo> vuelosRuta = ruta.getVuelos();
        Vuelo vueloEnCurso = null;
        Vuelo proximoVuelo = null;

        for (Vuelo v : vuelosRuta) {
            if (!ahoraUtc.isBefore(v.getSalidaUtc()) && ahoraUtc.isBefore(v.getLlegadaUtc())) {
                vueloEnCurso = v;
                break;
            }
            if (ahoraUtc.isBefore(v.getSalidaUtc()) && proximoVuelo == null) {
                proximoVuelo = v;
            }
        }

        if (vueloEnCurso != null) {
            return new EstadoEnvio(
                "EN_VUELO",
                vueloEnCurso.getOrigen().getCodigoOACI(),
                vueloEnCurso.getId(),
                null,
                null
            );
        }

        LocalDateTime ultimaLlegada = vuelosRuta.get(vuelosRuta.size() - 1).getLlegadaUtc();
        if (ahoraUtc.isAfter(ultimaLlegada)) {
            return new EstadoEnvio(
                "ENTREGADO",
                paquete.getDestinoOACI(),
                null, null,
                ultimaLlegada
            );
        }

        if (proximoVuelo != null) {
            return new EstadoEnvio(
                "EMBARCADO",
                proximoVuelo.getOrigen().getCodigoOACI(),
                null,
                proximoVuelo.getId(),
                null
            );
        }

        return new EstadoEnvio("EN_ESPERA", paquete.getOrigenOACI(), null, null, null);
    }

    private List<String> construirRutaAeropuertos(Paquete paquete, Ruta ruta) {
        LinkedHashSet<String> aeropuertos = new LinkedHashSet<>();
        aeropuertos.add(paquete.getOrigenOACI());

        if (ruta != null) {
            for (Vuelo vuelo : ruta.getVuelos()) {
                aeropuertos.add(vuelo.getOrigen().getCodigoOACI());
                aeropuertos.add(vuelo.getDestino().getCodigoOACI());
            }
        }

        aeropuertos.add(paquete.getDestinoOACI());
        return new ArrayList<>(aeropuertos);
    }

    private List<String> construirRutaVuelos(Ruta ruta) {
        if (ruta == null || ruta.getVuelos().isEmpty()) {
            return new ArrayList<>();
        }
        return ruta.getVuelos().stream()
                .map(Vuelo::getId)
                .collect(Collectors.toCollection(ArrayList::new));
    }

    private String firmaRuta(Ruta ruta) {
        if (ruta == null || ruta.getVuelos().isEmpty()) {
            return "";
        }
        return ruta.getVuelos().stream()
                .map(Vuelo::getId)
                .collect(Collectors.joining("|"));
    }

    private void registrarRutasAnteriores(Map<String, Ruta> nuevasRutas) {
        if (nuevasRutas == null || nuevasRutas.isEmpty() || rutasAsignadas.isEmpty()) {
            return;
        }
        Map<String, Ruta> historial = new HashMap<>(rutasAnteriores);
        for (Map.Entry<String, Ruta> entry : nuevasRutas.entrySet()) {
            Ruta actual = rutasAsignadas.get(entry.getKey());
            Ruta nueva = entry.getValue();
            if (actual == null) {
                continue;
            }
            if (!Objects.equals(firmaRuta(actual), firmaRuta(nueva))) {
                historial.put(entry.getKey(), actual);
            }
        }
        rutasAnteriores = historial;
    }

    private List<Paquete> obtenerTodosLosPaquetes() {
        return combinarPaquetes(
                obtenerPaquetesBaseOperacion(),
                paquetesIncrementales
        );
    }

    private List<Paquete> obtenerPaquetesBaseOperacion() {
        if (!usarPaquetesBaseEnOperacion || lastDataset == null) {
            return List.of();
        }
        return lastDataset.getPaquetes();
    }

    private List<Paquete> combinarPaquetes(List<Paquete> base, List<Paquete> adicionales) {
        Map<String, Paquete> combinados = new LinkedHashMap<>();
        for (Paquete paquete : base) {
            combinados.put(paquete.getId(), paquete);
        }
        for (Paquete paquete : adicionales) {
            combinados.put(paquete.getId(), paquete);
        }
        return new ArrayList<>(combinados.values());
    }

    private List<Map<String, Object>> construirMaletasPaquete(Paquete paquete, LocalDateTime ahoraUtc) {
        List<Map<String, Object>> maletas = new ArrayList<>();
        AsignacionPaquete asignacion = asignacionesSplit.get(paquete.getId());
        Ruta rutaAnterior = rutasAnteriores.get(paquete.getId());
        int indiceGlobal = 1;

        if (asignacion != null && !asignacion.isEmpty()) {
            int subrutaIndex = 1;
            for (RutaConCantidad rc : asignacion.getRutas()) {
                EstadoEnvio estado = computarEstado(paquete, rc.getRuta(), ahoraUtc);
                for (int i = 0; i < rc.getCantidad(); i++) {
                    maletas.add(construirMaleta(paquete, indiceGlobal++, subrutaIndex, rc.getRuta(), rutaAnterior, estado));
                }
                subrutaIndex++;
            }
        }

        while (indiceGlobal <= paquete.getCantidad()) {
            Ruta ruta = rutasAsignadas.get(paquete.getId());
            EstadoEnvio estado = computarEstado(paquete, ruta, ahoraUtc);
            maletas.add(construirMaleta(paquete, indiceGlobal++, 1, ruta, rutaAnterior, estado));
        }

        return maletas;
    }

    private Map<String, Object> construirMaleta(
            Paquete paquete,
            int indice,
            int subrutaIndex,
            Ruta ruta,
            Ruta rutaAnterior,
            EstadoEnvio estado
    ) {
        Map<String, Object> maleta = new HashMap<>();
        String maletaId = paquete.getId() + "-BAG-" + String.format("%03d", indice);
        maleta.put("id", maletaId);
        maleta.put("envioId", paquete.getId());
        maleta.put("indice", indice);
        maleta.put("subrutaIndex", subrutaIndex);
        maleta.put("origen", paquete.getOrigenOACI());
        maleta.put("destino", paquete.getDestinoOACI());
        maleta.put("estado", estado.estado());
        maleta.put("aeropuertoActual", estado.aeropuertoActual());
        maleta.put("vueloEsperado", estado.vueloEsperado());
        maleta.put("vueloActual", estado.vueloActual());
        maleta.put("ultimaLlegadaUtc", estado.ultimaLlegada() != null ? estado.ultimaLlegada().toString() : null);
        maleta.put("rutaAeropuertos", construirRutaAeropuertos(paquete, ruta));
        maleta.put("rutaVuelos", construirRutaVuelos(ruta));
        maleta.put("rutaAnteriorAeropuertos", rutaAnterior != null ? construirRutaAeropuertos(paquete, rutaAnterior) : null);
        maleta.put("rutaAnteriorVuelos", rutaAnterior != null ? construirRutaVuelos(rutaAnterior) : null);
        maleta.put("cantidad", 1);
        maleta.put("clienteId", obtenerClienteIdCompat(paquete));
        return maleta;
    }

    @Scheduled(fixedRate = 300000)
    public synchronized void rePlanificarProgramado() {
        if (lastDataset == null || planificando) return;

        LocalDateTime ahoraUtc = LocalDateTime.now(ZoneOffset.UTC);

        List<Paquete> paquetesPlanificables = obtenerTodosLosPaquetes();
        if (paquetesPlanificables.isEmpty()) return;

        // 1. Filtrar pendientes: EN_ESPERA o EMBARCADO
        List<Paquete> pendientes = new ArrayList<>();
        for (Paquete p : paquetesPlanificables) {
            Ruta ruta = rutasAsignadas.get(p.getId());
            EstadoEnvio e = computarEstado(p, ruta, ahoraUtc);
            if ("EN_ESPERA".equals(e.estado()) || "EMBARCADO".equals(e.estado())) {
                pendientes.add(p);
            }
        }
        if (pendientes.isEmpty()) return;

        // 2. Preservar rutas de paquetes activos (EN_VUELO / ENTREGADO)
        Set<String> pendientesIds = pendientes.stream().map(Paquete::getId).collect(Collectors.toSet());
        Map<String, Ruta> rutasActivos = new HashMap<>();
        for (Map.Entry<String, Ruta> entry : this.rutasAsignadas.entrySet()) {
            if (!pendientesIds.contains(entry.getKey())) {
                rutasActivos.put(entry.getKey(), entry.getValue());
            }
        }

        // 3. Planificar solo pendientes
        planificando = true;
        try {
            Config_Simulacion config = new Config_Simulacion();
            config.setAeropuertoHub("SKBO");
            config.setMinimaConexion(java.time.Duration.ofMinutes(10));
            config.setIteracionesALNS(20);
            config.setMaxRutasPorPaquete(4);
            config.setMaxEscalas(2);

            Dataset datasetPendientesBase = new Dataset(
                lastDataset.getAeropuertos(),
                lastDataset.getVuelos(),
                pendientes
            );
            Dataset datasetPendientes = construirDatasetPlanificable(
                    AlmacenContexto.OPERACION,
                    datasetPendientesBase
            );

            PlanificacionUtils.limpiarCacheGlobal();
            TwoPhaseOrchestrator orchestrator = new TwoPhaseOrchestrator(new ALNS_RutasPlanner());
            var solucion = orchestrator.ejecutarFlujoCompleto(datasetPendientes, config);
            var nuevasRutas = solucion.getRutasAsignadas();

            // 4. Merge: activos (intocables) + nuevos (re-planificados)
            Map<String, Ruta> todasLasRutas = new HashMap<>(rutasActivos);
            todasLasRutas.putAll(nuevasRutas);
            registrarRutasAnteriores(todasLasRutas);
            this.rutasAsignadas = todasLasRutas;
            Map<String, AsignacionPaquete> splitsActivos = new HashMap<>();
            for (Map.Entry<String, AsignacionPaquete> entry : this.asignacionesSplit.entrySet()) {
                if (!pendientesIds.contains(entry.getKey())) {
                    splitsActivos.put(entry.getKey(), entry.getValue());
                }
            }
            this.asignacionesSplit = splitsActivos;

            // 5. Reconstruir estado completo desde las rutas mergeadas
            Dataset datasetCompletoBase = new Dataset(
                lastDataset.getAeropuertos(),
                lastDataset.getVuelos(),
                paquetesPlanificables
            );
            Dataset datasetCompleto = construirDatasetPlanificable(
                    AlmacenContexto.OPERACION,
                    datasetCompletoBase
            );
            this.estadoOperacional = PlanificacionUtils.construirEstadoConAsignaciones(
                todasLasRutas, datasetCompleto, config);

            // 6. Reconstruir cache de carga de vuelos
            Map<String, Integer> nuevoCache = new HashMap<>();
            for (Vuelo v : lastDataset.getVuelos()) {
                int carga = this.estadoOperacional.getCargaVuelo(v.getId());
                if (carga > 0) nuevoCache.put(v.getId(), carga);
            }
            this.cargaVueloCache = nuevoCache;

            System.out.println("[Scheduler] Re-planificación: " + pendientes.size()
                + " pendientes → " + nuevasRutas.size() + " rutas nuevas");
        } catch (Exception e) {
            System.err.println("[Scheduler] Error en re-planificación: " + e.getMessage());
            e.printStackTrace();
        } finally {
            planificando = false;
        }
    }

    private void saveToTemp(Path dir, MultipartFile file, String filename) throws IOException {
        Files.createDirectories(dir);
        File dest = new File(dir.toFile(), filename);
        file.transferTo(dest);
    }

    private void deleteTempDir(Path tempDir) {
        try {
            Files.walk(tempDir)
                    .sorted(Comparator.reverseOrder())
                    .map(Path::toFile)
                    .forEach(File::delete);
        } catch (IOException ignored) {
        }
    }

    public synchronized Set<String> obtenerPaquetesEnVuelo(LocalDateTime ahora) {
        Set<String> enVuelo = new HashSet<>();
        if (rutasAsignadas.isEmpty() || lastDataset == null) return enVuelo;

        for (Map.Entry<String, Ruta> entry : rutasAsignadas.entrySet()) {
            String paqueteId = entry.getKey();
            Ruta ruta = entry.getValue();

            for (Vuelo vuelo : ruta.getVuelos()) {
                if (!ahora.isBefore(vuelo.getSalidaUtc()) && ahora.isBefore(vuelo.getLlegadaUtc())) {
                    enVuelo.add(paqueteId);
                    break;
                }
            }
        }
        return enVuelo;
    }

    public synchronized Set<String> obtenerPaquetesEntregados(LocalDateTime ahora) {
        Set<String> entregados = new HashSet<>();
        if (rutasAsignadas.isEmpty()) return entregados;

        for (Map.Entry<String, Ruta> entry : rutasAsignadas.entrySet()) {
            String paqueteId = entry.getKey();
            Ruta ruta = entry.getValue();
            List<Vuelo> vuelos = ruta.getVuelos();
            if (!vuelos.isEmpty() && !ahora.isBefore(vuelos.get(vuelos.size() - 1).getLlegadaUtc())) {
                entregados.add(paqueteId);
            }
        }
        return entregados;
    }

    public synchronized Dataset filtrarDatasetPorVentana(
            LocalDateTime inicio,
            LocalDateTime fin,
            Set<String> excluirPaquetes
    ) {
        if (lastDataset == null) {
            return new Dataset(Map.of(), List.of(), List.of());
        }

        List<Paquete> paquetesFiltrados = new ArrayList<>();
        Set<String> aeropuertosInvolucrados = new HashSet<>();

        for (Paquete p : lastDataset.getPaquetes()) {
            if (excluirPaquetes.contains(p.getId())) continue;

            Aeropuerto aeropuertoOrigen = lastDataset.getAeropuerto(p.getOrigenOACI());
            if (aeropuertoOrigen == null) continue;

            LocalDateTime creacion = p.getInstanteCreacionUtc(aeropuertoOrigen);
            if (!creacion.isBefore(inicio) && !creacion.isAfter(fin)) {
                paquetesFiltrados.add(p);
                aeropuertosInvolucrados.add(p.getOrigenOACI());
                aeropuertosInvolucrados.add(p.getDestinoOACI());
            }
        }

        for (Paquete p : paquetesIncrementales) {
            if (excluirPaquetes.contains(p.getId())) continue;

            Aeropuerto aeropuertoOrigen = lastDataset.getAeropuerto(p.getOrigenOACI());
            if (aeropuertoOrigen == null) continue;

            LocalDateTime creacion = p.getInstanteCreacionUtc(aeropuertoOrigen);
            if (!creacion.isBefore(inicio) && !creacion.isAfter(fin)) {
                paquetesFiltrados.add(p);
                aeropuertosInvolucrados.add(p.getOrigenOACI());
                aeropuertosInvolucrados.add(p.getDestinoOACI());
            }
        }

        Set<String> vuelosCanceladosOperacion = obtenerVuelosCancelados(AlmacenContexto.OPERACION);
        List<Vuelo> vuelosFiltrados = new ArrayList<>();
        LocalDateTime finVuelos = fin.plusHours(48);
        for (Vuelo v : lastDataset.getVuelos()) {
            if (vuelosCanceladosOperacion.contains(v.getId())) continue;

            LocalDateTime salida = v.getSalidaUtc();
            if (!salida.isBefore(inicio) && !salida.isAfter(finVuelos)) {
                vuelosFiltrados.add(v);
            }
        }

        Map<String, Aeropuerto> aeropuertosFiltrados = new HashMap<>();
        for (String codigo : aeropuertosInvolucrados) {
            Aeropuerto a = lastDataset.getAeropuerto(codigo);
            if (a != null) aeropuertosFiltrados.put(codigo, a);
        }

        Dataset base = new Dataset(aeropuertosFiltrados, vuelosFiltrados, paquetesFiltrados);
        return datasetContextService.construirDatasetEfectivo(AlmacenContexto.OPERACION, base);
    }

    public synchronized Dataset filtrarSoloGestionEnvios(
            LocalDateTime inicio,
            LocalDateTime fin,
            Set<String> excluirPaquetes
    ) {
        if (lastDataset == null) {
            return new Dataset(Map.of(), List.of(), List.of());
        }

        List<Paquete> paquetesFiltrados = new ArrayList<>();
        Set<String> aeropuertosInvolucrados = new HashSet<>();

        for (Paquete p : obtenerTodosLosPaquetes()) {
            if (excluirPaquetes.contains(p.getId())) continue;

            Aeropuerto aeropuertoOrigen = lastDataset.getAeropuerto(p.getOrigenOACI());
            if (aeropuertoOrigen == null) continue;

            LocalDateTime creacion = p.getInstanteCreacionUtc(aeropuertoOrigen);
            if (!creacion.isAfter(fin)) {
                paquetesFiltrados.add(p);
                aeropuertosInvolucrados.add(p.getOrigenOACI());
                aeropuertosInvolucrados.add(p.getDestinoOACI());
            }
        }

        Set<String> vuelosCanceladosOperacion = obtenerVuelosCancelados(AlmacenContexto.OPERACION);
        List<Vuelo> vuelosFiltrados = new ArrayList<>();
        LocalDateTime finVuelos = fin.plusHours(48);
        for (Vuelo v : lastDataset.getVuelos()) {
            if (vuelosCanceladosOperacion.contains(v.getId())) continue;

            LocalDateTime salida = v.getSalidaUtc();
            if (!salida.isBefore(inicio) && !salida.isAfter(finVuelos)) {
                vuelosFiltrados.add(v);
            }
        }

        Map<String, Aeropuerto> aeropuertosFiltrados = new HashMap<>();
        for (String codigo : aeropuertosInvolucrados) {
            Aeropuerto a = lastDataset.getAeropuerto(codigo);
            if (a != null) aeropuertosFiltrados.put(codigo, a);
        }

        Dataset base = new Dataset(aeropuertosFiltrados, vuelosFiltrados, paquetesFiltrados);
        return datasetContextService.construirDatasetEfectivo(AlmacenContexto.OPERACION, base);
    }

    public synchronized void actualizarEstadoOperacional(
            Solucion solucion,
            Dataset dataset,
            Config_Simulacion config
    ) {
        Map<String, Ruta> rutas = solucion.getRutasAsignadas();
        this.rutasAsignadas = new HashMap<>(rutas);
        this.estadoOperacional = PlanificacionUtils.construirEstadoConAsignaciones(rutas, dataset, config);

        Map<String, Integer> nuevoCache = new HashMap<>();
        for (Vuelo v : dataset.getVuelos()) {
            int carga = this.estadoOperacional.getCargaVuelo(v.getId());
            if (carga > 0) {
                nuevoCache.put(v.getId(), carga);
            }
        }
        this.cargaVueloCache = nuevoCache;
    }

    public synchronized Map<String, Ruta> obtenerRutasAsignadas() {
        return new HashMap<>(rutasAsignadas);
    }

    @Transactional
    public synchronized String cancelarVuelo(
            String vueloId,
            AlmacenContexto contexto,
            LocalDateTime referenciaUtc
    ) {
        if (lastDataset == null) {
            throw new IllegalStateException("No hay dataset cargado");
        }
        if (vueloId == null || vueloId.isBlank()) {
            throw new IllegalArgumentException("Se requiere vueloId para cancelar un vuelo");
        }

        LocalDateTime ahoraUtc = referenciaUtc != null ? referenciaUtc : LocalDateTime.now(ZoneOffset.UTC);
        Vuelo vueloACancelar = buscarVueloPorId(vueloId, contexto);
        if (vueloACancelar == null) {
            throw new IllegalArgumentException("No se encontro el vuelo seleccionado: " + vueloId);
        }
        if (!vueloACancelar.getSalidaUtc().isAfter(ahoraUtc)) {
            throw new IllegalArgumentException(
                    "El vuelo seleccionado ya no puede cancelarse porque su salida UTC es "
                            + vueloACancelar.getSalidaUtc()
            );
        }

        String vueloIdNormalizado = vueloACancelar.getId();
        LocalTime horaSalidaLocal = vueloACancelar.getSalidaUtc()
                .plusMinutes(vueloACancelar.getOrigen().getGmtOffsetMinutos())
                .toLocalTime();
        if (vueloCanceladoRepository.findByContextoAndVueloId(contexto, vueloIdNormalizado).isEmpty()) {
            vueloCanceladoRepository.save(VueloCancelado.builder()
                    .contexto(contexto)
                    .vueloId(vueloIdNormalizado)
                    .origenOACI(vueloACancelar.getOrigen().getCodigoOACI())
                    .destinoOACI(vueloACancelar.getDestino().getCodigoOACI())
                    .salidaUtc(vueloACancelar.getSalidaUtc())
                    .horaSalidaLocal(horaSalidaLocal)
                    .createdAt(LocalDateTime.now(ZoneOffset.UTC))
                    .build());
        }
        System.out.println("[CargaArchivosService] Vuelo cancelado: " + vueloACancelar.getId()
                + " (salida UTC: " + vueloACancelar.getSalidaUtc() + ")");
        contextSyncStateService.touch(contexto, "vuelo-cancelado");
        return vueloIdNormalizado;
    }

    @Transactional
    public synchronized String descancelarVuelo(String vueloId, AlmacenContexto contexto) {
        VueloCancelado cancelado = vueloCanceladoRepository.findByContextoAndVueloId(contexto, vueloId)
                .orElseThrow(() -> new IllegalArgumentException("El vuelo " + vueloId + " no esta cancelado en el contexto " + contexto));
        vueloCanceladoRepository.delete(cancelado);
        contextSyncStateService.touch(contexto, "vuelo-descancelado");
        return vueloId;
    }

    private Vuelo buscarVueloPorId(String vueloId, AlmacenContexto contexto) {
        Dataset datasetEfectivo = datasetContextService.construirDatasetEfectivo(contexto, lastDataset);
        if (datasetEfectivo == null) {
            return null;
        }
        for (Vuelo v : datasetEfectivo.getVuelos()) {
            if (v.getId().equals(vueloId)) {
                return v;
            }
        }
        return null;
    }

    public synchronized Set<String> obtenerVuelosCancelados() {
        return obtenerVuelosCancelados(AlmacenContexto.OPERACION);
    }

    public synchronized Set<String> obtenerVuelosCancelados(AlmacenContexto contexto) {
        return vueloCanceladoRepository.findAllByContextoOrderBySalidaUtcAsc(contexto).stream()
                .map(VueloCancelado::getVueloId)
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private Dataset construirDatasetPlanificable(AlmacenContexto contexto, Dataset base) {
        Dataset datasetEfectivo = datasetContextService.construirDatasetEfectivo(contexto, base);
        if (datasetEfectivo == null) {
            return new Dataset(Map.of(), List.of(), List.of());
        }

        Set<String> vuelosCancelados = obtenerVuelosCancelados(contexto);
        if (vuelosCancelados.isEmpty()) {
            return datasetEfectivo;
        }

        List<Vuelo> vuelosDisponibles = datasetEfectivo.getVuelos().stream()
                .filter(vuelo -> !vuelosCancelados.contains(vuelo.getId()))
                .toList();

        return new Dataset(
                datasetEfectivo.getAeropuertos(),
                vuelosDisponibles,
                datasetEfectivo.getPaquetes()
        );
    }

    public synchronized boolean estaVueloCancelado(String vueloId, AlmacenContexto contexto) {
        return vueloCanceladoRepository.findByContextoAndVueloId(contexto, vueloId).isPresent();
    }

    @Transactional
    public synchronized void limpiarVuelosCancelados(AlmacenContexto contexto) {
        vueloCanceladoRepository.deleteAllByContexto(contexto);
        contextSyncStateService.touch(contexto, "vuelos-cancelados-limpiados");
    }

    public synchronized List<Paquete> agregarEnvios(List<EnvioEntrada> envios) {
        if (lastDataset == null) {
            throw new IllegalStateException("No hay dataset cargado");
        }

        List<Paquete> nuevos = new ArrayList<>();
        for (EnvioEntrada e : envios) {
            Aeropuerto origenAp = lastDataset.getAeropuerto(e.origen());
            if (origenAp == null) {
                throw new IllegalArgumentException("Aeropuerto origen no encontrado: " + e.origen());
            }
            Aeropuerto destinoAp = lastDataset.getAeropuerto(e.destino());
            if (destinoAp == null) {
                throw new IllegalArgumentException("Aeropuerto destino no encontrado: " + e.destino());
            }

            Aeropuerto remitenteAp = null;
            if (e.remitente() != null && !e.remitente().isEmpty()) {
                remitenteAp = lastDataset.getAeropuerto(e.remitente());
                if (remitenteAp == null) {
                    throw new IllegalArgumentException("Aeropuerto del remitente no encontrado: " + e.remitente());
                }
            }

            LocalDateTime utc;
            if (remitenteAp != null) {
                LocalDateTime horaRemitente = LocalDateTime.of(e.fecha(), e.hora());
                LocalDateTime horaUtc = horaRemitente.minusMinutes(remitenteAp.getGmtOffsetMinutos());
                LocalDateTime horaOrigenLocal = horaUtc.plusMinutes(origenAp.getGmtOffsetMinutos());
                utc = horaOrigenLocal.minusMinutes(origenAp.getGmtOffsetMinutos());
            } else {
                utc = origenAp.convertirLocalAUTC(e.fecha(), e.hora());
            }

            contadorPaquetesIncrementales++;
            String id = "INC-" + contadorPaquetesIncrementales + "-" + e.origen() + "-" + e.destino();

            String clienteId = (e.clienteId() == null || e.clienteId().isBlank())
                    ? CLIENTE_PRUEBA_OPERACION_DIARIA
                    : e.clienteId().trim();

            Paquete paquete = crearPaqueteCompat(
                    id,
                    e.origen(),
                    utc.toLocalDate(),
                    utc.toLocalTime(),
                    e.destino(),
                    e.cantidad(),
                    "",
                    clienteId,
                    true
            );
            nuevos.add(paquete);
        }

        List<Paquete> listaActualizada = new ArrayList<>(paquetesIncrementales);
        listaActualizada.addAll(nuevos);
        this.paquetesIncrementales = listaActualizada;

        System.out.println("[CargaArchivosService] Envios incrementales agregados: " + nuevos.size()
                + ". Total acumulados: " + paquetesIncrementales.size());

        return nuevos;
    }

    public synchronized List<Paquete> cargarEnviosDesdeArchivo(MultipartFile archivo, String origenOaci) throws IOException {
        if (lastDataset == null) {
            throw new IllegalStateException("No hay dataset cargado");
        }

        String origenNormalizado = normalizarOrigenEnvios(origenOaci);
        Aeropuerto origen = lastDataset.getAeropuerto(origenNormalizado);
        if (origen == null) {
            throw new IllegalStateException("Aeropuerto " + origenNormalizado + " no encontrado en el dataset");
        }

        List<Paquete> nuevos = new ArrayList<>();

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(archivo.getInputStream(), StandardCharsets.UTF_8))) {
            String linea;
            while ((linea = reader.readLine()) != null) {
                linea = linea.trim();
                if (linea.isEmpty()) continue;

                Paquete parsed = Paquete.parse(linea, origenNormalizado);
                if (!lastDataset.getAeropuertos().containsKey(parsed.getDestinoOACI())) continue;

                LocalDateTime utc = origen.convertirLocalAUTC(parsed.getFecha(), parsed.getHora());

                contadorPaquetesIncrementales++;
                String id = "INC-" + contadorPaquetesIncrementales + "-" + origenNormalizado + "-" + parsed.getDestinoOACI();

                Paquete paquete = crearPaqueteCompat(
                        id,
                        origenNormalizado,
                        utc.toLocalDate(),
                        utc.toLocalTime(),
                        parsed.getDestinoOACI(),
                        parsed.getCantidad(),
                        parsed.getReferencia(),
                        obtenerClienteIdCompat(parsed),
                        true
                );
                nuevos.add(paquete);
            }
        }

        List<Paquete> listaActualizada = new ArrayList<>(paquetesIncrementales);
        listaActualizada.addAll(nuevos);
        this.paquetesIncrementales = listaActualizada;
        this.usarPaquetesBaseEnOperacion = false;

        System.out.println("[CargaArchivosService] Envios cargados desde archivo: " + nuevos.size()
                + ". Total acumulados: " + paquetesIncrementales.size());

        if (lastDataset != null) {
            lanzarPlanificacionEnBackground(lastDataset);
        }
        return nuevos;
    }

    private String normalizarOrigenEnvios(String origenOaci) {
        if (origenOaci == null || origenOaci.isBlank()) {
            throw new IllegalArgumentException("El aeropuerto origen detectado es obligatorio");
        }
        String origenNormalizado = origenOaci.trim().toUpperCase();
        if (!origenNormalizado.matches("[A-Z0-9]{4}")) {
            throw new IllegalArgumentException("Aeropuerto origen invalido: " + origenOaci);
        }
        return origenNormalizado;
    }

    public synchronized List<Paquete> obtenerPaquetesIncrementales() {
        return new ArrayList<>(paquetesIncrementales);
    }

    public synchronized boolean usaPaquetesBaseEnOperacion() {
        return usarPaquetesBaseEnOperacion;
    }

    public synchronized void limpiarOperacionDiaria() {
        this.paquetesIncrementales = new ArrayList<>();
        this.contadorPaquetesIncrementales = 0;
        this.usarPaquetesBaseEnOperacion = false;
        this.rutasAsignadas = new HashMap<>();
        this.rutasAnteriores = new HashMap<>();
        this.asignacionesSplit = new HashMap<>();
        this.estadoOperacional = null;
        this.cargaVueloCache = null;
        this.planificando = false;
        contextSyncStateService.touch(AlmacenContexto.OPERACION, "operacion-diaria-limpiada");
    }

    public synchronized Map<String, Object> buscarEnvio(String id) {
        if (lastDataset == null) return null;

        Paquete paquete = null;
        for (Paquete p : lastDataset.getPaquetes()) {
            if (p.getId().equals(id)) { paquete = p; break; }
        }
        if (paquete == null) {
            for (Paquete p : paquetesIncrementales) {
                if (p.getId().equals(id)) { paquete = p; break; }
            }
        }
        if (paquete == null) return null;

        LocalDateTime ahoraUtc = LocalDateTime.now(ZoneOffset.UTC);
        Ruta ruta = rutasAsignadas.get(paquete.getId());
        Ruta rutaAnterior = rutasAnteriores.get(paquete.getId());
        EstadoEnvio e = computarEstado(paquete, ruta, ahoraUtc);

        Map<String, Object> result = new HashMap<>();
        result.put("id", paquete.getId());
        result.put("origen", paquete.getOrigenOACI());
        result.put("destino", paquete.getDestinoOACI());
        result.put("estado", e.estado());
        result.put("aeropuertoActual", e.aeropuertoActual());
        result.put("vueloEsperado", e.vueloEsperado());
        result.put("vueloActual", e.vueloActual());
        result.put("rutaAeropuertos", construirRutaAeropuertos(paquete, ruta));
        result.put("rutaVuelos", construirRutaVuelos(ruta));
        result.put("rutaAnteriorAeropuertos", rutaAnterior != null ? construirRutaAeropuertos(paquete, rutaAnterior) : null);
        result.put("rutaAnteriorVuelos", rutaAnterior != null ? construirRutaVuelos(rutaAnterior) : null);
        result.put("cantidad", paquete.getCantidad());
        result.put("clienteId", obtenerClienteIdCompat(paquete));
        return result;
    }

    public synchronized List<Map<String, Object>> buscarEnvios(String searchTerm) {
        List<Map<String, Object>> resultados = new ArrayList<>();
        if (lastDataset == null || searchTerm == null || searchTerm.isEmpty()) {
            return resultados;
        }

        String term = searchTerm.toLowerCase();
        List<Paquete> todos = obtenerTodosLosPaquetes();

        for (Paquete p : todos) {
            if (p.getId().toLowerCase().contains(term)) {
                Map<String, Object> info = buscarEnvio(p.getId());
                if (info != null) {
                    resultados.add(info);
                }
            }
            if (resultados.size() >= 20) break;
        }
        return resultados;
    }

    public synchronized List<Map<String, Object>> listarMaletas(
            String estados,
            String origen,
            Integer horas
    ) {
        List<Map<String, Object>> resultados = new ArrayList<>();
        if (lastDataset == null) return resultados;

        Set<String> estadosSet = (estados == null || estados.isEmpty())
                ? Set.of("EN_ESPERA", "EMBARCADO", "EN_VUELO", "ENTREGADO")
                : Set.of(estados.split(","));

        LocalDateTime ahoraUtc = LocalDateTime.now(ZoneOffset.UTC);
        for (Paquete p : obtenerTodosLosPaquetes()) {
            if (origen != null && !origen.isEmpty() && !p.getOrigenOACI().equals(origen)) continue;
            for (Map<String, Object> maleta : construirMaletasPaquete(p, ahoraUtc)) {
                String estado = (String) maleta.get("estado");
                if (!estadosSet.contains(estado)) continue;
                if ("ENTREGADO".equals(estado) && horas != null && horas > 0) {
                    String ultimaLlegada = (String) maleta.get("ultimaLlegadaUtc");
                    if (ultimaLlegada != null) {
                        long diffHoras = Duration.between(LocalDateTime.parse(ultimaLlegada), ahoraUtc).toHours();
                        if (diffHoras > horas) continue;
                    }
                }
                resultados.add(maleta);
            }
        }

        return resultados;
    }

    public synchronized List<Map<String, Object>> listarEnvios(
            String estados,
            String origen,
            Integer horas
    ) {
        List<Map<String, Object>> resultados = new ArrayList<>();
        if (lastDataset == null) return resultados;

        Set<String> estadosSet = (estados == null || estados.isEmpty())
                ? Set.of("EN_ESPERA", "EMBARCADO", "EN_VUELO", "ENTREGADO")
                : Set.of(estados.split(","));

        LocalDateTime ahoraUtc = LocalDateTime.now(ZoneOffset.UTC);
        List<Paquete> todos = obtenerTodosLosPaquetes();

        for (Paquete p : todos) {
            if (origen != null && !origen.isEmpty() && !p.getOrigenOACI().equals(origen)) continue;

            Ruta ruta = rutasAsignadas.get(p.getId());
            Ruta rutaAnterior = rutasAnteriores.get(p.getId());
            EstadoEnvio e = computarEstado(p, ruta, ahoraUtc);

            if (!estadosSet.contains(e.estado())) continue;

            if ("ENTREGADO".equals(e.estado()) && horas != null && horas > 0 && e.ultimaLlegada() != null) {
                long diffHoras = Duration.between(e.ultimaLlegada(), ahoraUtc).toHours();
                if (diffHoras > horas) continue;
            }

            Map<String, Object> envio = new HashMap<>();
            envio.put("id", p.getId());
            envio.put("origen", p.getOrigenOACI());
            envio.put("destino", p.getDestinoOACI());
            envio.put("estado", e.estado());
            envio.put("aeropuertoActual", e.aeropuertoActual());
            envio.put("vueloEsperado", e.vueloEsperado());
            envio.put("vueloActual", e.vueloActual());
            envio.put("rutaAeropuertos", construirRutaAeropuertos(p, ruta));
            envio.put("rutaVuelos", construirRutaVuelos(ruta));
            envio.put("rutaAnteriorAeropuertos", rutaAnterior != null ? construirRutaAeropuertos(p, rutaAnterior) : null);
            envio.put("rutaAnteriorVuelos", rutaAnterior != null ? construirRutaVuelos(rutaAnterior) : null);
            envio.put("cantidad", p.getCantidad());
            envio.put("clienteId", obtenerClienteIdCompat(p));
            resultados.add(envio);
        }

        return resultados;
    }

    public record EnvioEntrada(
            String origen,
            String destino,
            LocalDate fecha,
            LocalTime hora,
            int cantidad,
            String remitente,
            String clienteId
    ) {}
}
