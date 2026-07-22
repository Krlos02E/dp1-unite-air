package pe.edu.pucp.uniteair.dp1backend.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import pe.edu.pucp.uniteair.dp1backend.dto.ProgramacionVueloDTO;
import pe.edu.pucp.uniteair.dp1backend.dto.SimulationState;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.service.CargaArchivosService;
import pe.edu.pucp.uniteair.dp1backend.service.ProgramacionVueloService;
import pe.edu.pucp.uniteair.dp1backend.service.RelojOperativoService;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationService;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/vuelos")
public class VueloController {

    @Autowired
    private CargaArchivosService cargaArchivosService;

    @Autowired
    private ProgramacionVueloService programacionVueloService;

    @Autowired
    private SimulationService simulationService;

    @Autowired
    private RelojOperativoService relojOperativoService;

    @PostMapping("/cancelar")
    public ResponseEntity<Map<String, Object>> cancelarVuelo(@RequestBody CancelacionRequest request) {
        try {
            LocalDateTime referenciaUtc = relojOperativoService.obtenerTiempoActualUtc();
            if (request.contexto() == AlmacenContexto.SIMULACION) {
                if (request.sessionId() == null || request.sessionId().isBlank()) {
                    throw new IllegalArgumentException("Se requiere sessionId para cancelar vuelos en simulacion");
                }
                SimulationState estado = simulationService.obtenerEstado(request.sessionId());
                if (estado == null || estado.getSimulationTime() == null) {
                    throw new IllegalArgumentException("No se encontro la simulacion activa solicitada");
                }
                referenciaUtc = estado.getSimulationTime();
            }

            String vueloId = cargaArchivosService.cancelarVuelo(
                    request.vueloId(),
                    request.contexto() != null ? request.contexto() : AlmacenContexto.OPERACION,
                    referenciaUtc
            );
            if (request.contexto() == null || request.contexto() == AlmacenContexto.OPERACION) {
                cargaArchivosService.replanificarOperacionActual();
            } else if (request.contexto() == AlmacenContexto.SIMULACION) {
                simulationService.refrescarEstadoVisualSesionActivaSimulacion();
            }

            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "Vuelo cancelado correctamente",
                    "vueloId", vueloId
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", e.getMessage()
            ));
        }
    }

    @GetMapping("/cancelados")
    public ResponseEntity<Set<String>> obtenerVuelosCancelados(
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto
    ) {
        return ResponseEntity.ok(cargaArchivosService.obtenerVuelosCancelados(contexto));
    }

    @PostMapping("/descancelar")
    public ResponseEntity<Map<String, Object>> descancelarVuelo(@RequestBody DescancelacionRequest request) {
        try {
            String vueloId = cargaArchivosService.descancelarVuelo(
                    request.vueloId(),
                    request.contexto() != null ? request.contexto() : AlmacenContexto.OPERACION
            );
            if (request.contexto() == null || request.contexto() == AlmacenContexto.OPERACION) {
                cargaArchivosService.replanificarOperacionActual();
            } else if (request.contexto() == AlmacenContexto.SIMULACION) {
                simulationService.refrescarEstadoVisualSesionActivaSimulacion();
            }
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "Vuelo descancelado correctamente",
                    "vueloId", vueloId
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", e.getMessage()
            ));
        }
    }

    @GetMapping("/programaciones")
    public ResponseEntity<List<ProgramacionVueloDTO>> listarProgramaciones(
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto
    ) {
        return ResponseEntity.ok(programacionVueloService.listar(contexto));
    }

    @PostMapping("/programaciones")
    public ResponseEntity<?> crearProgramacion(
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto,
            @RequestBody ProgramacionVueloDTO request
    ) {
        try {
            ProgramacionVueloDTO response = programacionVueloService.crear(contexto, request);
            if (contexto == AlmacenContexto.SIMULACION) {
                simulationService.refrescarEstadoVisualSesionActivaSimulacion();
            }
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", e.getMessage()
            ));
        }
    }

    @PutMapping("/programaciones/{id}")
    public ResponseEntity<?> actualizarProgramacion(
            @PathVariable Long id,
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto,
            @RequestBody ProgramacionVueloDTO request
    ) {
        try {
            ProgramacionVueloDTO response = programacionVueloService.actualizar(contexto, id, request);
            if (contexto == AlmacenContexto.SIMULACION) {
                simulationService.refrescarEstadoVisualSesionActivaSimulacion();
            }
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", e.getMessage()
            ));
        }
    }

    @DeleteMapping("/programaciones/{id}")
    public ResponseEntity<?> eliminarProgramacion(
            @PathVariable Long id,
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto
    ) {
        try {
            programacionVueloService.eliminar(contexto, id);
            if (contexto == AlmacenContexto.SIMULACION) {
                simulationService.refrescarEstadoVisualSesionActivaSimulacion();
            }
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", e.getMessage()
            ));
        }
    }

    public record CancelacionRequest(
            String vueloId,
            AlmacenContexto contexto,
            String sessionId
    ) {}

    public record DescancelacionRequest(
            String vueloId,
            AlmacenContexto contexto
    ) {}
}
