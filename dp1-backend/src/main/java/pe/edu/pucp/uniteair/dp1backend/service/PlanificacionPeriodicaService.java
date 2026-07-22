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
import tasf.core.Dataset;
import tasf.core.PlanificacionUtils;
import tasf.core.Solucion;
import tasf.strategy.TwoPhaseOrchestrator;
import tasf.strategy.alns.ALNS_RutasPlanner;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

@Service
@Slf4j
public class PlanificacionPeriodicaService {

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

    @Scheduled(fixedRate = 300000)
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
            TwoPhaseOrchestrator orchestrator = new TwoPhaseOrchestrator(new ALNS_RutasPlanner());
            Solucion solucion = orchestrator.ejecutarFlujoCompleto(datasetFiltrado, config);

            long duracionMs = (System.nanoTime() - startTime) / 1_000_000;

            cargaArchivosService.actualizarEstadoOperacional(solucion, datasetFiltrado, config);

            String detallesJson = convertirMetricasJson(solucion.getMetricas());
            registrarLog(
                    ahora,
                    duracionMs,
                    datasetFiltrado.getPaquetes().size(),
                    solucion.getRutasAsignadas().size(),
                    solucion.getPaquetesNoAsignados().size(),
                    solucion.getCostoTotal(),
                    "EXITOSO",
                    null,
                    detallesJson
            );

            log.info("[PlanificacionPeriodica] Completada en {} ms. Asignados: {}/{}, No asignados: {}, Costo: {}",
                    duracionMs,
                    solucion.getRutasAsignadas().size(),
                    datasetFiltrado.getPaquetes().size(),
                    solucion.getPaquetesNoAsignados().size(),
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
}
