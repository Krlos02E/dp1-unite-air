package pe.edu.pucp.uniteair.dp1backend.util;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class TimezoneSedeResolver {

    private static final Map<String, SedeTimezone> ALIAS_TO_SEDE = new LinkedHashMap<>();

    static {
        registrar(new SedeTimezone("LIMA", "SPIM", "America/Lima", List.of("America/Lima")));
        registrar(new SedeTimezone(
                "BUENOS_AIRES",
                "SABE",
                "America/Argentina/Buenos_Aires",
                List.of("America/Argentina/Buenos_Aires", "America/Buenos_Aires")
        ));
        registrar(new SedeTimezone("COPENHAGEN", "EKCH", "Europe/Copenhagen", List.of("Europe/Copenhagen")));
        registrar(new SedeTimezone(
                "DELHI",
                "VIDP",
                "Asia/Kolkata",
                List.of("Asia/Kolkata", "Asia/Calcutta")
        ));
    }

    private TimezoneSedeResolver() {
    }

    private static void registrar(SedeTimezone sedeTimezone) {
        for (String alias : sedeTimezone.aliases()) {
            ALIAS_TO_SEDE.put(alias, sedeTimezone);
        }
    }

    public static String normalizarTimezoneCanonica(String timezone) {
        return resolver(timezone).timezoneCanonica();
    }

    public static String inferirAeropuertoPorTimezone(String timezone) {
        return resolver(timezone).codigoOaci();
    }

    public static SedeTimezone resolver(String timezone) {
        if (timezone == null || timezone.isBlank()) {
            throw new IllegalArgumentException("La zona horaria de la PC es obligatoria");
        }
        SedeTimezone sedeTimezone = ALIAS_TO_SEDE.get(timezone.trim());
        if (sedeTimezone == null) {
            throw new IllegalArgumentException(
                    "Zona horaria no valida para operacion dia a dia: " + timezone
                            + ". Use una de las sedes permitidas."
            );
        }
        return sedeTimezone;
    }

    public record SedeTimezone(
            String id,
            String codigoOaci,
            String timezoneCanonica,
            List<String> aliases
    ) {}
}
