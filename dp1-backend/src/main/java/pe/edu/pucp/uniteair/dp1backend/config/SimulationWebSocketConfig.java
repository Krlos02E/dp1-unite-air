package pe.edu.pucp.uniteair.dp1backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import pe.edu.pucp.uniteair.dp1backend.websocket.ActiveSimulationWebSocketHandler;
import pe.edu.pucp.uniteair.dp1backend.websocket.ContextStateWebSocketHandler;
import pe.edu.pucp.uniteair.dp1backend.websocket.SimulationStateWebSocketHandler;

@Configuration
@EnableWebSocket
public class SimulationWebSocketConfig implements WebSocketConfigurer {

    private final ActiveSimulationWebSocketHandler activeSimulationWebSocketHandler;
    private final SimulationStateWebSocketHandler simulationStateWebSocketHandler;
    private final ContextStateWebSocketHandler contextStateWebSocketHandler;

    public SimulationWebSocketConfig(ActiveSimulationWebSocketHandler activeSimulationWebSocketHandler,
                                     SimulationStateWebSocketHandler simulationStateWebSocketHandler,
                                     ContextStateWebSocketHandler contextStateWebSocketHandler) {
        this.activeSimulationWebSocketHandler = activeSimulationWebSocketHandler;
        this.simulationStateWebSocketHandler = simulationStateWebSocketHandler;
        this.contextStateWebSocketHandler = contextStateWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(activeSimulationWebSocketHandler, "/ws/simulacion/activa")
                .setAllowedOriginPatterns("*");
        registry.addHandler(simulationStateWebSocketHandler, "/ws/simulacion/estado")
                .setAllowedOriginPatterns("*");
        registry.addHandler(contextStateWebSocketHandler, "/ws/contexto")
                .setAllowedOriginPatterns("*");
    }
}
