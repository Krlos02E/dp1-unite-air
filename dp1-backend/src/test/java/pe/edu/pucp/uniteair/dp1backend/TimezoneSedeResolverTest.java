package pe.edu.pucp.uniteair.dp1backend;

import org.junit.jupiter.api.Test;
import pe.edu.pucp.uniteair.dp1backend.util.TimezoneSedeResolver;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TimezoneSedeResolverTest {

    @Test
    void aceptaLasCuatroZonasCanonicas() {
        assertEquals("SPIM", TimezoneSedeResolver.inferirAeropuertoPorTimezone("America/Lima"));
        assertEquals("SABE", TimezoneSedeResolver.inferirAeropuertoPorTimezone("America/Argentina/Buenos_Aires"));
        assertEquals("EKCH", TimezoneSedeResolver.inferirAeropuertoPorTimezone("Europe/Copenhagen"));
        assertEquals("VIDP", TimezoneSedeResolver.inferirAeropuertoPorTimezone("Asia/Kolkata"));
    }

    @Test
    void normalizaLosAliasesPermitidos() {
        assertEquals("America/Argentina/Buenos_Aires",
                TimezoneSedeResolver.normalizarTimezoneCanonica("America/Buenos_Aires"));
        assertEquals("Asia/Kolkata",
                TimezoneSedeResolver.normalizarTimezoneCanonica("Asia/Calcutta"));
    }

    @Test
    void rechazaZonasNoPermitidas() {
        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                () -> TimezoneSedeResolver.inferirAeropuertoPorTimezone("Europe/Berlin")
        );
        assertEquals(
                "Zona horaria no valida para operacion dia a dia: Europe/Berlin. Use una de las sedes permitidas.",
                exception.getMessage()
        );
    }
}
