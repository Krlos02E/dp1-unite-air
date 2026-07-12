package pe.edu.pucp.uniteair.dp1backend.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.edu.pucp.uniteair.dp1backend.dto.ProgramacionVueloDTO;
import pe.edu.pucp.uniteair.dp1backend.entity.Almacen;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.entity.ProgramacionVuelo;
import pe.edu.pucp.uniteair.dp1backend.repository.ProgramacionVueloRepository;
import tasf.model.Aeropuerto;
import tasf.model.Vuelo;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class ProgramacionVueloService {

    private final ProgramacionVueloRepository programacionVueloRepository;
    private final AlmacenService almacenService;
    private final ContextSyncStateService contextSyncStateService;

    public ProgramacionVueloService(ProgramacionVueloRepository programacionVueloRepository,
                                    AlmacenService almacenService,
                                    ContextSyncStateService contextSyncStateService) {
        this.programacionVueloRepository = programacionVueloRepository;
        this.almacenService = almacenService;
        this.contextSyncStateService = contextSyncStateService;
    }

    public List<ProgramacionVueloDTO> listar(AlmacenContexto contexto) {
        return programacionVueloRepository
                .findAllByContextoOrderByOrigenOACIAscDestinoOACIAscHoraSalidaLocalAsc(contexto)
                .stream()
                .map(this::toDto)
                .toList();
    }

    @Transactional
    public ProgramacionVueloDTO crear(AlmacenContexto contexto, ProgramacionVueloDTO dto) {
        ProgramacionVuelo entity = new ProgramacionVuelo();
        entity.setContexto(contexto);
        aplicarDatos(entity, dto, contexto);
        ProgramacionVueloDTO created = toDto(programacionVueloRepository.save(entity));
        contextSyncStateService.touch(contexto, "programacion-creada");
        return created;
    }

    @Transactional
    public ProgramacionVueloDTO actualizar(AlmacenContexto contexto, Long id, ProgramacionVueloDTO dto) {
        ProgramacionVuelo entity = programacionVueloRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("No existe la programación de vuelo " + id));
        if (entity.getContexto() != contexto) {
            throw new IllegalArgumentException("La programación de vuelo no pertenece al contexto " + contexto);
        }
        aplicarDatos(entity, dto, contexto);
        ProgramacionVueloDTO updated = toDto(programacionVueloRepository.save(entity));
        contextSyncStateService.touch(contexto, "programacion-actualizada");
        return updated;
    }

    @Transactional
    public void eliminar(AlmacenContexto contexto, Long id) {
        ProgramacionVuelo entity = programacionVueloRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("No existe la programación de vuelo " + id));
        if (entity.getContexto() != contexto) {
            throw new IllegalArgumentException("La programación de vuelo no pertenece al contexto " + contexto);
        }
        programacionVueloRepository.delete(entity);
        contextSyncStateService.touch(contexto, "programacion-eliminada");
    }

    @Transactional
    public void limpiarContexto(AlmacenContexto contexto) {
        programacionVueloRepository.deleteAllByContexto(contexto);
        contextSyncStateService.touch(contexto, "programacion-contexto-limpiada");
    }

    public List<Vuelo> generarVuelosRecurrentes(
            AlmacenContexto contexto,
            Map<String, Aeropuerto> aeropuertos,
            LocalDate fechaInicio,
            int dias
    ) {
        if (dias <= 0) {
            return List.of();
        }

        List<Vuelo> vuelos = new ArrayList<>();
        List<ProgramacionVuelo> programaciones = programacionVueloRepository
                .findAllByContextoOrderByOrigenOACIAscDestinoOACIAscHoraSalidaLocalAsc(contexto);

        for (ProgramacionVuelo programacion : programaciones) {
            Aeropuerto origen = aeropuertos.get(programacion.getOrigenOACI());
            Aeropuerto destino = aeropuertos.get(programacion.getDestinoOACI());
            if (origen == null || destino == null) {
                continue;
            }

            for (int offset = 0; offset < dias; offset++) {
                LocalDate fecha = fechaInicio.plusDays(offset);
                String id = "USR-" + programacion.getId() + "-" + fecha;
                vuelos.add(new Vuelo(
                        id,
                        origen,
                        destino,
                        fecha,
                        programacion.getHoraSalidaLocal(),
                        programacion.getHoraLlegadaLocal(),
                        programacion.getCapacidad()
                ));
            }
        }

        return vuelos;
    }

    private void aplicarDatos(ProgramacionVuelo entity, ProgramacionVueloDTO dto, AlmacenContexto contexto) {
        if (dto == null) {
            throw new IllegalArgumentException("La programación de vuelo es obligatoria");
        }

        String origen = normalizarCodigo(dto.getOrigenOACI(), "El origen es obligatorio");
        String destino = normalizarCodigo(dto.getDestinoOACI(), "El destino es obligatorio");
        if (origen.equals(destino)) {
            throw new IllegalArgumentException("El origen y el destino deben ser diferentes");
        }

        Map<String, Almacen> almacenes = almacenService.getMapaAlmacenes(contexto);
        if (!almacenes.containsKey(origen)) {
            throw new IllegalArgumentException("El almacén origen " + origen + " no existe en el contexto " + contexto);
        }
        if (!almacenes.containsKey(destino)) {
            throw new IllegalArgumentException("El almacén destino " + destino + " no existe en el contexto " + contexto);
        }

        LocalTime salida = parseHora(dto.getHoraSalidaLocal(), "La hora de salida es inválida");
        LocalTime llegada = parseHora(dto.getHoraLlegadaLocal(), "La hora de llegada es inválida");
        if (dto.getCapacidad() <= 0) {
            throw new IllegalArgumentException("La capacidad debe ser mayor que 0");
        }

        entity.setOrigenOACI(origen);
        entity.setDestinoOACI(destino);
        entity.setHoraSalidaLocal(salida);
        entity.setHoraLlegadaLocal(llegada);
        entity.setCapacidad(dto.getCapacidad());
    }

    private String normalizarCodigo(String codigo, String mensajeError) {
        if (codigo == null || codigo.isBlank()) {
            throw new IllegalArgumentException(mensajeError);
        }
        String normalizado = codigo.trim().toUpperCase();
        if (!normalizado.matches("[A-Z0-9]{4}")) {
            throw new IllegalArgumentException("El código OACI debe tener exactamente 4 caracteres alfanuméricos");
        }
        return normalizado;
    }

    private LocalTime parseHora(String valor, String mensajeError) {
        try {
            return LocalTime.parse(valor);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException(mensajeError);
        }
    }

    private ProgramacionVueloDTO toDto(ProgramacionVuelo entity) {
        return ProgramacionVueloDTO.builder()
                .id(entity.getId())
                .origenOACI(entity.getOrigenOACI())
                .destinoOACI(entity.getDestinoOACI())
                .horaSalidaLocal(entity.getHoraSalidaLocal() != null ? entity.getHoraSalidaLocal().toString() : null)
                .horaLlegadaLocal(entity.getHoraLlegadaLocal() != null ? entity.getHoraLlegadaLocal().toString() : null)
                .capacidad(entity.getCapacidad() != null ? entity.getCapacidad() : 0)
                .build();
    }
}
