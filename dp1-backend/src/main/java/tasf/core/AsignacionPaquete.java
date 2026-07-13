package tasf.core;

import java.util.Collections;
import java.util.List;

public class AsignacionPaquete {
    private final List<RutaConCantidad> rutas;

    public AsignacionPaquete(List<RutaConCantidad> rutas) {
        this.rutas = rutas == null ? List.of() : List.copyOf(rutas);
    }

    public List<RutaConCantidad> getRutas() {
        return Collections.unmodifiableList(rutas);
    }

    public boolean isEmpty() {
        return rutas.isEmpty();
    }
}
