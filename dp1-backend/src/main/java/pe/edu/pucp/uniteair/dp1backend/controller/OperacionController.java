package pe.edu.pucp.uniteair.dp1backend.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.edu.pucp.uniteair.dp1backend.service.OperacionContextService;

import java.util.Map;

@RestController
@RequestMapping("/operacion")
public class OperacionController {

    private final OperacionContextService operacionContextService;

    public OperacionController(OperacionContextService operacionContextService) {
        this.operacionContextService = operacionContextService;
    }

    @PostMapping("/reiniciar")
    public ResponseEntity<Map<String, Object>> reiniciarOperacion() {
        operacionContextService.reiniciarOperacion();
        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Contexto de operacion reiniciado correctamente"
        ));
    }
}
