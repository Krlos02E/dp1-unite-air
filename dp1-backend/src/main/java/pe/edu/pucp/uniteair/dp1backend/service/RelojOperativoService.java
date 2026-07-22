package pe.edu.pucp.uniteair.dp1backend.service;

import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

@Service
public class RelojOperativoService {
    private final Clock clock;

    public RelojOperativoService() {
        this(Clock.systemUTC());
    }

    RelojOperativoService(Clock clock) {
        this.clock = clock;
    }

    public Instant obtenerInstanteActual() {
        return clock.instant();
    }

    public LocalDateTime obtenerTiempoActualUtc() {
        return LocalDateTime.ofInstant(obtenerInstanteActual(), ZoneOffset.UTC);
    }
}
