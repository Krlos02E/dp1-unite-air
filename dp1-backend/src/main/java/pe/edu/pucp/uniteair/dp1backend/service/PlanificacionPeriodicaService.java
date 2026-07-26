package pe.edu.pucp.uniteair.dp1backend.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import pe.edu.pucp.uniteair.dp1backend.entity.PlanificacionLog;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.repository.PlanificacionLogRepository;
import tasf.config.Config_Simulacion;
import tasf.core.AsignacionPaquete;
import tasf.core.Dataset;
import tasf.core.EstadoOperacional;
import tasf.core.PlanificacionUtils;
import tasf.core.RouteFinder;
import tasf.core.Solucion;
import tasf.core.RutaConCantidad;
import tasf.model.Paquete;
import tasf.model.Ruta;
import tasf.strategy.alns.ALNS_Strategy;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@Slf4j
public class PlanificacionPeriodicaService {
    private static final long PLANIFICACION_PERIODICA_INTERVAL_MS = 15_000L;

    @Value("${planificacion.periodica.enabled:true}")
    private boolean enabled;

    @Value("${planificacion.periodica.horizonte-futuro-horas:1}")
    private int horizonteFuturoHoras;

    @Value("${planificacion.periodica.horizonte-pasado-horas:48}")
    private int horizontePasadoHoras;

    @Autowired
    private CargaArchivosService cargaArchivosService;

    @Autowired
    private PlanificacionLogRepository logRepository;

    @Autowired
    private DatasetContextService datasetContextService;

    @Autowired
    private RelojOperativoService relojOperativoService;

    @Scheduled(fixedRate = PLANIFICACION_PERIODICA_INTERVAL_MS)
    public void planificacionPeriodica() {
        if (!enabled) {
            return;
        }

        long startTime = System.nanoTime();
        LocalDateTime ahora = relojOperativoService.obtenerTiempoActualUtc();
        LocalDateTime inicio = ahora.minusHours(horizontePasadoHoras);
        LocalDateTime fin = ahora.plusHours(horizonteFuturoHoras);

        log.info("[PlanificacionPeriodica] Iniciando ejecucion. Ventana: [{}, {}]", inicio, fin);

        try {
            Set<String> paquetesEnVuelo = cargaArchivosService.obtenerPaquetesEnVuelo(ahora);
            Set<String> paquetesEntregados = cargaArchivosService.obtenerPaquetesEntregados(ahora);
            Dataset datasetCompleto = cargaArchivosService.obtenerUltimoDataset();

            if (datasetCompleto == null) {
                log.warn("[PlanificacionPeriodica] No hay dataset cargado. Omitiendo ejecucion.");
                return;
            }

            Set<String> excluidos = new HashSet<>();
            excluidos.addAll(paquetesEnVuelo);
            excluidos.addAll(paquetesEntregados);

            Dataset datasetFiltradoBase = cargaArchivosService.filtrarSoloGestionEnvios(inicio, fin, excluidos);
            Dataset datasetFiltrado = datasetContextService.construirDatasetEfectivo(AlmacenContexto.OPERACION, datasetFiltradoBase);

            if (datasetFiltrado.getPaquetes().isEmpty()) {
                long duracionMs = (System.nanoTime() - startTime) / 1_000_000;
                log.info("[PlanificacionPeriodica] No hay paquetes pendientes en la ventana. Duracion: {} ms", duracionMs);
                registrarLog(ahora, duracionMs, 0, 0, 0, 0, "EXITOSO", null, null);
                return;
            }

            log.info("[PlanificacionPeriodica] Paquetes excluidos (en vuelo: {}, entregados: {}). Paquetes a planificar: {}",
                    paquetesEnVuelo.size(), paquetesEntregados.size(), datasetFiltrado.getPaquetes().size());

            Config_Simulacion config = crearConfiguracion();
            PlanificacionUtils.limpiarCacheGlobal();
            Solucion solucion = new ALNS_Strategy().planificar(datasetFiltrado, config);

            int paquetesConRuta = solucion.getRutasAsignadas().size();
            int paquetesSinRuta = solucion.getPaquetesNoAsignados().size();
            int maletasAsignadas = solucion.getMaletasAsignadas();

            long duracionMs = (System.nanoTime() - startTime) / 1_000_000;

            cargaArchivosService.actualizarEstadoOperacional(solucion, datasetFiltrado, config);
            registrarDiagnosticoAsignacionesParciales(datasetFiltrado, config, solucion);

            String detallesJson = convertirMetricasJson(solucion.getMetricas());
            registrarLog(
                    ahora,
                    duracionMs,
                    datasetFiltrado.getPaquetes().size(),
                    paquetesConRuta,
                    paquetesSinRuta,
                    solucion.getCostoTotal(),
                    "EXITOSO",
                    null,
                    detallesJson
            );

            log.info("[PlanificacionPeriodica] Completada en {} ms. Paquetes con ruta: {}/{}, No asignados: {}, Maletas asignadas: {}, Costo: {}",
                    duracionMs,
                    paquetesConRuta,
                    datasetFiltrado.getPaquetes().size(),
                    paquetesSinRuta,
                    maletasAsignadas,
                    String.format("%.2f", solucion.getCostoTotal()));

        } catch (Exception e) {
            long duracionMs = (System.nanoTime() - startTime) / 1_000_000;
            log.error("[PlanificacionPeriodica] Error en planificacion. Deteniendo scheduler. Duracion: {} ms", duracionMs, e);

            this.enabled = false;

            registrarLog(
                    ahora,
                    duracionMs,
                    0,
                    0,
                    0,
                    0,
                    "ERROR",
                    e.getMessage(),
                    null
            );

            throw new RuntimeException("Error en planificacion periodica. Scheduler detenido.", e);
        }
    }

    private Config_Simulacion crearConfiguracion() {
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

    private void registrarLog(
            LocalDateTime timestamp,
            long duracionMs,
            int paquetesProcesados,
            int rutasAsignadas,
            int paquetesNoAsignados,
            double costoTotal,
            String estado,
            String mensajeError,
            String detallesJson
    ) {
        try {
            PlanificacionLog logEntry = PlanificacionLog.builder()
                    .timestampEjecucion(timestamp)
                    .duracionMs(duracionMs)
                    .paquetesProcesados(paquetesProcesados)
                    .rutasAsignadas(rutasAsignadas)
                    .paquetesNoAsignados(paquetesNoAsignados)
                    .costoTotal(costoTotal)
                    .estado(estado)
                    .mensajeError(mensajeError)
                    .detallesJson(detallesJson)
                    .build();
            logRepository.save(logEntry);
        } catch (Exception e) {
            log.error("[PlanificacionPeriodica] Error al registrar log en BD: {}", e.getMessage());
        }
    }

    private String convertirMetricasJson(Map<String, Double> metricas) {
        if (metricas == null || metricas.isEmpty()) return "{}";

        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Double> entry : metricas.entrySet()) {
            if (!first) sb.append(",");
            sb.append("\"").append(entry.getKey()).append("\":").append(entry.getValue());
            first = false;
        }
        sb.append("}");
        return sb.toString();
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    private void registrarDiagnosticoAsignacionesParciales(
            Dataset dataset,
            Config_Simulacion config,
            Solucion solucion
    ) {
        List<Paquete> parciales = new ArrayList<>();
        for (Paquete paquete : dataset.getPaquetes()) {
            AsignacionPaquete asignacion = solucion.getAsignacionesSplit().get(paquete.getId());
            int asignado = asignacion != null ? asignacion.cantidadAsignada() : 0;
            if (asignado > 0 && asignado < paquete.getCantidad()) {
                parciales.add(paquete);
            }
        }

        if (parciales.isEmpty()) {
            return;
        }

        RouteFinder finder = new RouteFinder(dataset);
        Map<String, List<Ruta>> candidatos = PlanificacionUtils.construirCandidatosRutas(dataset, config, finder);
        EstadoOperacional estadoFinal = PlanificacionUtils.construirEstadoConAsignacionesSplit(
                solucion.getAsignacionesSplit(),
                dataset,
                config
        );

        for (Paquete paquete : parciales) {
            AsignacionPaquete asignacion = solucion.getAsignacionesSplit().get(paquete.getId());
            int asignado = asignacion != null ? asignacion.cantidadAsignada() : 0;
            int faltante = paquete.getCantidad() - asignado;
            List<Ruta> rutasCandidatas = candidatos.getOrDefault(paquete.getId(), List.of());
            LocalDateTime creacionUtc = PlanificacionUtils.getCreacionUtc(paquete, dataset, config);

            String rutasAsignadas = asignacion == null
                    ? "-"
                    : asignacion.getRutas().stream()
                            .map(this::resumirRutaAsignada)
                            .collect(Collectors.joining(" | "));

            String topCandidatas = rutasCandidatas.stream()
                    .limit(5)
                    .map(ruta -> resumirRutaCandidata(paquete, ruta, creacionUtc, dataset, config, estadoFinal))
                    .collect(Collectors.joining(" | "));

            log.warn(
                    "[PlanificacionPeriodica][Parcial] paquete={} {}->{} demanda={} asignado={} faltante={} candidatas={} asignadas=[{}] topCandidatas=[{}]",
                    paquete.getId(),
                    paquete.getOrigenOACI(),
                    paquete.getDestinoOACI(),
                    paquete.getCantidad(),
                    asignado,
                    faltante,
                    rutasCandidatas.size(),
                    rutasAsignadas,
                    topCandidatas
            );
        }
    }

    private String resumirRutaAsignada(RutaConCantidad rutaConCantidad) {
        return rutaConCantidad.getCantidad() + "@" + resumirRuta(rutaConCantidad.getRuta());
    }

    private String resumirRutaCandidata(
            Paquete paquete,
            Ruta ruta,
            LocalDateTime creacionUtc,
            Dataset dataset,
            Config_Simulacion config,
            EstadoOperacional estadoFinal
    ) {
        int residual = estadoFinal.capacidadResidualRuta(paquete, ruta, creacionUtc, dataset, config);
        return resumirRuta(ruta) + "#residual=" + residual;
    }

    private String resumirRuta(Ruta ruta) {
        if (ruta == null || ruta.getVuelos().isEmpty()) {
            return "sin-vuelos";
        }
        return ruta.getVuelos().stream()
                .map(vuelo -> vuelo.getId() + "(" + vuelo.getCapacidadCarga() + ")")
                .collect(Collectors.joining("->"));
    }
}
