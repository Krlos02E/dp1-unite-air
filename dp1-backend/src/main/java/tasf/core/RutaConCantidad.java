package tasf.core;

import tasf.model.Ruta;

public class RutaConCantidad {
    private final Ruta ruta;
    private final int cantidad;

    public RutaConCantidad(Ruta ruta, int cantidad) {
        this.ruta = ruta;
        this.cantidad = cantidad;
    }

    public Ruta getRuta() {
        return ruta;
    }

    public int getCantidad() {
        return cantidad;
    }
}
