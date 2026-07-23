package pe.edu.pucp.uniteair.dp1backend;

import org.junit.jupiter.api.Test;
import tasf.config.Config_Simulacion;
import tasf.core.Dataset;
import tasf.core.PlanificacionUtils;
import tasf.model.Aeropuerto;
import tasf.model.Continente;
import tasf.model.Paquete;
import tasf.model.Ruta;
import tasf.model.Vuelo;
import tasf.strategy.flow.MinCostFlowAssigner;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class MinCostFlowAssignerCacheTest {

    @Test
    @SuppressWarnings("unchecked")
    void construirCandidatosDebeComplementarCacheConBusquedaFresca() throws Exception {
        Aeropuerto origen = new Aeropuerto("AAAA", Continente.AMERICA, 0, 500);
        Aeropuerto destino = new Aeropuerto("BBBB", Continente.AMERICA, 0, 500);

        Vuelo vueloTemprano = new Vuelo("F-001", origen, destino,
                LocalDate.of(2026, 7, 23), LocalTime.of(10, 5), LocalTime.of(10, 35), 100);
        Vuelo vuelo2 = new Vuelo("F-002", origen, destino,
                LocalDate.of(2026, 7, 23), LocalTime.of(10, 20), LocalTime.of(10, 50), 100);
        Vuelo vuelo3 = new Vuelo("F-003", origen, destino,
                LocalDate.of(2026, 7, 23), LocalTime.of(10, 40), LocalTime.of(11, 10), 100);
        Vuelo vuelo4 = new Vuelo("F-004", origen, destino,
                LocalDate.of(2026, 7, 23), LocalTime.of(11, 0), LocalTime.of(11, 30), 100);

        Paquete paquete = crearPaquete(
                "PK-001",
                "AAAA",
                LocalDate.of(2026, 7, 23),
                LocalTime.of(10, 0),
                "BBBB",
                1,
                "REF"
        );

        Dataset dataset = new Dataset(
                Map.of("AAAA", origen, "BBBB", destino),
                List.of(vueloTemprano, vuelo2, vuelo3, vuelo4),
                List.of(paquete)
        );

        Config_Simulacion config = new Config_Simulacion();
        config.setAeropuertoHub("AAAA");
        config.setMinimaConexion(Duration.ofMinutes(10));
        config.setMaxRutasPorPaquete(4);
        config.setMaxEscalas(2);

        PlanificacionUtils.limpiarCacheGlobal();
        Field cacheField = PlanificacionUtils.class.getDeclaredField("CACHE_GLOBAL_RUTAS");
        cacheField.setAccessible(true);
        Map<String, List<Ruta>> cache = new HashMap<>();
        cache.put(
                "AAAA|BBBB|" + LocalDateTime.of(2026, 7, 23, 10, 0),
                List.of(
                        new Ruta(List.of(vuelo2)),
                        new Ruta(List.of(vuelo3)),
                        new Ruta(List.of(vuelo4))
                )
        );
        cacheField.set(null, cache);

        MinCostFlowAssigner assigner = new MinCostFlowAssigner();
        Method method = MinCostFlowAssigner.class.getDeclaredMethod(
                "construirCandidatosRutas",
                Dataset.class,
                Config_Simulacion.class
        );
        method.setAccessible(true);

        Map<String, List<Ruta>> candidatos =
                (Map<String, List<Ruta>>) method.invoke(assigner, dataset, config);

        List<Ruta> rutas = candidatos.get(paquete.getId());
        assertFalse(rutas.isEmpty(), "El paquete debe conservar rutas candidatas");
        assertEquals(4, rutas.size(), "La fase 2 debe complementar el cache con rutas frescas");
        assertEquals("F-001", rutas.get(0).getVuelos().get(0).getId(),
                "El vuelo cercano omitido del cache debe volver a ser considerado");
    }

    private Paquete crearPaquete(
            String id,
            String origenOaci,
            LocalDate fecha,
            LocalTime hora,
            String destinoOaci,
            int cantidad,
            String referencia
    ) throws Exception {
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
                    origenOaci,
                    fecha,
                    hora,
                    destinoOaci,
                    cantidad,
                    referencia,
                    referencia,
                    true
            );
        } catch (NoSuchMethodException ignored) {
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
                    origenOaci,
                    fecha,
                    hora,
                    destinoOaci,
                    cantidad,
                    referencia
            );
        }
    }
}
