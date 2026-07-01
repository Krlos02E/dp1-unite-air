package pe.edu.pucp.uniteair.dp1backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SimulationState {
    private String sessionId;
    private String status;
    private LocalDateTime startedAt;
    private LocalDateTime simulationTime;
    private List<VueloDTO> vuelos;
    private List<AeropuertoDTO> aeropuertos;
    private int maletasEntregadas;
    private int maletasEnTransito;
    private int vuelosCulminados;
    private int vuelosEnTransito;
    private int vuelosCancelados;
    private int progreso;
    private boolean colapsada;
    private String motivoColapso;
    private Long elapsedRealtimeSeconds;
    private List<LogEntry> logs;
    private List<EnvioSimulacionDTO> envios;
    private List<MaletaSimulacionDTO> maletas;
}
