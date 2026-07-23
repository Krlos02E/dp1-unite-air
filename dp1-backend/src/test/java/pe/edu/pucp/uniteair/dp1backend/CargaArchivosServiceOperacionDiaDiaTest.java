package pe.edu.pucp.uniteair.dp1backend;

import org.junit.jupiter.api.Test;
import org.springframework.web.multipart.MultipartFile;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.entity.VueloCancelado;
import pe.edu.pucp.uniteair.dp1backend.repository.VueloCanceladoRepository;
import pe.edu.pucp.uniteair.dp1backend.service.CargaArchivosService;
import pe.edu.pucp.uniteair.dp1backend.service.ContextSyncStateService;
import pe.edu.pucp.uniteair.dp1backend.service.DatasetContextService;
import pe.edu.pucp.uniteair.dp1backend.service.RelojOperativoService;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationRealtimeService;
import tasf.core.Dataset;
import tasf.model.Aeropuerto;
import tasf.model.Continente;
import tasf.model.Paquete;
import tasf.model.Ruta;
import tasf.model.Vuelo;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CargaArchivosServiceOperacionDiaDiaTest {

    @Test
    void conservaEnviosManualesYArchivoEnLaMismaPlanificacion() throws Exception {
        Dataset dataset = datasetOperacionDiaDia();
        CargaArchivosService service = crearService(dataset);

        List<Paquete> manuales = service.agregarEnvios(List.of(
                new CargaArchivosService.EnvioEntrada(
                        "SPIM",
                        "SKBO",
                        LocalDate.of(2026, 7, 23),
                        LocalTime.of(7, 0),
                        1,
                        null,
                        ""
                )
        ));

        List<Paquete> desdeArchivo = service.cargarEnviosDesdeArchivo(
                multipart("archivo-envios.txt", "FILE-20260723-08:00-SABE-1-0007729\n"),
                "SPIM"
        );

        List<Paquete> acumulados = service.obtenerPaquetesIncrementales();
        assertEquals(2, acumulados.size(), "La carga por archivo debe conservar el envio manual previo");

        Paquete manual = manuales.get(0);
        Paquete archivo = desdeArchivo.get(0);
        assertTrue(contienePaquete(acumulados, manual.getId()));
        assertTrue(contienePaquete(acumulados, archivo.getId()));
        assertEquals(CargaArchivosService.CLIENTE_PRUEBA_OPERACION_DIARIA, obtenerClienteId(manual));
        assertEquals(CargaArchivosService.CLIENTE_PRUEBA_OPERACION_DIARIA, obtenerClienteId(archivo));

        esperarHasta(() -> service.obtenerRutasAsignadas().size() == 2, 5000);

        Map<String, Ruta> rutas = service.obtenerRutasAsignadas();
        assertEquals(2, rutas.size(), "La replanificacion debe considerar ambos conjuntos de envios");
        assertNotNull(rutas.get(manual.getId()), "El envio manual debe participar en la planificacion");
        assertNotNull(rutas.get(archivo.getId()), "El envio cargado por archivo debe participar en la planificacion");
        assertEquals("SKBO", rutas.get(manual.getId()).getDestinoOACI());
        assertEquals("SABE", rutas.get(archivo.getId()).getDestinoOACI());
        assertFalse(rutas.get(manual.getId()).getVuelos().isEmpty());
        assertFalse(rutas.get(archivo.getId()).getVuelos().isEmpty());

        assertEquals(1, service.getCargaVuelo("LIM-BOG-001"),
                "El envio manual debe ocupar el vuelo directo a SKBO");
        assertEquals(1, service.getCargaVuelo("LIM-SCL-001"),
                "El envio cargado por archivo debe ocupar el primer tramo hacia SABE");
        assertEquals(1, service.getCargaVuelo("SCL-BUE-001"),
                "El envio cargado por archivo debe ocupar el segundo tramo hacia SABE");
    }

    @Test
    void cargarDatasetPorDefectoDebeIncluirVuelosBaseSinArrastrarEnvios() throws Exception {
        CargaArchivosService service = crearService(null);

        service.cargarDatasetPorDefecto();

        Dataset dataset = service.obtenerUltimoDataset();
        assertNotNull(dataset, "La carga por defecto debe inicializar un dataset operativo");
        assertFalse(dataset.getVuelos().isEmpty(),
                "Operacion Dia a Dia debe arrancar con los vuelos usuales base");
        assertTrue(dataset.getPaquetes().isEmpty(),
                "Operacion Dia a Dia no debe arrastrar envios historicos al inicializar el dataset base");
    }

    @Test
    void agregarEnviosManualDebeDispararReplanificacionOperativa() throws Exception {
        Dataset dataset = datasetOperacionDiaDia();
        CargaArchivosService service = crearService(dataset);

        List<Paquete> manuales = service.agregarEnvios(List.of(
                new CargaArchivosService.EnvioEntrada(
                        "SPIM",
                        "SKBO",
                        LocalDate.of(2026, 7, 23),
                        LocalTime.of(7, 0),
                        1,
                        null,
                        ""
                )
        ));

        esperarHasta(() -> service.obtenerRutasAsignadas().containsKey(manuales.get(0).getId()), 5000);

        assertEquals(1, service.getCargaVuelo("LIM-BOG-001"),
                "El envio manual debe reflejarse en la carga operativa del vuelo asignado");
    }

    @Test
    void cargarPlanesDeVueloNoDebeArrastrarEnviosBaseDelDatasetHistorico() throws Exception {
        CargaArchivosService service = crearService(datasetOperacionDiaDia());

        LocalDate hoy = LocalDate.now();
        String fecha = hoy.format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE);

        CargaArchivosService.CargaResult result = service.cargarArchivos(
                multipart("planes_vuelo.txt", "SPIM-SKBO-09:00-12:00-0005\n"),
                null,
                multipart("_envios_SPIM_.txt", "MANUAL-%s-08-35-SKBO-001-0007729\n".formatted(fecha)),
                "SPIM",
                "America/Lima"
        );

        assertTrue(result.success(), "La carga con planes de vuelo debe completarse correctamente");
        assertEquals(1, result.paquetesCount(),
                "En Operacion Dia a Dia solo deben quedar los envios subidos por el usuario");
        assertEquals(1, service.obtenerUltimoDataset().getPaquetes().size(),
                "El dataset operativo no debe arrastrar envios base historicos");
        assertEquals("SPIM-MANUAL", service.obtenerUltimoDataset().getPaquetes().get(0).getId(),
                "El unico paquete cargado debe ser el envio del usuario para la sede activa");
    }

    @Test
    void cargarArchivosDebePreservarEnviosPreviosYAgregarNuevos() throws Exception {
        Dataset dataset = datasetOperacionDiaDia();
        CargaArchivosService service = crearService(dataset);

        List<Paquete> manuales = service.agregarEnvios(List.of(
                new CargaArchivosService.EnvioEntrada(
                        "SPIM",
                        "SKBO",
                        LocalDate.of(2026, 7, 23),
                        LocalTime.of(7, 0),
                        1,
                        null,
                        ""
                )
        ));

        CargaArchivosService.CargaResult result = service.cargarArchivos(
                multipart("planes_vuelo.txt", "SPIM-SKBO-09:00-12:00-0005\n"),
                null,
                multipart("_envios_SPIM_.txt", "MANUAL-20260723-08-35-SABE-001-0007729\n"),
                "SPIM",
                "America/Lima"
        );

        assertTrue(result.success(), "La segunda carga debe completar el merge operativo");
        assertEquals(2, service.obtenerUltimoDataset().getPaquetes().size(),
                "La carga completa no debe borrar envios previos al agregar nuevos archivos");
        assertTrue(service.obtenerPaquetesIncrementales().isEmpty(),
                "Los envios previos deben consolidarse en el dataset operativo tras una carga completa");
        assertTrue(contienePaquete(service.obtenerUltimoDataset().getPaquetes(), manuales.get(0).getId()),
                "El envio manual previo debe conservarse tras cargar nuevos vuelos y envios");
        assertTrue(contienePaquete(service.obtenerUltimoDataset().getPaquetes(), "SPIM-MANUAL"),
                "El nuevo envio del archivo debe agregarse sin borrar el anterior");
    }

    @Test
    void mantenerVuelosOperativosTrasAgregarEnviosIncrementales() throws Exception {
        Dataset dataset = datasetOperacionDiaDia();
        CargaArchivosService service = crearService(dataset);
        setField(service, "usarPaquetesBaseEnOperacion", true);

        service.agregarEnvios(List.of(
                new CargaArchivosService.EnvioEntrada(
                        "SPIM",
                        "SKBO",
                        LocalDate.of(2026, 7, 23),
                        LocalTime.of(7, 0),
                        1,
                        null,
                        ""
                )
        ));
        assertTrue(service.usaPaquetesBaseEnOperacion(),
                "Los envios manuales no deben desactivar el conjunto de vuelos operativos cargado");

        service.cargarEnviosDesdeArchivo(
                multipart("archivo-envios.txt", "FILE-20260723-08:00-SABE-1-0007729\n"),
                "SPIM"
        );
        assertTrue(service.usaPaquetesBaseEnOperacion(),
                "Los envios por archivo no deben ocultar los vuelos operativos provenientes del planes_vuelo cargado");
    }

    @Test
    void cargarEnviosNoDebeVaciarVuelosQueYaEstanEnVuelo() throws Exception {
        Dataset dataset = datasetOperacionDiaDia();
        CargaArchivosService service = crearService(dataset);
        setField(service, "usarPaquetesBaseEnOperacion", true);
        setField(service, "rutasAsignadas", new HashMap<>(Map.of(
                "BASE-TRIGGER-001",
                new Ruta(List.of(dataset.getVuelos().get(0)))
        )));
        setField(service, "cargaVueloCache", new HashMap<>(Map.of("LIM-BOG-001", 1)));
        setField(service, "relojOperativoService", relojFijo(LocalDateTime.of(2026, 7, 23, 14, 0)));

        service.cargarEnviosDesdeArchivo(
                multipart("archivo-envios.txt", "FILE-20260723-08:00-SABE-1-0007729\n"),
                "SPIM"
        );

        esperarHasta(() -> service.getCargaVuelo("LIM-BOG-001") == 1, 5000);

        Map<String, Ruta> rutas = service.obtenerRutasAsignadas();
        assertNotNull(rutas.get("BASE-TRIGGER-001"),
                "El envio ya activo debe conservar su ruta despues de cargar nuevos envios");
        assertEquals(List.of("LIM-BOG-001"),
                rutas.get("BASE-TRIGGER-001").getVuelos().stream().map(Vuelo::getId).toList(),
                "El vuelo ya en curso no debe perderse al replanificar nuevos envios");
        assertEquals(1, service.getCargaVuelo("LIM-BOG-001"),
                "El avion que ya esta en vuelo debe conservar su carga");
    }

    @Test
    void rechazaEnviosDesdeArchivoSiExcedenCapacidadDelAlmacen() throws Exception {
        CargaArchivosService service = crearService(datasetOperacionDiaDia());

        IllegalArgumentException error = assertThrows(
                IllegalArgumentException.class,
                () -> service.cargarEnviosDesdeArchivo(
                        multipart("archivo-envios.txt", "FILE-20260723-08:00-SKBO-999-0007729\n"),
                        "SPIM"
                )
        );

        assertTrue(error.getMessage().contains("capacidad del almacén SPIM"));
    }

    private boolean contienePaquete(List<Paquete> paquetes, String id) {
        return paquetes.stream().anyMatch(paquete -> id.equals(paquete.getId()));
    }

    private void esperarHasta(Condicion condicion, long timeoutMs) throws Exception {
        long inicio = System.currentTimeMillis();
        while (System.currentTimeMillis() - inicio < timeoutMs) {
            if (condicion.cumple()) {
                return;
            }
            Thread.sleep(50L);
        }
        assertTrue(condicion.cumple(), "No se alcanzo el estado esperado dentro del tiempo limite");
    }

    private CargaArchivosService crearService(Dataset dataset) throws Exception {
        DatasetContextService datasetContextService = new DatasetContextServiceStub();
        Map<AlmacenContexto, Map<String, VueloCancelado>> cancelados = new EnumMap<>(AlmacenContexto.class);
        for (AlmacenContexto contexto : AlmacenContexto.values()) {
            cancelados.put(contexto, new LinkedHashMap<>());
        }
        VueloCanceladoRepository vueloCanceladoRepository = crearRepositorioCancelados(cancelados);
        ContextSyncStateService contextSyncStateService = new ContextSyncStateService(new SimulationRealtimeServiceNoop());
        CargaArchivosService service = new CargaArchivosService(
                datasetContextService,
                vueloCanceladoRepository,
                contextSyncStateService,
                new RelojOperativoService()
        );

        setField(service, "lastDataset", dataset);
        setField(service, "usarPaquetesBaseEnOperacion", false);
        setField(service, "rutasAsignadas", new HashMap<>());
        setField(service, "rutasAnteriores", new HashMap<>());
        setField(service, "asignacionesSplit", new HashMap<>());
        setField(service, "planificando", false);
        setField(service, "paquetesIncrementales", new ArrayList<>());
        setField(service, "contadorPaquetesIncrementales", 0);
        return service;
    }

    private VueloCanceladoRepository crearRepositorioCancelados(
            Map<AlmacenContexto, Map<String, VueloCancelado>> cancelados
    ) {
        return (VueloCanceladoRepository) Proxy.newProxyInstance(
                VueloCanceladoRepository.class.getClassLoader(),
                new Class<?>[]{VueloCanceladoRepository.class},
                (proxy, method, args) -> {
                    String name = method.getName();
                    if ("findAllByContextoOrderBySalidaUtcAsc".equals(name)) {
                        AlmacenContexto contexto = (AlmacenContexto) args[0];
                        return cancelados.get(contexto).values().stream()
                                .sorted(Comparator.comparing(VueloCancelado::getSalidaUtc))
                                .toList();
                    }
                    if ("findByContextoAndVueloId".equals(name)) {
                        AlmacenContexto contexto = (AlmacenContexto) args[0];
                        String vueloId = (String) args[1];
                        return Optional.ofNullable(cancelados.get(contexto).get(vueloId));
                    }
                    if ("save".equals(name)) {
                        VueloCancelado entity = (VueloCancelado) args[0];
                        cancelados.get(entity.getContexto()).put(entity.getVueloId(), entity);
                        return entity;
                    }
                    if ("delete".equals(name)) {
                        VueloCancelado entity = (VueloCancelado) args[0];
                        cancelados.get(entity.getContexto()).remove(entity.getVueloId());
                        return null;
                    }
                    if ("deleteAllByContexto".equals(name)) {
                        AlmacenContexto contexto = (AlmacenContexto) args[0];
                        cancelados.get(contexto).clear();
                        return null;
                    }
                    if ("toString".equals(name)) {
                        return "VueloCanceladoRepositoryStub";
                    }
                    if ("hashCode".equals(name)) {
                        return System.identityHashCode(proxy);
                    }
                    if ("equals".equals(name)) {
                        return proxy == args[0];
                    }
                    throw new UnsupportedOperationException("Metodo no soportado en stub: " + name);
                }
        );
    }

    private void setField(Object target, String fieldName, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    private RelojOperativoService relojFijo(LocalDateTime tiempoUtc) {
        return new RelojOperativoService() {
            @Override
            public synchronized LocalDateTime obtenerTiempoActualUtc() {
                return tiempoUtc;
            }
        };
    }

    private String obtenerClienteId(Paquete paquete) throws Exception {
        try {
            Method getter = paquete.getClass().getMethod("getClienteId");
            return (String) getter.invoke(paquete);
        } catch (NoSuchMethodException ignored) {
            return CargaArchivosService.CLIENTE_PRUEBA_OPERACION_DIARIA;
        }
    }

    private Dataset datasetOperacionDiaDia() {
        Aeropuerto lima = aeropuerto("SPIM", Continente.AMERICA, -300);
        Aeropuerto bogota = aeropuerto("SKBO", Continente.AMERICA, -300);
        Aeropuerto santiago = aeropuerto("SCEL", Continente.AMERICA, -240);
        Aeropuerto buenosAires = aeropuerto("SABE", Continente.AMERICA, -180);

        List<Vuelo> vuelos = List.of(
                new Vuelo("LIM-BOG-001", lima, bogota, LocalDate.of(2026, 7, 23), LocalTime.of(9, 0), LocalTime.of(12, 0), 3),
                new Vuelo("LIM-SCL-001", lima, santiago, LocalDate.of(2026, 7, 23), LocalTime.of(9, 30), LocalTime.of(12, 0), 3),
                new Vuelo("SCL-BUE-001", santiago, buenosAires, LocalDate.of(2026, 7, 23), LocalTime.of(13, 0), LocalTime.of(15, 0), 3)
        );
        List<Paquete> paquetesBase = List.of(
                paqueteCompat(
                        "BASE-TRIGGER-001",
                        lima.getCodigoOACI(),
                        LocalDate.of(2026, 7, 23),
                        LocalTime.of(6, 0),
                        bogota.getCodigoOACI(),
                        1,
                        "",
                        CargaArchivosService.CLIENTE_PRUEBA_OPERACION_DIARIA,
                        false
                )
        );

        Map<String, Aeropuerto> aeropuertos = new HashMap<>();
        aeropuertos.put(lima.getCodigoOACI(), lima);
        aeropuertos.put(bogota.getCodigoOACI(), bogota);
        aeropuertos.put(santiago.getCodigoOACI(), santiago);
        aeropuertos.put(buenosAires.getCodigoOACI(), buenosAires);
        return new Dataset(aeropuertos, vuelos, paquetesBase);
    }

    private Aeropuerto aeropuerto(String codigo, Continente continente, int offsetMinutos) {
        return new Aeropuerto(codigo, continente, offsetMinutos, 20);
    }

    private MultipartFile multipart(String nombre, String contenido) {
        return new MultipartFile() {
            private final byte[] bytes = contenido.getBytes(StandardCharsets.UTF_8);

            @Override
            public String getName() {
                return nombre;
            }

            @Override
            public String getOriginalFilename() {
                return nombre;
            }

            @Override
            public String getContentType() {
                return "text/plain";
            }

            @Override
            public boolean isEmpty() {
                return bytes.length == 0;
            }

            @Override
            public long getSize() {
                return bytes.length;
            }

            @Override
            public byte[] getBytes() {
                return bytes.clone();
            }

            @Override
            public InputStream getInputStream() {
                return new ByteArrayInputStream(bytes);
            }

            @Override
            public void transferTo(java.io.File dest) throws IOException, IllegalStateException {
                java.nio.file.Files.write(dest.toPath(), bytes);
            }
        };
    }

    private Paquete paqueteCompat(
            String id,
            String origen,
            LocalDate fecha,
            LocalTime hora,
            String destino,
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
            return constructorNuevo.newInstance(id, origen, fecha, hora, destino, cantidad, referencia, clienteId, incremental);
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
                return constructorCompat.newInstance(id, origen, fecha, hora, destino, cantidad, referencia);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException("No se pudo construir Paquete con la firma compatible", e);
            }
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("No se pudo construir Paquete con la firma nueva", e);
        }
    }

    private interface Condicion {
        boolean cumple() throws Exception;
    }

    private static class DatasetContextServiceStub extends DatasetContextService {
        DatasetContextServiceStub() {
            super(null, null);
        }

        @Override
        public Dataset construirDatasetEfectivo(AlmacenContexto contexto, Dataset base) {
            return base;
        }

        @Override
        public Dataset construirDatasetEfectivo(AlmacenContexto contexto, Dataset base, LocalDate fechaInicio, int dias) {
            return base;
        }
    }

    private static class SimulationRealtimeServiceNoop extends SimulationRealtimeService {
        SimulationRealtimeServiceNoop() {
            super(null);
        }

        @Override
        public void broadcastContextSnapshot(AlmacenContexto contexto, Map<String, Object> snapshot) {
            // No-op for isolated unit tests.
        }
    }
}
