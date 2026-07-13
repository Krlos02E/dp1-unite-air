package pe.edu.pucp.uniteair.dp1backend.service;

import org.springframework.stereotype.Service;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import pe.edu.pucp.uniteair.dp1backend.dto.SimulationState;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SimulationRealtimeService {

    private final ObjectMapper objectMapper;
    private final Set<WebSocketSession> activeSessions = ConcurrentHashMap.newKeySet();
    private final Map<String, Set<WebSocketSession>> simulationSessions = new ConcurrentHashMap<>();
    private final Map<AlmacenContexto, Set<WebSocketSession>> contextSessions = new ConcurrentHashMap<>();

    public SimulationRealtimeService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void registerActiveSession(WebSocketSession session) {
        activeSessions.add(session);
    }

    public void registerSimulationSession(String simulationSessionId, WebSocketSession session) {
        simulationSessions.computeIfAbsent(simulationSessionId, key -> ConcurrentHashMap.newKeySet()).add(session);
    }

    public void registerContextSession(AlmacenContexto contexto, WebSocketSession session) {
        AlmacenContexto ctx = contexto != null ? contexto : AlmacenContexto.OPERACION;
        contextSessions.computeIfAbsent(ctx, key -> ConcurrentHashMap.newKeySet()).add(session);
    }

    public void unregister(WebSocketSession session) {
        activeSessions.remove(session);
        simulationSessions.values().forEach(set -> set.remove(session));
        contextSessions.values().forEach(set -> set.remove(session));
    }

    public void broadcastSimulationState(SimulationState state) {
        if (state == null || state.getSessionId() == null) {
            return;
        }
        broadcastToSessions(simulationSessions.get(state.getSessionId()), "SIMULATION_STATE_UPDATED", state);
        broadcastActiveState(state);
    }

    public void broadcastActiveState(SimulationState state) {
        Map<String, Object> payload = new HashMap<>();
        boolean activa = state != null
                && state.getSessionId() != null
                && state.getStatus() != null
                && !"COMPLETADA".equals(state.getStatus())
                && !"COLAPSADA".equals(state.getStatus())
                && !"ERROR".equals(state.getStatus());
        payload.put("activa", activa);
        if (state != null) {
            payload.put("sessionId", state.getSessionId());
            payload.put("status", state.getStatus());
            payload.put("progreso", state.getProgreso());
            payload.put("startedAt", state.getStartedAt());
            payload.put("simulationStartedAt", state.getFechaInicio());
            payload.put("fechaInicio", state.getFechaInicio());
            long elapsed = state.getStartedAt() != null
                    ? Duration.between(state.getStartedAt(), LocalDateTime.now()).getSeconds()
                    : 0;
            payload.put("elapsedRealtimeSeconds", Math.max(0, elapsed));
        }
        broadcastToSessions(activeSessions, "SIMULATION_ACTIVE_CHANGED", payload);
    }

    public void broadcastNoActiveSimulation() {
        broadcastToSessions(activeSessions, "SIMULATION_ACTIVE_CHANGED", Map.of("activa", false));
    }

    public void broadcastContextSnapshot(AlmacenContexto contexto, Map<String, Object> snapshot) {
        AlmacenContexto ctx = contexto != null ? contexto : AlmacenContexto.OPERACION;
        broadcastToSessions(contextSessions.get(ctx), "CONTEXT_VERSION_CHANGED", snapshot);
    }

    public void sendMessage(WebSocketSession session, String type, Object payload) {
        if (session == null || !session.isOpen()) {
            return;
        }
        try {
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(Map.of(
                    "type", type,
                    "payload", payload
            ))));
        } catch (IOException ignored) {
        }
    }

    private void broadcastToSessions(Set<WebSocketSession> sessions, String type, Object payload) {
        if (sessions == null || sessions.isEmpty()) {
            return;
        }
        sessions.removeIf(session -> !session.isOpen());
        for (WebSocketSession session : sessions) {
            sendMessage(session, type, payload);
        }
    }
}
