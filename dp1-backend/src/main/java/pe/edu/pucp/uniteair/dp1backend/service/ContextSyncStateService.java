package pe.edu.pucp.uniteair.dp1backend.service;

import org.springframework.stereotype.Service;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class ContextSyncStateService {

    private final Map<AlmacenContexto, AtomicLong> versions = new EnumMap<>(AlmacenContexto.class);
    private final Map<AlmacenContexto, LocalDateTime> updatedAt = new EnumMap<>(AlmacenContexto.class);
    private final Map<AlmacenContexto, String> reasons = new EnumMap<>(AlmacenContexto.class);

    public ContextSyncStateService() {
        for (AlmacenContexto contexto : AlmacenContexto.values()) {
            versions.put(contexto, new AtomicLong(1));
            updatedAt.put(contexto, LocalDateTime.now(ZoneOffset.UTC));
            reasons.put(contexto, "bootstrap");
        }
    }

    public long touch(AlmacenContexto contexto, String reason) {
        AlmacenContexto ctx = contexto != null ? contexto : AlmacenContexto.OPERACION;
        long nextVersion = versions.get(ctx).incrementAndGet();
        updatedAt.put(ctx, LocalDateTime.now(ZoneOffset.UTC));
        reasons.put(ctx, reason != null && !reason.isBlank() ? reason : "unknown");
        return nextVersion;
    }

    public Map<String, Object> snapshot(AlmacenContexto contexto) {
        AlmacenContexto ctx = contexto != null ? contexto : AlmacenContexto.OPERACION;
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("contexto", ctx);
        state.put("version", versions.get(ctx).get());
        state.put("updatedAt", updatedAt.get(ctx));
        state.put("reason", reasons.get(ctx));
        return state;
    }
}
