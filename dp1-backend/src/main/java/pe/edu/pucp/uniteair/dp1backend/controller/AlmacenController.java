package pe.edu.pucp.uniteair.dp1backend.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import pe.edu.pucp.uniteair.dp1backend.entity.Almacen;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.service.AlmacenService;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationService;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/almacenes")
public class AlmacenController {

    private final AlmacenService almacenService;
    private final SimulationService simulationService;

    public AlmacenController(AlmacenService almacenService,
                             SimulationService simulationService) {
        this.almacenService = almacenService;
        this.simulationService = simulationService;
    }

    @GetMapping
    public ResponseEntity<List<Almacen>> listar(
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto
    ) {
        return ResponseEntity.ok(almacenService.listar(contexto));
    }

    @GetMapping("/{codigo}")
    public ResponseEntity<Almacen> obtener(
            @PathVariable String codigo,
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto
    ) {
        return almacenService.obtenerPorId(contexto, codigo)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<?> crear(
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto,
            @RequestBody Almacen almacen
    ) {
        try {
            Almacen creado = almacenService.crear(contexto, almacen);
            if (contexto == AlmacenContexto.SIMULACION) {
                simulationService.refrescarEstadoVisualSesionActivaSimulacion();
            }
            return ResponseEntity.ok(creado);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{codigo}")
    public ResponseEntity<?> actualizar(
            @PathVariable String codigo,
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto,
            @RequestBody Almacen datos
    ) {
        try {
            Almacen actualizado = almacenService.actualizar(contexto, codigo, datos);
            if (contexto == AlmacenContexto.SIMULACION) {
                simulationService.refrescarEstadoVisualSesionActivaSimulacion();
            }
            return ResponseEntity.ok(actualizado);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{codigo}")
    public ResponseEntity<?> eliminar(
            @PathVariable String codigo,
            @RequestParam(defaultValue = "OPERACION") AlmacenContexto contexto
    ) {
        try {
            almacenService.eliminar(contexto, codigo);
            if (contexto == AlmacenContexto.SIMULACION) {
                simulationService.refrescarEstadoVisualSesionActivaSimulacion();
            }
            return ResponseEntity.ok(Map.of("success", true));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
