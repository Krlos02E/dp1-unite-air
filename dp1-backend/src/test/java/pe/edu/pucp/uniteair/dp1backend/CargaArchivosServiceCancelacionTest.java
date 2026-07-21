package pe.edu.pucp.uniteair.dp1backend;

import org.junit.jupiter.api.Test;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.entity.VueloCancelado;
import pe.edu.pucp.uniteair.dp1backend.repository.VueloCanceladoRepository;
import pe.edu.pucp.uniteair.dp1backend.service.CargaArchivosService;
import pe.edu.pucp.uniteair.dp1backend.service.ContextSyncStateService;
import pe.edu.pucp.uniteair.dp1backend.service.DatasetContextService;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationRealtimeService;
import tasf.config.Config_Simulacion;
import tasf.core.Dataset;
import tasf.core.Solucion;
import tasf.model.Aeropuerto;
import tasf.model.Continente;
import tasf.model.Paquete;
import tasf.model.Ruta;
import tasf.model.Vuelo;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.time.Duration;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CargaArchivosServiceCancelacionTest {

    @Test
    void cancelaYReasignaVueloSeleccionadoEnLima() throws Exception {
        ejecutarEscenario(escenarioLima());
    }

    @Test
    void cancelaYReasignaVueloSeleccionadoEnBuenosAires() throws Exception {
        ejecutarEscenario(escenarioBuenosAires());
    }

    @Test
    void cancelaYReasignaVueloSeleccionadoEnCopenhague() throws Exception {
        ejecutarEscenario(escenarioCopenhague());
    }

    @Test
    void cancelaYReasignaVueloSeleccionadoEnDelhiCercaAlCambioDeDia() throws Exception {
        ejecutarEscenario(escenarioDelhiCercaCambioDia());
    }

    private void ejecutarEscenario(EscenarioCancelacion escenario) throws Exception {
        CargaArchivosService service = crearService(escenario.dataset());
        Solucion solucionInicial = new Solucion("test-cancelacion");
        solucionInicial.asignar(escenario.paquete().getId(), new Ruta(List.of(escenario.vueloPrimario())), false);
        service.actualizarEstadoOperacional(solucionInicial, escenario.dataset(), crearConfig());

        Ruta rutaInicial = service.obtenerRutasAsignadas().get(escenario.paquete().getId());
        assertNotNull(rutaInicial, "Debe existir una ruta inicial para " + escenario.nombre());
        assertEquals(List.of(escenario.vueloPrimario().getId()), idsRuta(rutaInicial),
                "La ruta inicial debe apuntar exactamente al vuelo seleccionado en " + escenario.nombre());

        String vueloCancelado = service.cancelarVuelo(
                escenario.vueloPrimario().getId(),
                AlmacenContexto.OPERACION,
                escenario.referenciaCancelacionUtc()
        );
        assertEquals(escenario.vueloPrimario().getId(), vueloCancelado,
                "La cancelacion debe afectar exactamente al vuelo elegido en " + escenario.nombre());
        assertEquals(
                List.of(escenario.vueloPrimario().getId()),
                new ArrayList<>(service.obtenerVuelosCancelados(AlmacenContexto.OPERACION)),
                "Solo el vuelo seleccionado debe quedar marcado como cancelado en " + escenario.nombre()
        );

        service.rePlanificarProgramado();

        Ruta rutaReasignada = service.obtenerRutasAsignadas().get(escenario.paquete().getId());
        assertNotNull(rutaReasignada, "Debe existir una ruta reasignada para " + escenario.nombre());
        assertEquals(
                List.of(escenario.vueloAlternativo1().getId(), escenario.vueloAlternativo2().getId()),
                idsRuta(rutaReasignada),
                "La reasignacion debe usar la ruta alternativa esperada en " + escenario.nombre()
        );
        assertFalse(idsRuta(rutaReasignada).contains(escenario.vueloPrimario().getId()),
                "La ruta nueva no debe reutilizar el vuelo cancelado en " + escenario.nombre());
        assertEquals(escenario.paquete().getOrigenOACI(), rutaReasignada.getOrigenOACI());
        assertEquals(escenario.paquete().getDestinoOACI(), rutaReasignada.getDestinoOACI());
        assertRutaValida(rutaReasignada);

        @SuppressWarnings("unchecked")
        Map<String, Ruta> rutasAnteriores = (Map<String, Ruta>) getField(service, "rutasAnteriores");
        Ruta rutaAnterior = rutasAnteriores.get(escenario.paquete().getId());
        assertNotNull(rutaAnterior, "Debe conservarse la ruta anterior para " + escenario.nombre());
        assertEquals(List.of(escenario.vueloPrimario().getId()), idsRuta(rutaAnterior));

        assertEquals(0, service.getCargaVuelo(escenario.vueloPrimario().getId()));
        assertEquals(escenario.paquete().getCantidad(), service.getCargaVuelo(escenario.vueloAlternativo1().getId()));
        assertEquals(escenario.paquete().getCantidad(), service.getCargaVuelo(escenario.vueloAlternativo2().getId()));
    }

    private void assertRutaValida(Ruta ruta) {
        List<Vuelo> vuelos = ruta.getVuelos();
        assertFalse(vuelos.isEmpty(), "La ruta reasignada no puede quedar vacia");
        for (Vuelo vuelo : vuelos) {
            assertTrue(vuelo.getLlegadaUtc().isAfter(vuelo.getSalidaUtc()),
                    "Cada tramo debe llegar despues de salir: " + vuelo.getId());
            assertTrue(vuelo.getCapacidadCarga() >= 1,
                    "Cada tramo debe conservar una capacidad valida: " + vuelo.getId());
        }
        for (int i = 1; i < vuelos.size(); i++) {
            LocalDateTime llegadaAnterior = vuelos.get(i - 1).getLlegadaUtc();
            LocalDateTime salidaActual = vuelos.get(i).getSalidaUtc();
            assertFalse(salidaActual.isBefore(llegadaAnterior.plusMinutes(10)),
                    "La conexion debe respetar al menos 10 minutos entre " + vuelos.get(i - 1).getId()
                            + " y " + vuelos.get(i).getId());
        }
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
                contextSyncStateService
        );

        setField(service, "lastDataset", dataset);
        setField(service, "usarPaquetesBaseEnOperacion", true);
        setField(service, "rutasAsignadas", new HashMap<>());
        setField(service, "rutasAnteriores", new HashMap<>());
        setField(service, "asignacionesSplit", new HashMap<>());
        setField(service, "planificando", false);
        setField(service, "paquetesIncrementales", new ArrayList<>());
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

    private Object getField(Object target, String fieldName) throws Exception {
        Field field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        return field.get(target);
    }

    private Config_Simulacion crearConfig() {
        Config_Simulacion config = new Config_Simulacion();
        config.setAeropuertoHub("SKBO");
        config.setMinimaConexion(Duration.ofMinutes(10));
        config.setIteracionesALNS(20);
        config.setMaxRutasPorPaquete(4);
        config.setMaxEscalas(2);
        config.setVentanaActualizacionPesos(5);
        config.setEvaporacionFeromona(0.4);
        return config;
    }

    private List<String> idsRuta(Ruta ruta) {
        return ruta.getVuelos().stream().map(Vuelo::getId).toList();
    }

    private EscenarioCancelacion escenarioLima() {
        Aeropuerto origen = aeropuerto("SPIM", Continente.AMERICA, -300);
        Aeropuerto hub = aeropuerto("SKEZ", Continente.AMERICA, -300);
        Aeropuerto destino = aeropuerto("SKBO", Continente.AMERICA, -300);
        LocalDate fecha = LocalDate.of(2026, 7, 23);
        Vuelo primario = new Vuelo("LIM-DIRECTO-001", origen, destino, fecha, LocalTime.of(9, 0), LocalTime.of(12, 0), 3);
        Vuelo alternativo1 = new Vuelo("LIM-ALT-001", origen, hub, fecha, LocalTime.of(9, 30), LocalTime.of(11, 0), 3);
        Vuelo alternativo2 = new Vuelo("LIM-ALT-002", hub, destino, fecha, LocalTime.of(11, 30), LocalTime.of(12, 30), 3);
        Paquete paquete = paquete("PK-LIMA", origen, destino, fecha, LocalTime.of(7, 0));
        Dataset dataset = dataset(origen, hub, destino, List.of(primario, alternativo1, alternativo2), List.of(paquete));
        return new EscenarioCancelacion(
                "Lima",
                dataset,
                paquete,
                hub,
                primario,
                alternativo1,
                alternativo2,
                LocalDateTime.of(2026, 7, 23, 13, 0)
        );
    }

    private EscenarioCancelacion escenarioBuenosAires() {
        Aeropuerto origen = aeropuerto("SABE", Continente.AMERICA, -180);
        Aeropuerto hub = aeropuerto("SCEL", Continente.AMERICA, -240);
        Aeropuerto destino = aeropuerto("SKBO", Continente.AMERICA, -300);
        LocalDate fecha = LocalDate.of(2026, 7, 23);
        Vuelo primario = new Vuelo("BUE-DIRECTO-001", origen, destino, fecha, LocalTime.of(8, 0), LocalTime.of(12, 30), 3);
        Vuelo alternativo1 = new Vuelo("BUE-ALT-001", origen, hub, fecha, LocalTime.of(8, 20), LocalTime.of(10, 0), 3);
        Vuelo alternativo2 = new Vuelo("BUE-ALT-002", hub, destino, fecha, LocalTime.of(10, 30), LocalTime.of(14, 30), 3);
        Paquete paquete = paquete("PK-BUE", origen, destino, fecha, LocalTime.of(6, 0));
        Dataset dataset = dataset(origen, hub, destino, List.of(primario, alternativo1, alternativo2), List.of(paquete));
        return new EscenarioCancelacion(
                "Buenos Aires",
                dataset,
                paquete,
                hub,
                primario,
                alternativo1,
                alternativo2,
                LocalDateTime.of(2026, 7, 23, 10, 0)
        );
    }

    private EscenarioCancelacion escenarioCopenhague() {
        Aeropuerto origen = aeropuerto("EKCH", Continente.EUROPA, 60);
        Aeropuerto hub = aeropuerto("EHAM", Continente.EUROPA, 60);
        Aeropuerto destino = aeropuerto("SKBO", Continente.AMERICA, -300);
        LocalDate fecha = LocalDate.of(2026, 7, 23);
        Vuelo primario = new Vuelo("CPH-DIRECTO-001", origen, destino, fecha, LocalTime.of(10, 0), LocalTime.of(17, 0), 3);
        Vuelo alternativo1 = new Vuelo("CPH-ALT-001", origen, hub, fecha, LocalTime.of(10, 30), LocalTime.of(11, 45), 3);
        Vuelo alternativo2 = new Vuelo("CPH-ALT-002", hub, destino, fecha, LocalTime.of(12, 30), LocalTime.of(18, 30), 3);
        Paquete paquete = paquete("PK-CPH", origen, destino, fecha, LocalTime.of(8, 0));
        Dataset dataset = dataset(origen, hub, destino, List.of(primario, alternativo1, alternativo2), List.of(paquete));
        return new EscenarioCancelacion(
                "Copenhague",
                dataset,
                paquete,
                hub,
                primario,
                alternativo1,
                alternativo2,
                LocalDateTime.of(2026, 7, 23, 7, 0)
        );
    }

    private EscenarioCancelacion escenarioDelhiCercaCambioDia() {
        Aeropuerto origen = aeropuerto("VIDP", Continente.ASIA, 330);
        Aeropuerto hub = aeropuerto("OMDB", Continente.ASIA, 240);
        Aeropuerto destino = aeropuerto("SKBO", Continente.AMERICA, -300);
        LocalDate fecha = LocalDate.of(2026, 7, 23);
        Vuelo primario = new Vuelo("DEL-DIRECTO-001", origen, destino, fecha, LocalTime.of(0, 15), LocalTime.of(6, 30), 3);
        Vuelo alternativo1 = new Vuelo("DEL-ALT-001", origen, hub, fecha, LocalTime.of(0, 45), LocalTime.of(2, 30), 3);
        Vuelo alternativo2 = new Vuelo("DEL-ALT-002", hub, destino, fecha, LocalTime.of(3, 15), LocalTime.of(10, 30), 3);
        Paquete paquete = paquete("PK-DEL", origen, destino, fecha.minusDays(1), LocalTime.of(23, 30));
        Dataset dataset = dataset(origen, hub, destino, List.of(primario, alternativo1, alternativo2), List.of(paquete));
        return new EscenarioCancelacion(
                "Delhi cerca de cambio de dia",
                dataset,
                paquete,
                hub,
                primario,
                alternativo1,
                alternativo2,
                LocalDateTime.of(2026, 7, 22, 16, 0)
        );
    }

    private Aeropuerto aeropuerto(String codigo, Continente continente, int offsetMinutos) {
        return new Aeropuerto(codigo, continente, offsetMinutos, 20);
    }

    private Paquete paquete(String id, Aeropuerto origen, Aeropuerto destino, LocalDate fechaLocal, LocalTime horaLocal) {
        LocalDateTime utc = origen.convertirLocalAUTC(fechaLocal, horaLocal);
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
                    origen.getCodigoOACI(),
                    utc.toLocalDate(),
                    utc.toLocalTime(),
                    destino.getCodigoOACI(),
                    1,
                    "",
                    CargaArchivosService.CLIENTE_PRUEBA_OPERACION_DIARIA,
                    false
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
                        origen.getCodigoOACI(),
                        utc.toLocalDate(),
                        utc.toLocalTime(),
                        destino.getCodigoOACI(),
                        1,
                        ""
                );
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException("No se pudo construir Paquete con la firma compatible", e);
            }
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("No se pudo construir Paquete con la firma nueva", e);
        }
    }

    private Dataset dataset(
            Aeropuerto origen,
            Aeropuerto hub,
            Aeropuerto destino,
            List<Vuelo> vuelos,
            List<Paquete> paquetes
    ) {
        Map<String, Aeropuerto> aeropuertos = new HashMap<>();
        aeropuertos.put(origen.getCodigoOACI(), origen);
        aeropuertos.put(hub.getCodigoOACI(), hub);
        aeropuertos.put(destino.getCodigoOACI(), destino);
        return new Dataset(aeropuertos, vuelos, paquetes);
    }

    private record EscenarioCancelacion(
            String nombre,
            Dataset dataset,
            Paquete paquete,
            Aeropuerto hub,
            Vuelo vueloPrimario,
            Vuelo vueloAlternativo1,
            Vuelo vueloAlternativo2,
            LocalDateTime referenciaCancelacionUtc
    ) {}

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
