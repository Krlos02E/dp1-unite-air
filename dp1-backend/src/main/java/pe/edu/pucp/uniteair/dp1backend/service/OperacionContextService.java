package pe.edu.pucp.uniteair.dp1backend.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;

@Service
public class OperacionContextService {

    private final AlmacenService almacenService;
    private final ProgramacionVueloService programacionVueloService;
    private final CargaArchivosService cargaArchivosService;

    public OperacionContextService(AlmacenService almacenService,
                                   ProgramacionVueloService programacionVueloService,
                                   CargaArchivosService cargaArchivosService) {
        this.almacenService = almacenService;
        this.programacionVueloService = programacionVueloService;
        this.cargaArchivosService = cargaArchivosService;
    }

    @Transactional
    public void reiniciarOperacion() {
        programacionVueloService.limpiarContexto(AlmacenContexto.OPERACION);
        almacenService.limpiarContexto(AlmacenContexto.OPERACION);
        cargaArchivosService.limpiarVuelosCancelados(AlmacenContexto.OPERACION);
        cargaArchivosService.restaurarDatasetBaseOperacion();
        cargaArchivosService.replanificarOperacionActual();
    }
}
