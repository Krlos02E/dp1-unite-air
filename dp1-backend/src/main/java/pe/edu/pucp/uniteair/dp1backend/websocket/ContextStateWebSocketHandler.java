package pe.edu.pucp.uniteair.dp1backend.websocket;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.service.ContextSyncStateService;
import pe.edu.pucp.uniteair.dp1backend.service.SimulationRealtimeService;

@Component
public class ContextStateWebSocketHandler extends TextWebSocketHandler {

    private final SimulationRealtimeService realtimeService;
    private final ContextSyncStateService contextSyncStateService;

    public ContextStateWebSocketHandler(SimulationRealtimeService realtimeService,
                                        ContextSyncStateService contextSyncStateService) {
        this.realtimeService = realtimeService;
        this.contextSyncStateService = contextSyncStateService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String contexto = WebSocketParamUtils.queryParam(session.getUri(), "contexto");
        AlmacenContexto ctx;
        try {
            ctx = contexto != null ? AlmacenContexto.valueOf(contexto) : AlmacenContexto.OPERACION;
        } catch (IllegalArgumentException ex) {
            try {
                session.close(CloseStatus.BAD_DATA);
            } catch (Exception ignored) {
            }
            return;
        }
        realtimeService.registerContextSession(ctx, session);
        realtimeService.sendMessage(session, "CONTEXT_VERSION_CHANGED", contextSyncStateService.snapshot(ctx));
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
