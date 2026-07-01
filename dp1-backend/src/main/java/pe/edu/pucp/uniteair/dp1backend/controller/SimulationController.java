package pe.edu.pucp.uniteair.dp1backend.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import pe.edu.pucp.uniteair.dp1backend.cache.SimulationCache;
import pe.edu.pucp.uniteair.dp1backend.dto.LogEntry;
import pe.edu.pucp.uniteair.dp1backend.dto.SimulationState;
import pe.edu.pucp.uniteair.dp1backend.dto.SimulacionConfigRequest;
import pe.edu.pucp.uniteair.dp1backend.service.CargaArchivosService;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationService;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationContextService;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/simulacion")
public class SimulationController {

    private final SimulationService simulationService;
    private final CargaArchivosService cargaArchivosService;
    private final SimulationCache simulationCache;
    private final SimulationContextService simulationContextService;

    public SimulationController(SimulationService simulationService,
                                CargaArchivosService cargaArchivosService,
                                SimulationCache simulationCache,
                                SimulationContextService simulationContextService) {
        this.simulationService = simulationService;
        this.cargaArchivosService = cargaArchivosService;
        this.simulationCache = simulationCache;
        this.simulationContextService = simulationContextService;
    }

    @GetMapping("/activa")
    public ResponseEntity<Map<String, Object>> activa() {
        String sessionId = simulationCache.getActiveSessionId();
        if (sessionId == null) {
            return ResponseEntity.ok(Map.of("activa", false));
        }
        SimulationState state = simulationService.obtenerEstado(sessionId);
        if (state == null) {
            return ResponseEntity.ok(Map.of("activa", false));
        }
        long elapsed = state.getStartedAt() != null
                ? Duration.between(state.getStartedAt(), LocalDateTime.now()).getSeconds()
                : 0;
        return ResponseEntity.ok(Map.of(
                "activa", true,
                "sessionId", sessionId,
                "status", state.getStatus(),
                "progreso", state.getProgreso(),
                "startedAt", state.getStartedAt(),
                "elapsedRealtimeSeconds", Math.max(0, elapsed)
        ));
    }

    @PostMapping("/iniciar")
    public ResponseEntity<SimulationState> iniciar(@RequestBody SimulacionConfigRequest request) {
        var dataset = cargaArchivosService.obtenerUltimoDataset();
        if (dataset == null) {
            cargaArchivosService.cargarDatasetPorDefecto();
            dataset = cargaArchivosService.obtenerUltimoDataset();
        }
        if (dataset == null) {
            SimulationState errorState = SimulationState.builder()
                    .sessionId("error")
                    .status("ERROR")
                    .startedAt(LocalDateTime.now())
                    .maletasEntregadas(0)
                    .maletasEnTransito(0)
                    .vuelosCulminados(0)
                    .vuelosEnTransito(0)
                    .vuelosCancelados(0)
                    .progreso(0)
                    .colapsada(false)
                    .logs(List.of(LogEntry.builder()
                            .timestamp(LocalDateTime.now())
                            .tipo("ERROR")
                            .mensaje("No se encontró un dataset cargado y no se pudo cargar el dataset por defecto")
                            .build()))
                    .build();
            return ResponseEntity.badRequest().body(errorState);
        }
        return ResponseEntity.ok(simulationService.iniciarSimulacion(request, dataset));
    }

    @GetMapping("/estado/{sessionId}")
    public ResponseEntity<SimulationState> estado(@PathVariable String sessionId) {
        var state = simulationService.obtenerEstado(sessionId);
        if (state == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(state);
    }

    @PostMapping("/detener/{sessionId}")
    public ResponseEntity<SimulationState> detener(@PathVariable String sessionId) {
        var state = simulationService.detenerSimulacion(sessionId);
        if (state == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(state);
    }

    @PostMapping("/pausar/{sessionId}")
    public ResponseEntity<SimulationState> pausar(@PathVariable String sessionId) {
        simulationService.pausarSimulacion(sessionId);
        var state = simulationService.obtenerEstado(sessionId);
        if (state == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(state);
    }

    @PostMapping("/reanudar/{sessionId}")
    public ResponseEntity<SimulationState> reanudar(@PathVariable String sessionId) {
        simulationService.reanudarSimulacion(sessionId);
        var state = simulationService.obtenerEstado(sessionId);
        if (state == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(state);
    }

    @GetMapping("/{sessionId}/poll")
    public ResponseEntity<SimulationState> poll(@PathVariable String sessionId) {
        var state = simulationService.obtenerEstado(sessionId);
        if (state == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(state);
    }

    @PostMapping("/reiniciar-contexto")
    public ResponseEntity<Map<String, Object>> reiniciarContextoEditable() {
        simulationContextService.reiniciarContextoSimulacion();
        return ResponseEntity.ok(Map.of("success", true));
    }
}
