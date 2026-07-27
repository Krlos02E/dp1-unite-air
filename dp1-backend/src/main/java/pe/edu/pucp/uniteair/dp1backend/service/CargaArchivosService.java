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
import tasf.strategy.alns.ALNS_Strategy;

import java.time.Duration;
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
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Service
public class CargaArchivosService {
    public static final String CLIENTE_PRUEBA_OPERACION_DIARIA = "0007729";
    private static final long REPLAN_OPERACION_INTERVAL_MS = 15_000L;
    private static final long TIEMPO_RECOGIDA_DESTINO_MINUTOS = 15L;

    private Dataset lastDataset;
    private Dataset datasetBaseOperacion;
    private volatile EstadoOperacional estadoOperacional;
    private volatile Map<String, Integer> cargaVueloCache;
    private volatile Map<String, Ruta> rutasAsignadas = new HashMap<>();
    private volatile Map<String, Ruta> rutasAnteriores = new HashMap<>();
    private volatile Map<String, AsignacionPaquete> asignacionesSplit = new HashMap<>();
    private volatile boolean planificando = false;
    private volatile boolean replanificacionPendiente = false;
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
    private final RelojOperativoService relojOperativoService;

    public CargaArchivosService(DatasetContextService datasetContextService,
                                VueloCanceladoRepository vueloCanceladoRepository,
                                ContextSyncStateService contextSyncStateService,
                                RelojOperativoService relojOperativoService) {
        this.datasetContextService = datasetContextService;
        this.vueloCanceladoRepository = vueloCanceladoRepository;
        this.contextSyncStateService = contextSyncStateService;
        this.relojOperativoService = relojOperativoService;
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
            Dataset dataset = crearDatasetBaseOperacionActual();
            this.lastDataset = dataset;
            this.datasetBaseOperacion = clonarDataset(dataset);
            this.estadoOperacional = null;
            this.cargaVueloCache = null;
            this.rutasAsignadas = new HashMap<>();
            this.rutasAnteriores = new HashMap<>();
            this.asignacionesSplit = new HashMap<>();
            this.planificando = false;
            this.replanificacionPendiente = false;
            this.usarPaquetesBaseEnOperacion = false;
            fijarReferenciaOperativa(dataset);
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
            this.replanificacionPendiente = false;
            this.usarPaquetesBaseEnOperacion = false;
            fijarReferenciaOperativa(dataset);
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
        if (planificando) {
            replanificacionPendiente = true;
            return;
        }
        planificando = true;
        replanificacionPendiente = false;
        Dataset datasetOperacion = construirDatasetPlanificable(AlmacenContexto.OPERACION, dataset);
        executor.submit(() -> {
            try {
                planificarDataset(datasetOperacion);
            } finally {
                planificando = false;
                if (replanificacionPendiente && lastDataset != null) {
                    replanificacionPendiente = false;
                    lanzarPlanificacionEnBackground(lastDataset);
                }
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
        copiarRecursosACarpeta(destino, true, true);
    }

    private void copiarRecursosACarpeta(Path destino, boolean incluirVuelosBase, boolean incluirEnviosBase) throws IOException {
        copiarRecurso("default-data/input/aeropuertos/c.1inf54.26.1.v1.Aeropuerto.husos.v1.20250818__estudiantes.txt",
                destino.resolve("input/aeropuertos/c.Aeropuerto.txt"));
        if (incluirVuelosBase) {
            copiarRecurso("default-data/input/vuelos/planes_vuelo.txt",
                    destino.resolve("input/vuelos/planes_vuelo.txt"));
        }
        if (incluirEnviosBase) {
            for (String icao : ICAO_ENVIOS) {
                copiarRecurso("default-data/input/envios/_envios_" + icao + "_.txt",
                        destino.resolve("input/envios/_envios_" + icao + "_.txt"));
            }
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

    private void prepararDatasetOperacionVacio(Path destino) throws IOException {
        copiarRecursosACarpeta(destino, false, false);
        Path vuelos = destino.resolve("input/vuelos/planes_vuelo.txt");
        Path envios = destino.resolve("input/envios");
        Files.createDirectories(vuelos.getParent());
        Files.createDirectories(envios);
        if (!Files.exists(vuelos)) {
            Files.writeString(vuelos, "", StandardCharsets.UTF_8);
        }
    }

    public synchronized CargaResult cargarArchivos(
            MultipartFile planesVuelo,
            MultipartFile aeropuertosFile,
            MultipartFile envios,
            String origenEnviosOaci,
            String timezoneCanonica
    ) {
        try {
            Path tempDir = Files.createTempDirectory("carga_");
            copiarRecursosACarpeta(tempDir, true, false);
            Files.createDirectories(tempDir.resolve("input").resolve("envios"));
            Path planesVueloPath = null;
            Path aeropuertosPath = null;
            Path enviosPath = null;
            if (planesVuelo != null && !planesVuelo.isEmpty()) {
                planesVueloPath = saveToTemp(tempDir.resolve("input").resolve("vuelos"), planesVuelo, "planes_vuelo.txt");
            }
            if (aeropuertosFile != null && !aeropuertosFile.isEmpty()) {
                aeropuertosPath = saveToTemp(tempDir.resolve("input").resolve("aeropuertos"), aeropuertosFile, "aeropuerto.txt");
            }
            if (envios != null && !envios.isEmpty()) {
                String origenNormalizado = normalizarOrigenEnvios(origenEnviosOaci);
                enviosPath = saveToTemp(tempDir.resolve("input").resolve("envios"), envios, "_envios_" + origenNormalizado + "_.txt");
            }

            ZoneId zonaOperacion = resolverZonaOperacion(timezoneCanonica);
            LocalDate fechaInicio = LocalDate.now(zonaOperacion);
            Set<LocalDate> fechasFiltro = generarFechasSimulacion(fechaInicio, 3);
            Dataset datasetCargado = DatasetTextoLoader.cargarDataset(tempDir, fechaInicio, 3, 50000, fechasFiltro);
            if (envios != null && !envios.isEmpty()) {
                String origenNormalizado = normalizarOrigenEnvios(origenEnviosOaci);
                List<Paquete> paquetesArchivo = parsearPaquetesCargaCompleta(
                        envios,
                        origenNormalizado,
                        datasetCargado.getAeropuertos()
                );
                validarCapacidadDisponibleLote(paquetesArchivo);
                datasetCargado = new Dataset(
                        datasetCargado.getAeropuertos(),
                        datasetCargado.getVuelos(),
                        paquetesArchivo
                );
            }
            Dataset dataset = fusionarDatasetOperativo(datasetCargado);

            int aeropuertosCount = contarRegistrosArchivo(aeropuertosPath);
            int vuelosCount = contarRegistrosArchivo(planesVueloPath);
            int paquetesCount = contarRegistrosArchivo(enviosPath);

            String datasetId = UUID.randomUUID().toString();
            this.lastDataset = dataset;
            this.estadoOperacional = null;
            this.cargaVueloCache = null;
            this.rutasAsignadas = new HashMap<>();
            this.rutasAnteriores = new HashMap<>();
            this.asignacionesSplit = new HashMap<>();
            this.planificando = false;
            this.replanificacionPendiente = false;
            this.paquetesIncrementales = new ArrayList<>();
            this.usarPaquetesBaseEnOperacion = true;
            fijarReferenciaOperativa(dataset);

            lanzarPlanificacionEnBackground(dataset);

            deleteTempDir(tempDir);

            return new CargaResult(true, "Archivos cargados exitosamente", aeropuertosCount, vuelosCount, paquetesCount, datasetId);
        } catch (Exception e) {
            return new CargaResult(false, construirMensajeErrorCarga(e), 0, 0, 0, null);
        }
    }

    private String construirMensajeErrorCarga(Exception error) {
        String detalle = error != null && error.getMessage() != null ? error.getMessage().trim() : "";
        if (detalle.contains("No se pudo detectar estructura de datos valida")) {
            return "No se pudo procesar la carga. Si subes vuelos, usa un archivo .txt valido para planes_vuelo. "
                    + "Si subes envios, usa un archivo .txt valido de envios.";
        }
        if (detalle.isBlank()) {
            return "No se pudieron cargar los archivos. Revisa el formato e intentalo otra vez.";
        }
        return "No se pudieron cargar los archivos: " + detalle;
    }

    private ZoneId resolverZonaOperacion(String timezoneCanonica) {
        if (timezoneCanonica == null || timezoneCanonica.isBlank()) {
            return ZoneId.of("UTC");
        }
        return ZoneId.of(timezoneCanonica);
    }

    private Dataset fusionarDatasetOperativo(Dataset datasetCargado) {
        if (datasetCargado == null) {
            return lastDataset;
        }

        Map<String, Aeropuerto> aeropuertosFusionados = new LinkedHashMap<>();
        if (lastDataset != null && lastDataset.getAeropuertos() != null) {
            aeropuertosFusionados.putAll(lastDataset.getAeropuertos());
        }
        if (datasetCargado.getAeropuertos() != null) {
            aeropuertosFusionados.putAll(datasetCargado.getAeropuertos());
        }

        Map<String, Vuelo> vuelosFusionados = new LinkedHashMap<>();
        if (lastDataset != null && lastDataset.getVuelos() != null) {
            for (Vuelo vuelo : lastDataset.getVuelos()) {
                vuelosFusionados.put(vuelo.getId(), vuelo);
            }
        }
        if (datasetCargado.getVuelos() != null) {
            for (Vuelo vuelo : datasetCargado.getVuelos()) {
                vuelosFusionados.put(vuelo.getId(), vuelo);
            }
        }

        List<Paquete> paquetesExistentes = combinarPaquetes(
                obtenerPaquetesBaseOperacion(),
                paquetesIncrementales
        );
        List<Paquete> paquetesFusionados = combinarPaquetes(
                paquetesExistentes,
                datasetCargado.getPaquetes() != null ? datasetCargado.getPaquetes() : List.of()
        );

        return new Dataset(
                aeropuertosFusionados,
                new ArrayList<>(vuelosFusionados.values()),
                paquetesFusionados
        );
    }

    private Dataset clonarDataset(Dataset dataset) {
        if (dataset == null) {
            return null;
        }
        return new Dataset(
                dataset.getAeropuertos(),
                dataset.getVuelos(),
                dataset.getPaquetes()
        );
    }

    private List<Paquete> parsearPaquetesCargaCompleta(
            MultipartFile archivo,
            String origenOaci,
            Map<String, Aeropuerto> aeropuertos
    ) throws IOException {
        Aeropuerto origen = aeropuertos != null ? aeropuertos.get(origenOaci) : null;
        if (origen == null) {
            throw new IllegalStateException("Aeropuerto " + origenOaci + " no encontrado en el dataset para cargar envios");
        }

        List<Paquete> paquetes = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(archivo.getInputStream(), StandardCharsets.UTF_8))) {
            String linea;
            while ((linea = reader.readLine()) != null) {
                linea = linea.trim();
                if (linea.isEmpty()) {
                    continue;
                }

                Paquete parsed = Paquete.parse(linea, origenOaci);
                if (!aeropuertos.containsKey(parsed.getDestinoOACI())) {
                    continue;
                }

                LocalDateTime utc = origen.convertirLocalAUTC(parsed.getFecha(), parsed.getHora());
                String idUnico = origenOaci + "-" + parsed.getId();
                paquetes.add(crearPaqueteCompat(
                        idUnico,
                        parsed.getOrigenOACI(),
                        utc.toLocalDate(),
                        utc.toLocalTime(),
                        parsed.getDestinoOACI(),
                        parsed.getCantidad(),
                        parsed.getReferencia(),
                        obtenerClienteIdCompat(parsed),
                        false
                ));
            }
        }
        return paquetes;
    }

    private int contarRegistrosArchivo(Path archivo) throws IOException {
        if (archivo == null || !Files.exists(archivo)) {
            return 0;
        }
        try (BufferedReader reader = Files.newBufferedReader(archivo, StandardCharsets.UTF_8)) {
            int count = 0;
            String line;
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.isEmpty() || trimmed.startsWith("**")) {
                    continue;
                }
                count++;
            }
            return count;
        }
    }

    public synchronized Dataset obtenerUltimoDataset() {
        return lastDataset;
    }

    public synchronized void restaurarDatasetBaseOperacion() {
        try {
            Dataset dataset = crearDatasetBaseOperacionActual();
            this.datasetBaseOperacion = clonarDataset(dataset);
            this.lastDataset = clonarDataset(datasetBaseOperacion);
        } catch (Exception e) {
            System.err.println("No se pudo restaurar dataset base de operacion: " + e.getMessage());
            return;
        }
        this.paquetesIncrementales = new ArrayList<>();
        this.contadorPaquetesIncrementales = 0;
        this.usarPaquetesBaseEnOperacion = false;
        this.rutasAsignadas = new HashMap<>();
        this.rutasAnteriores = new HashMap<>();
        this.asignacionesSplit = new HashMap<>();
        this.estadoOperacional = null;
        this.cargaVueloCache = null;
        this.planificando = false;
        this.replanificacionPendiente = false;
        contextSyncStateService.touch(AlmacenContexto.OPERACION, "operacion-base-restaurada");
    }

    private Dataset crearDatasetBaseOperacionActual() throws IOException {
        Path tempDir = Files.createTempDirectory("default_carga_");
        try {
            copiarRecursosACarpeta(tempDir, true, false);
            Files.createDirectories(tempDir.resolve("input/envios"));
            LocalDate fechaInicioUtc = relojOperativoService.obtenerTiempoActualUtc().toLocalDate().minusDays(2);
            return cargarDatasetEnTemp(tempDir, fechaInicioUtc, 3);
        } finally {
            deleteTempDir(tempDir);
        }
    }

    public synchronized void replanificarOperacionActual() {
        if (lastDataset == null) {
            return;
        }
        lanzarPlanificacionEnBackground(lastDataset);
    }

    private void marcarReplanificacionOperacionPendiente() {
        if (lastDataset == null) {
            return;
        }
        replanificacionPendiente = true;
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
            Config_Simulacion config = crearConfigPlanificacion();
            LocalDateTime ahoraUtc = obtenerTiempoOperativoActualUtc();
            Dataset datasetGestion = new Dataset(
                    dataset.getAeropuertos(),
                    dataset.getVuelos(),
                    paquetes
            );

            Map<String, Ruta> rutasPreservadas = new HashMap<>();
            List<Paquete> pendientes = new ArrayList<>();
            for (Paquete paquete : paquetes) {
                Ruta rutaActual = rutasAsignadas.get(paquete.getId());
                EstadoEnvio estadoActual = computarEstadoEfectivoPaquete(paquete, ahoraUtc);
                if ("EN_VUELO".equals(estadoActual.estado())
                        || "ENTREGADO".equals(estadoActual.estado())
                        || estaEsperandoRecogidaEnDestinoFinal(paquete, estadoActual)) {
                    if (rutaActual != null) {
                        rutasPreservadas.put(paquete.getId(), rutaActual);
                    }
                } else {
                    pendientes.add(paquete);
                }
            }

            Map<String, Ruta> rutasResultado = new HashMap<>(rutasPreservadas);
            Map<String, AsignacionPaquete> asignacionesResultado = new HashMap<>();
            for (Paquete paquete : paquetes) {
                if (!rutasPreservadas.containsKey(paquete.getId())) {
                    continue;
                }
                AsignacionPaquete asignacionActual = this.asignacionesSplit.get(paquete.getId());
                if (asignacionActual != null && !asignacionActual.isEmpty()) {
                    asignacionesResultado.put(paquete.getId(), asignacionActual.copia());
                    continue;
                }
                Ruta rutaPreservada = rutasPreservadas.get(paquete.getId());
                if (rutaPreservada != null) {
                    asignacionesResultado.put(paquete.getId(), new AsignacionPaquete(rutaPreservada, paquete.getCantidad()));
                }
            }
            if (!pendientes.isEmpty()) {
                Dataset datasetPendientes = new Dataset(
                        dataset.getAeropuertos(),
                        dataset.getVuelos(),
                        pendientes
                );
                PlanificacionUtils.limpiarCacheGlobal();
                Solucion solucion = new ALNS_Strategy().planificar(datasetPendientes, config);
                asignacionesResultado.putAll(solucion.getAsignacionesSplit());
                rutasResultado.putAll(solucion.getRutasAsignadas());
            }

            EstadoOperativoSnapshot snapshot = construirSnapshotOperativo(
                    rutasResultado,
                    asignacionesResultado,
                    datasetGestion,
                    config,
                    false
            );
            aplicarSnapshotOperativo(snapshot);
            System.out.println("[CargaArchivosService] Planificación completada. Rutas: " + rutasResultado.size()
                    + ", preservadas: " + rutasPreservadas.size()
                    + ", pendientes: " + pendientes.size()
                    + ", CargaVuelo entries: " + snapshot.cargaVueloCache().size());
        } catch (Exception e) {
            System.err.println("[CargaArchivosService] Error en planificación: " + e.getMessage());
            e.printStackTrace();
            this.estadoOperacional = new EstadoOperacional();
            this.cargaVueloCache = new HashMap<>();
        }
    }

    private Config_Simulacion crearConfigPlanificacion() {
        Config_Simulacion config = new Config_Simulacion();
        config.setAeropuertoHub("SKBO");
        config.setMinimaConexion(java.time.Duration.ofMinutes(10));
        config.setIteracionesALNS(20);
        config.setMaxRutasPorPaquete(12);
        config.setMaxEscalas(2);
        config.setVentanaActualizacionPesos(5);
        config.setEvaporacionFeromona(0.4);
        return config;
    }

    private record EstadoEnvio(
        String estado,
        String aeropuertoActual,
        String vueloActual,
        String vueloEsperado,
        LocalDateTime ultimaLlegada
    ) {}

    private record ResumenEnvioVista(
        EstadoEnvio estado,
        List<String> rutaAeropuertos,
        List<String> rutaVuelos
    ) {}

    private record EstadoOperativoSnapshot(
        Map<String, Ruta> rutasAsignadas,
        Map<String, AsignacionPaquete> asignacionesSplit,
        Map<String, Ruta> rutasAnteriores,
        EstadoOperacional estadoOperacional,
        Map<String, Integer> cargaVueloCache
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
        LocalDateTime tiempoEntrega = ultimaLlegada.plusMinutes(TIEMPO_RECOGIDA_DESTINO_MINUTOS);
        if (ahoraUtc.isAfter(tiempoEntrega)) {
            return new EstadoEnvio(
                "ENTREGADO",
                paquete.getDestinoOACI(),
                null, null,
                ultimaLlegada
            );
        }

        if (!ahoraUtc.isBefore(ultimaLlegada)) {
            return new EstadoEnvio(
                "EN_ESPERA",
                paquete.getDestinoOACI(),
                null,
                null,
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

    private boolean estaEsperandoRecogidaEnDestinoFinal(Paquete paquete, EstadoEnvio estado) {
        if (paquete == null || estado == null) {
            return false;
        }
        return "EN_ESPERA".equals(estado.estado())
                && paquete.getDestinoOACI().equals(estado.aeropuertoActual())
                && estado.ultimaLlegada() != null;
    }

    private ResumenEnvioVista construirResumenEnvioVista(Paquete paquete, LocalDateTime ahoraUtc) {
        return construirResumenEnvioVista(paquete, ahoraUtc, null);
    }

    private EstadoEnvio computarEstadoEfectivoPaquete(Paquete paquete, LocalDateTime ahoraUtc) {
        return construirResumenEnvioVista(paquete, ahoraUtc).estado();
    }

    private boolean debeCongelarPaquete(Paquete paquete, LocalDateTime ahoraUtc) {
        EstadoEnvio estado = computarEstadoEfectivoPaquete(paquete, ahoraUtc);
        return "EN_VUELO".equals(estado.estado())
                || "ENTREGADO".equals(estado.estado())
                || estaEsperandoRecogidaEnDestinoFinal(paquete, estado);
    }

    private ResumenEnvioVista construirResumenEnvioVista(
            Paquete paquete,
            LocalDateTime ahoraUtc,
            Map<String, Vuelo> vuelosOperacion
    ) {
        Ruta rutaPrincipal = rutasAsignadas.get(paquete.getId());
        AsignacionPaquete asignacion = asignacionesSplit.get(paquete.getId());

        if (asignacion == null || asignacion.isEmpty()) {
            EstadoEnvio estado = computarEstado(paquete, rutaPrincipal, ahoraUtc);
            return new ResumenEnvioVista(
                    estado,
                    construirRutaAeropuertos(paquete, rutaPrincipal),
                    construirRutaVuelos(rutaPrincipal)
            );
        }

        int cantidadAsignada = Math.min(paquete.getCantidad(), asignacion.cantidadAsignada());
        int cantidadSinAsignar = Math.max(0, paquete.getCantidad() - cantidadAsignada);
        int enVuelo = 0;
        int embarcado = 0;
        int entregado = 0;
        int enEspera = cantidadSinAsignar;
        LocalDateTime ultimaLlegada = null;
        LinkedHashSet<String> vuelosRuta = new LinkedHashSet<>();
        LinkedHashSet<String> aeropuertosRuta = new LinkedHashSet<>();
        aeropuertosRuta.add(paquete.getOrigenOACI());
        LinkedHashSet<String> vuelosActuales = new LinkedHashSet<>();
        LinkedHashSet<String> vuelosEsperados = new LinkedHashSet<>();

        for (RutaConCantidad rc : asignacion.getRutas()) {
            EstadoEnvio estadoSubruta = computarEstado(paquete, rc.getRuta(), ahoraUtc);
            int cantidad = rc.getCantidad();
            if ("EN_VUELO".equals(estadoSubruta.estado())) {
                enVuelo += cantidad;
            } else if ("EMBARCADO".equals(estadoSubruta.estado())) {
                embarcado += cantidad;
            } else if ("ENTREGADO".equals(estadoSubruta.estado())) {
                entregado += cantidad;
            } else {
                enEspera += cantidad;
            }

            if (estadoSubruta.vueloActual() != null) {
                vuelosActuales.add(estadoSubruta.vueloActual());
            }
            if (estadoSubruta.vueloEsperado() != null) {
                vuelosEsperados.add(estadoSubruta.vueloEsperado());
            }
            if (estadoSubruta.ultimaLlegada() != null
                    && (ultimaLlegada == null || estadoSubruta.ultimaLlegada().isAfter(ultimaLlegada))) {
                ultimaLlegada = estadoSubruta.ultimaLlegada();
            }

            Ruta ruta = rc.getRuta();
            if (ruta != null) {
                for (Vuelo vuelo : ruta.getVuelos()) {
                    aeropuertosRuta.add(vuelo.getOrigen().getCodigoOACI());
                    aeropuertosRuta.add(vuelo.getDestino().getCodigoOACI());
                    vuelosRuta.add(vuelo.getId());
                }
            }
        }
        aeropuertosRuta.add(paquete.getDestinoOACI());

        EstadoEnvio resumen;
        if (entregado == paquete.getCantidad()) {
            resumen = new EstadoEnvio("ENTREGADO", paquete.getDestinoOACI(), null, null, ultimaLlegada);
        } else if (enVuelo > 0) {
            String vueloActual = vuelosActuales.size() == 1 ? vuelosActuales.iterator().next() : null;
            String aeropuertoActual = paquete.getOrigenOACI();
            if (vueloActual != null) {
                Vuelo vuelo = resolverVueloOperacion(vueloActual, vuelosOperacion);
                if (vuelo != null) {
                    aeropuertoActual = vuelo.getOrigen().getCodigoOACI();
                }
            }
            resumen = new EstadoEnvio("EN_VUELO", aeropuertoActual, vueloActual, null, null);
        } else if (cantidadSinAsignar == 0 && embarcado == paquete.getCantidad() && vuelosEsperados.size() == 1) {
            String vueloEsperado = vuelosEsperados.iterator().next();
            Vuelo vuelo = resolverVueloOperacion(vueloEsperado, vuelosOperacion);
            String aeropuertoActual = vuelo != null ? vuelo.getOrigen().getCodigoOACI() : paquete.getOrigenOACI();
            resumen = new EstadoEnvio("EMBARCADO", aeropuertoActual, null, vueloEsperado, null);
        } else {
            resumen = new EstadoEnvio("EN_ESPERA", paquete.getOrigenOACI(), null, null, ultimaLlegada);
        }

        return new ResumenEnvioVista(
                resumen,
                new ArrayList<>(aeropuertosRuta),
                new ArrayList<>(vuelosRuta)
        );
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

    private Map<String, Ruta> construirRutasAnteriores(Map<String, Ruta> nuevasRutas) {
        if (nuevasRutas == null || nuevasRutas.isEmpty() || rutasAsignadas.isEmpty()) {
            return new HashMap<>(rutasAnteriores);
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
        return historial;
    }

    private Vuelo resolverVueloOperacion(String vueloId, Map<String, Vuelo> vuelosOperacion) {
        if (vueloId == null) {
            return null;
        }
        if (vuelosOperacion != null) {
            return vuelosOperacion.get(vueloId);
        }
        return buscarVueloPorId(vueloId, AlmacenContexto.OPERACION);
    }

    private Map<String, Vuelo> construirIndiceVuelosOperacion() {
        if (lastDataset == null) {
            return Map.of();
        }

        Dataset datasetEfectivo = datasetContextService.construirDatasetEfectivo(AlmacenContexto.OPERACION, lastDataset);
        if (datasetEfectivo == null || datasetEfectivo.getVuelos() == null || datasetEfectivo.getVuelos().isEmpty()) {
            return Map.of();
        }

        Map<String, Vuelo> vuelos = new HashMap<>();
        for (Vuelo vuelo : datasetEfectivo.getVuelos()) {
            vuelos.put(vuelo.getId(), vuelo);
        }
        return vuelos;
    }

    private EstadoOperativoSnapshot construirSnapshotOperativo(
            Map<String, Ruta> nuevasRutas,
            Map<String, AsignacionPaquete> nuevasAsignaciones,
            Dataset datasetEstado,
            Config_Simulacion config,
            boolean usarDatasetCompletoParaCache
    ) {
        Map<String, Ruta> rutasCalculadas = new HashMap<>(nuevasRutas);
        Map<String, AsignacionPaquete> asignacionesCalculadas = new HashMap<>(nuevasAsignaciones);
        Map<String, Ruta> historialRutas = construirRutasAnteriores(rutasCalculadas);

        EstadoOperacional nuevoEstado = PlanificacionUtils.construirEstadoConAsignacionesSplit(
                asignacionesCalculadas, datasetEstado, config
        );

        Map<String, Integer> nuevoCache = new HashMap<>();
        List<Vuelo> vuelosCache = usarDatasetCompletoParaCache && datasetEstado != null
                ? datasetEstado.getVuelos()
                : (lastDataset != null ? lastDataset.getVuelos() : List.of());
        for (Vuelo vuelo : vuelosCache) {
            int carga = nuevoEstado.getCargaVuelo(vuelo.getId());
            if (carga > 0) {
                nuevoCache.put(vuelo.getId(), carga);
            }
        }

        return new EstadoOperativoSnapshot(
                rutasCalculadas,
                asignacionesCalculadas,
                historialRutas,
                nuevoEstado,
                nuevoCache
        );
    }

    private void aplicarSnapshotOperativo(EstadoOperativoSnapshot snapshot) {
        this.rutasAsignadas = snapshot.rutasAsignadas();
        this.asignacionesSplit = snapshot.asignacionesSplit();
        this.rutasAnteriores = snapshot.rutasAnteriores();
        this.estadoOperacional = snapshot.estadoOperacional();
        this.cargaVueloCache = snapshot.cargaVueloCache();
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
            EstadoEnvio estado = new EstadoEnvio("EN_ESPERA", paquete.getOrigenOACI(), null, null, null);
            maletas.add(construirMaleta(paquete, indiceGlobal++, 1, null, rutaAnterior, estado));
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

    @Scheduled(fixedRate = REPLAN_OPERACION_INTERVAL_MS)
    public synchronized void rePlanificarProgramado() {
        if (lastDataset == null || planificando) return;

        LocalDateTime ahoraUtc = obtenerTiempoOperativoActualUtc();

        List<Paquete> paquetesPlanificables = obtenerTodosLosPaquetes();
        if (paquetesPlanificables.isEmpty()) return;

        // 1. Filtrar pendientes: EN_ESPERA o EMBARCADO
        List<Paquete> pendientes = new ArrayList<>();
        for (Paquete p : paquetesPlanificables) {
            EstadoEnvio e = computarEstadoEfectivoPaquete(p, ahoraUtc);
            if (estaEsperandoRecogidaEnDestinoFinal(p, e)) {
                continue;
            }
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
            config.setMaxRutasPorPaquete(12);
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
            Solucion solucion = new ALNS_Strategy().planificar(datasetPendientes, config);
            Map<String, AsignacionPaquete> nuevasAsignaciones = solucion.getAsignacionesSplit();
            Map<String, Ruta> nuevasRutas = solucion.getRutasAsignadas();

            // 4. Merge: activos (intocables) + nuevos (re-planificados)
            Map<String, Ruta> todasLasRutas = new HashMap<>(rutasActivos);
            todasLasRutas.putAll(nuevasRutas);
            Map<String, AsignacionPaquete> todasLasAsignaciones = new HashMap<>();
            for (Paquete paquete : paquetesPlanificables) {
                if (!rutasActivos.containsKey(paquete.getId())) {
                    continue;
                }
                AsignacionPaquete asignacionActual = this.asignacionesSplit.get(paquete.getId());
                if (asignacionActual != null && !asignacionActual.isEmpty()) {
                    todasLasAsignaciones.put(paquete.getId(), asignacionActual.copia());
                    continue;
                }
                Ruta rutaActiva = rutasActivos.get(paquete.getId());
                if (rutaActiva != null) {
                    todasLasAsignaciones.put(paquete.getId(), new AsignacionPaquete(rutaActiva, paquete.getCantidad()));
                }
            }
            todasLasAsignaciones.putAll(nuevasAsignaciones);

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
            EstadoOperativoSnapshot snapshot = construirSnapshotOperativo(
                    todasLasRutas,
                    todasLasAsignaciones,
                    datasetCompleto,
                    config,
                    false
            );
            aplicarSnapshotOperativo(snapshot);

            System.out.println("[Scheduler] Re-planificación: " + pendientes.size()
                + " pendientes → " + nuevasRutas.size() + " rutas nuevas");
        } catch (Exception e) {
            System.err.println("[Scheduler] Error en re-planificación: " + e.getMessage());
            e.printStackTrace();
        } finally {
            planificando = false;
        }
    }

    private Path saveToTemp(Path dir, MultipartFile file, String filename) throws IOException {
        Files.createDirectories(dir);
        Path dest = dir.resolve(filename);
        try (InputStream inputStream = file.getInputStream()) {
            Files.copy(inputStream, dest, StandardCopyOption.REPLACE_EXISTING);
        }
        return dest;
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
            if (!vuelos.isEmpty()
                    && ahora.isAfter(vuelos.get(vuelos.size() - 1).getLlegadaUtc().plusMinutes(TIEMPO_RECOGIDA_DESTINO_MINUTOS))) {
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
        Map<String, Ruta> nuevasRutas = solucion.getRutasAsignadas();
        Map<String, AsignacionPaquete> nuevasAsignaciones = solucion.getAsignacionesSplit();
        LocalDateTime ahoraUtc = obtenerTiempoOperativoActualUtc();
        Set<String> paquetesReplanificados = dataset.getPaquetes().stream()
                .map(Paquete::getId)
                .collect(Collectors.toSet());
        Set<String> paquetesCongelados = obtenerTodosLosPaquetes().stream()
                .filter(paquete -> paquetesReplanificados.contains(paquete.getId()) && debeCongelarPaquete(paquete, ahoraUtc))
                .map(Paquete::getId)
                .collect(Collectors.toSet());

        Map<String, Ruta> rutasPreservadas = new HashMap<>();
        for (Map.Entry<String, Ruta> entry : this.rutasAsignadas.entrySet()) {
            if (!paquetesReplanificados.contains(entry.getKey()) || paquetesCongelados.contains(entry.getKey())) {
                rutasPreservadas.put(entry.getKey(), entry.getValue());
            }
        }
        Map<String, AsignacionPaquete> asignacionesPreservadas = new HashMap<>();
        for (Paquete paquete : obtenerTodosLosPaquetes()) {
            if (paquetesReplanificados.contains(paquete.getId()) && !paquetesCongelados.contains(paquete.getId())) {
                continue;
            }
            AsignacionPaquete asignacionActual = this.asignacionesSplit.get(paquete.getId());
            if (asignacionActual != null && !asignacionActual.isEmpty()) {
                asignacionesPreservadas.put(paquete.getId(), asignacionActual.copia());
                continue;
            }
            Ruta rutaPreservada = rutasPreservadas.get(paquete.getId());
            if (rutaPreservada != null) {
                asignacionesPreservadas.put(paquete.getId(), new AsignacionPaquete(rutaPreservada, paquete.getCantidad()));
            }
        }

        Map<String, Ruta> todasLasRutas = new HashMap<>(rutasPreservadas);
        todasLasRutas.putAll(nuevasRutas);
        Map<String, AsignacionPaquete> todasLasAsignaciones = new HashMap<>(asignacionesPreservadas);
        paquetesCongelados.forEach(nuevasAsignaciones::remove);
        todasLasAsignaciones.putAll(nuevasAsignaciones);

        List<Paquete> paquetesCompletos = obtenerTodosLosPaquetes();
        Dataset datasetCompletoBase = new Dataset(
                lastDataset.getAeropuertos(),
                lastDataset.getVuelos(),
                paquetesCompletos
        );
        Dataset datasetCompleto = construirDatasetPlanificable(
                AlmacenContexto.OPERACION,
                datasetCompletoBase
        );
        EstadoOperativoSnapshot snapshot = construirSnapshotOperativo(
                todasLasRutas,
                todasLasAsignaciones,
                datasetCompleto,
                config,
                true
        );
        aplicarSnapshotOperativo(snapshot);
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

        LocalDateTime ahoraUtc = referenciaUtc != null ? referenciaUtc : obtenerTiempoOperativoActualUtc();
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
                    .createdAt(obtenerTiempoOperativoActualUtc())
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
        Map<String, Integer> cantidadesAcumuladasPorOrigen = new HashMap<>();
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

            validarCapacidadDisponibleOrigen(
                    e.origen(),
                    e.cantidad(),
                    cantidadesAcumuladasPorOrigen.getOrDefault(e.origen(), 0)
            );

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
            cantidadesAcumuladasPorOrigen.merge(e.origen(), e.cantidad(), Integer::sum);
        }

        boolean conservarPaquetesBase = this.usarPaquetesBaseEnOperacion;
        List<Paquete> listaActualizada = new ArrayList<>(paquetesIncrementales);
        listaActualizada.addAll(nuevos);
        this.paquetesIncrementales = listaActualizada;
        this.usarPaquetesBaseEnOperacion = conservarPaquetesBase;

        System.out.println("[CargaArchivosService] Envios incrementales agregados: " + nuevos.size()
                + ". Total acumulados: " + paquetesIncrementales.size());

        marcarReplanificacionOperacionPendiente();

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
        Map<String, Integer> cantidadesAcumuladasPorOrigen = new HashMap<>();

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

                validarCapacidadDisponibleOrigen(
                        origenNormalizado,
                        parsed.getCantidad(),
                        cantidadesAcumuladasPorOrigen.getOrDefault(origenNormalizado, 0)
                );

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
                cantidadesAcumuladasPorOrigen.merge(origenNormalizado, parsed.getCantidad(), Integer::sum);
            }
        }

        boolean conservarPaquetesBase = this.usarPaquetesBaseEnOperacion;
        List<Paquete> listaActualizada = new ArrayList<>(paquetesIncrementales);
        listaActualizada.addAll(nuevos);
        this.paquetesIncrementales = listaActualizada;
        this.usarPaquetesBaseEnOperacion = conservarPaquetesBase;

        System.out.println("[CargaArchivosService] Envios cargados desde archivo: " + nuevos.size()
                + ". Total acumulados: " + paquetesIncrementales.size());

        marcarReplanificacionOperacionPendiente();
        return nuevos;
    }

    private void validarCapacidadDisponibleOrigen(String origenOaci, int cantidadNueva, int cantidadPendienteLote) {
        Dataset datasetEfectivo = datasetContextService.construirDatasetEfectivo(AlmacenContexto.OPERACION, lastDataset);
        Aeropuerto aeropuerto = datasetEfectivo != null ? datasetEfectivo.getAeropuerto(origenOaci) : null;
        if (aeropuerto == null) {
            throw new IllegalStateException("No se pudo resolver la capacidad del almacén para " + origenOaci);
        }

        LocalDateTime ahoraUtc = obtenerTiempoOperativoActualUtc();
        int ocupacionActual = getOcupacionAeropuerto(origenOaci, ahoraUtc);
        int capacidadMaxima = aeropuerto.getCapacidadMaxima();
        int ocupacionResultante = ocupacionActual + cantidadPendienteLote + cantidadNueva;

        if (ocupacionResultante > capacidadMaxima) {
            int disponible = Math.max(0, capacidadMaxima - ocupacionActual - cantidadPendienteLote);
            int exceso = ocupacionResultante - capacidadMaxima;
            int acumuladoLote = cantidadPendienteLote + cantidadNueva;
            throw new IllegalArgumentException(
                    "La carga excede la capacidad del almacén "
                            + origenOaci
                            + " (ocupación actual: " + ocupacionActual
                            + ", capacidad: " + capacidadMaxima
                            + ", ya agregado en este lote: " + cantidadPendienteLote
                            + ", intentando agregar ahora: " + cantidadNueva
                            + ", total del lote: " + acumuladoLote
                            + ", disponible antes de este registro: " + disponible
                            + ", exceso: " + exceso + ")"
            );
        }
    }

    private void validarCapacidadDisponibleLote(List<Paquete> paquetes) {
        if (paquetes == null || paquetes.isEmpty()) return;

        Map<String, Integer> cantidadesAcumuladasPorOrigen = new HashMap<>();
        for (Paquete paquete : paquetes) {
            String origenOaci = paquete.getOrigenOACI();
            int cantidadPendienteLote = cantidadesAcumuladasPorOrigen.getOrDefault(origenOaci, 0);
            validarCapacidadDisponibleOrigen(origenOaci, paquete.getCantidad(), cantidadPendienteLote);
            cantidadesAcumuladasPorOrigen.merge(origenOaci, paquete.getCantidad(), Integer::sum);
        }
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

    public synchronized LocalDateTime obtenerTiempoOperativoActualUtc() {
        return relojOperativoService.obtenerTiempoActualUtc();
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
        this.replanificacionPendiente = false;
        contextSyncStateService.touch(AlmacenContexto.OPERACION, "operacion-diaria-limpiada");
    }

    private void fijarReferenciaOperativa(Dataset dataset) {
        // Operacion Dia a Dia usa siempre la hora real UTC actual.
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

        LocalDateTime ahoraUtc = obtenerTiempoOperativoActualUtc();
        return construirVistaEnvio(paquete, ahoraUtc, construirIndiceVuelosOperacion());
    }

    public synchronized List<Map<String, Object>> buscarEnvios(String searchTerm) {
        List<Map<String, Object>> resultados = new ArrayList<>();
        if (lastDataset == null || searchTerm == null || searchTerm.isEmpty()) {
            return resultados;
        }

        String term = searchTerm.toLowerCase();
        List<Paquete> todos = obtenerTodosLosPaquetes();
        LocalDateTime ahoraUtc = obtenerTiempoOperativoActualUtc();
        Map<String, Vuelo> vuelosOperacion = construirIndiceVuelosOperacion();

        for (Paquete p : todos) {
            if (p.getId().toLowerCase().contains(term)) {
                Map<String, Object> info = construirVistaEnvio(p, ahoraUtc, vuelosOperacion);
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

        LocalDateTime ahoraUtc = obtenerTiempoOperativoActualUtc();
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

        LocalDateTime ahoraUtc = obtenerTiempoOperativoActualUtc();
        Map<String, Vuelo> vuelosOperacion = construirIndiceVuelosOperacion();
        List<Paquete> todos = obtenerTodosLosPaquetes();

        for (Paquete p : todos) {
            if (origen != null && !origen.isEmpty() && !p.getOrigenOACI().equals(origen)) continue;

            Ruta rutaAnterior = rutasAnteriores.get(p.getId());
            ResumenEnvioVista resumen = construirResumenEnvioVista(p, ahoraUtc, vuelosOperacion);
            EstadoEnvio e = resumen.estado();
            Map<String, String> registroLocal = construirRegistroLocal(p);

            if (!estadosSet.contains(e.estado())) continue;

            if ("ENTREGADO".equals(e.estado()) && horas != null && horas > 0 && e.ultimaLlegada() != null) {
                long diffHoras = Duration.between(e.ultimaLlegada(), ahoraUtc).toHours();
                if (diffHoras > horas) continue;
            }

            Map<String, Object> envio = new HashMap<>();
            envio.put("id", p.getId());
            envio.put("origen", p.getOrigenOACI());
            envio.put("destino", p.getDestinoOACI());
            envio.put("fechaRegistroLocal", registroLocal.get("fecha"));
            envio.put("horaRegistroLocal", registroLocal.get("hora"));
            envio.put("estado", e.estado());
            envio.put("aeropuertoActual", e.aeropuertoActual());
            envio.put("vueloEsperado", e.vueloEsperado());
            envio.put("vueloActual", e.vueloActual());
            envio.put("rutaAeropuertos", resumen.rutaAeropuertos());
            envio.put("rutaVuelos", resumen.rutaVuelos());
            envio.put("rutaAnteriorAeropuertos", rutaAnterior != null ? construirRutaAeropuertos(p, rutaAnterior) : null);
            envio.put("rutaAnteriorVuelos", rutaAnterior != null ? construirRutaVuelos(rutaAnterior) : null);
            envio.put("cantidad", p.getCantidad());
            envio.put("clienteId", obtenerClienteIdCompat(p));
            resultados.add(envio);
        }

        return resultados;
    }

    private Map<String, Object> construirVistaEnvio(
            Paquete paquete,
            LocalDateTime ahoraUtc,
            Map<String, Vuelo> vuelosOperacion
    ) {
        if (paquete == null) {
            return null;
        }

        Ruta rutaAnterior = rutasAnteriores.get(paquete.getId());
        ResumenEnvioVista resumen = construirResumenEnvioVista(paquete, ahoraUtc, vuelosOperacion);
        EstadoEnvio e = resumen.estado();
        Map<String, String> registroLocal = construirRegistroLocal(paquete);

        Map<String, Object> result = new HashMap<>();
        result.put("id", paquete.getId());
        result.put("origen", paquete.getOrigenOACI());
        result.put("destino", paquete.getDestinoOACI());
        result.put("fechaRegistroLocal", registroLocal.get("fecha"));
        result.put("horaRegistroLocal", registroLocal.get("hora"));
        result.put("estado", e.estado());
        result.put("aeropuertoActual", e.aeropuertoActual());
        result.put("vueloEsperado", e.vueloEsperado());
        result.put("vueloActual", e.vueloActual());
        result.put("rutaAeropuertos", resumen.rutaAeropuertos());
        result.put("rutaVuelos", resumen.rutaVuelos());
        result.put("rutaAnteriorAeropuertos", rutaAnterior != null ? construirRutaAeropuertos(paquete, rutaAnterior) : null);
        result.put("rutaAnteriorVuelos", rutaAnterior != null ? construirRutaVuelos(rutaAnterior) : null);
        result.put("cantidad", paquete.getCantidad());
        result.put("clienteId", obtenerClienteIdCompat(paquete));
        return result;
    }

    private Map<String, String> construirRegistroLocal(Paquete paquete) {
        Aeropuerto aeropuertoOrigen = lastDataset != null ? lastDataset.getAeropuerto(paquete.getOrigenOACI()) : null;
        LocalDateTime registroUtc = LocalDateTime.of(paquete.getFecha(), paquete.getHora());
        LocalDateTime registroLocal = aeropuertoOrigen != null
                ? registroUtc.plusMinutes(aeropuertoOrigen.getGmtOffsetMinutos())
                : registroUtc;

        Map<String, String> registro = new HashMap<>();
        registro.put("fecha", registroLocal.toLocalDate().toString());
        registro.put("hora", registroLocal.toLocalTime().toString());
        return registro;
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
