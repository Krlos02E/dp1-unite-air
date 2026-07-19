package pe.edu.pucp.uniteair.dp1backend.controller;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import pe.edu.pucp.uniteair.dp1backend.service.CargaArchivosService;
import pe.edu.pucp.uniteair.dp1backend.service.CargaArchivosService.EnvioEntrada;
import tasf.model.Paquete;

@RestController
@RequestMapping("/envios")
public class EnviosController {

    private static final Map<String, String> TIMEZONE_TO_AIRPORT = Map.of(
            "America/Lima", "SPIM",
            "America/Argentina/Buenos_Aires", "SABE",
            "Europe/Copenhagen", "EKCH",
            "Asia/Kolkata", "VIDP"
    );

    @Autowired
    private CargaArchivosService cargaArchivosService;

    @PostMapping
    public ResponseEntity<Map<String, Object>> agregarEnvios(@RequestBody EnviosRequest request) {
        try {
            List<EnvioEntrada> envios = new ArrayList<>();
            for (EnvioItem item : request.envios()) {
                String origen = inferirOrigenPorTimezone(item.timezone());
                envios.add(new EnvioEntrada(
                        origen,
                        item.destino(),
                        LocalDate.parse(item.fechaLocal()),
                        LocalTime.parse(item.horaLocal()),
                        item.cantidad(),
                        null
                ));
            }

            List<Paquete> paquetesAgregados = cargaArchivosService.agregarEnvios(envios);

            List<Map<String, Object>> detalles = new ArrayList<>();
            for (Paquete p : paquetesAgregados) {
                detalles.add(Map.of(
                        "id", p.getId(),
                        "origen", p.getOrigenOACI(),
                        "destino", p.getDestinoOACI(),
                        "cantidad", p.getCantidad()
                ));
            }

            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "Envios agregados correctamente",
                    "enviosAgregados", paquetesAgregados.size(),
                    "detalles", detalles
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", e.getMessage()
            ));
        }
    }

    @GetMapping("/incrementales")
    public ResponseEntity<Map<String, Object>> obtenerEnviosIncrementales() {
        List<Paquete> paquetes = cargaArchivosService.obtenerPaquetesIncrementales();
        List<Map<String, Object>> detalles = new ArrayList<>();
        for (Paquete p : paquetes) {
            detalles.add(Map.of(
                    "id", p.getId(),
                    "origen", p.getOrigenOACI(),
                    "destino", p.getDestinoOACI(),
                    "fecha", p.getFecha().toString(),
                    "hora", p.getHora().toString(),
                    "cantidad", p.getCantidad()
            ));
        }
        return ResponseEntity.ok(Map.of(
                "total", paquetes.size(),
                "envios", detalles
        ));
    }

    @GetMapping("/buscar")
    public ResponseEntity<Map<String, Object>> buscarEnvios(@RequestParam(required = false, defaultValue = "") String q) {
        List<Map<String, Object>> resultados = cargaArchivosService.buscarEnvios(q);
        return ResponseEntity.ok(Map.of(
                "total", resultados.size(),
                "envios", resultados
        ));
    }

    @GetMapping("/lista")
    public ResponseEntity<Map<String, Object>> listarEnvios(
            @RequestParam(required = false) String estados,
            @RequestParam(required = false) String origen,
            @RequestParam(required = false) Integer horas
    ) {
        List<Map<String, Object>> resultados = cargaArchivosService.listarEnvios(estados, origen, horas);
        return ResponseEntity.ok(Map.of(
                "total", resultados.size(),
                "envios", resultados
        ));
    }

    @GetMapping("/maletas/lista")
    public ResponseEntity<Map<String, Object>> listarMaletas(
            @RequestParam(required = false) String estados,
            @RequestParam(required = false) String origen,
            @RequestParam(required = false) Integer horas
    ) {
        List<Map<String, Object>> resultados = cargaArchivosService.listarMaletas(estados, origen, horas);
        return ResponseEntity.ok(Map.of(
                "total", resultados.size(),
                "maletas", resultados
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> buscarEnvio(@PathVariable String id) {
        Map<String, Object> resultado = cargaArchivosService.buscarEnvio(id);
        if (resultado == null) {
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "message", "Envio no encontrado: " + id
            ));
        }
        resultado.put("success", true);
        return ResponseEntity.ok(resultado);
    }

    private String inferirOrigenPorTimezone(String timezone) {
        if (timezone == null || timezone.isBlank()) {
            throw new IllegalArgumentException("La zona horaria de la PC es obligatoria");
        }
        String origen = TIMEZONE_TO_AIRPORT.get(timezone);
        if (origen == null) {
            throw new IllegalArgumentException("Zona horaria no valida para operacion dia a dia: " + timezone);
        }
        return origen;
    }

    public record EnviosRequest(List<EnvioItem> envios) {}
    public record EnvioItem(String destino, String fechaLocal, String horaLocal, int cantidad, String timezone) {}
}
