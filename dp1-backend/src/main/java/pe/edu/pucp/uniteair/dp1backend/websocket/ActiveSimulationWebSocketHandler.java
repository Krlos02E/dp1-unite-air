package pe.edu.pucp.uniteair.dp1backend.websocket;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationRealtimeService;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationService;

@Component
public class ActiveSimulationWebSocketHandler extends TextWebSocketHandler {

    private final SimulationRealtimeService realtimeService;
    private final SimulationService simulationService;

    public ActiveSimulationWebSocketHandler(SimulationRealtimeService realtimeService,
                                            SimulationService simulationService) {
        this.realtimeService = realtimeService;
        this.simulationService = simulationService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        realtimeService.registerActiveSession(session);
        var activeSession = simulationService.obtenerSesionActiva();
        if (activeSession == null) {
            realtimeService.sendMessage(session, "SIMULATION_ACTIVE_CHANGED", simulationService.obtenerInfoSesionActivaDesdeEstado(null));
            return;
        }
        var state = simulationService.obtenerEstado(activeSession.getSessionId());
        if (state == null) {
            realtimeService.sendMessage(session, "SIMULATION_ACTIVE_CHANGED", simulationService.obtenerInfoSesionActivaDesdeEstado(null));
            return;
        }
        realtimeService.sendMessage(session, "SIMULATION_ACTIVE_CHANGED", simulationService.obtenerInfoSesionActivaDesdeEstado(state));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        realtimeService.unregister(session);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        realtimeService.unregister(session);
    }
}
