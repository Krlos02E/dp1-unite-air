package pe.edu.pucp.uniteair.dp1backend.websocket;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationRealtimeService;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationService;

@Component
public class SimulationStateWebSocketHandler extends TextWebSocketHandler {

    private final SimulationRealtimeService realtimeService;
    private final SimulationService simulationService;

    public SimulationStateWebSocketHandler(SimulationRealtimeService realtimeService,
                                           SimulationService simulationService) {
        this.realtimeService = realtimeService;
        this.simulationService = simulationService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String sessionId = WebSocketParamUtils.queryParam(session.getUri(), "sessionId");
        if (sessionId == null) {
            try {
                session.close(CloseStatus.BAD_DATA);
            } catch (Exception ignored) {
            }
            return;
        }
        realtimeService.registerSimulationSession(sessionId, session);
        var state = simulationService.obtenerEstado(sessionId);
        if (state != null) {
            realtimeService.sendMessage(session, "SIMULATION_STATE_UPDATED", state);
        }
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
