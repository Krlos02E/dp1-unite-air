package pe.edu.pucp.uniteair.dp1backend.service;

import jakarta.annotation.PostConstruct;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.edu.pucp.uniteair.dp1backend.config.AeropuertoCoordenadas;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenConfiguracion;
import pe.edu.pucp.uniteair.dp1backend.entity.AlmacenContexto;
import pe.edu.pucp.uniteair.dp1backend.entity.Almacen;
import pe.edu.pucp.uniteair.dp1backend.repository.AlmacenConfiguracionRepository;
import pe.edu.pucp.uniteair.dp1backend.repository.AlmacenRepository;
import tasf.core.Dataset;
import tasf.model.Aeropuerto;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Service
public class AlmacenService {

    private final AlmacenRepository almacenRepository;
    private final AlmacenConfiguracionRepository almacenConfiguracionRepository;
    private final CargaArchivosService cargaArchivosService;

    public AlmacenService(AlmacenRepository almacenRepository,
                          AlmacenConfiguracionRepository almacenConfiguracionRepository,
                          @Lazy CargaArchivosService cargaArchivosService) {
        this.almacenRepository = almacenRepository;
        this.almacenConfiguracionRepository = almacenConfiguracionRepository;
        this.cargaArchivosService = cargaArchivosService;
    }

    @PostConstruct
    public void inicializar() {
        if (almacenRepository.count() > 0) return;
        seedDesdeArchivo();
    }

    private void seedDesdeArchivo() {
        Set<String> codigosSeed = new HashSet<>();

        // First try parsing from text file (has ciudad/pais)
        try (InputStream is = getClass().getClassLoader().getResourceAsStream(
                "default-data/input/aeropuertos/c.1inf54.26.1.v1.Aeropuerto.husos.v1.20250818__estudiantes.txt")) {
            if (is != null) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_16))) {
                    String linea;
                    while ((linea = reader.readLine()) != null) {
                        if (linea.length() < 60) continue;
                        try {
                            String codigo = linea.substring(2, 8).trim();
                            String ciudad = linea.substring(8, 24).trim();
                            String pais = linea.substring(24, 40).trim();
                            String gmtStr = linea.substring(40, 48).trim();
                            int gmtOffset = parseGmtOffset(gmtStr);
                            String capStr = linea.substring(48, 60).trim();
                            int capacidad = Integer.parseInt(capStr);
                            double[] coord = AeropuertoCoordenadas.get(codigo);
                            String continente = determinarContinente(codigo);

                            Almacen almacen = Almacen.builder()
                                    .codigoOACI(codigo)
                                    .ciudad(ciudad)
                                    .pais(pais)
                                    .continente(continente)
                                    .gmtOffsetMinutos(gmtOffset)
                                    .capacidadMaxima(capacidad)
                                    .latitud(coord[0])
                                    .longitud(coord[1])
                                    .build();
                            almacenRepository.save(almacen);
                            codigosSeed.add(codigo);
                        } catch (Exception ignored) {
                        }
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("[AlmacenService] Error seeding desde archivo: " + e.getMessage());
        }

        // Fallback: seed remaining from Dataset (no ciudad/pais available)
        try {
            Dataset dataset = cargaArchivosService.obtenerUltimoDataset();
            if (dataset != null && !dataset.getAeropuertos().isEmpty()) {
                for (Aeropuerto a : dataset.getAeropuertos().values()) {
                    if (codigosSeed.contains(a.getCodigoOACI())) continue;
                    if (almacenRepository.existsById(a.getCodigoOACI())) continue;
                    double[] coord = AeropuertoCoordenadas.get(a.getCodigoOACI());
                    Almacen almacen = Almacen.builder()
                            .codigoOACI(a.getCodigoOACI())
                            .continente(a.getContinente().name())
                            .gmtOffsetMinutos(a.getGmtOffsetMinutos())
                            .capacidadMaxima(a.getCapacidadMaxima())
                            .latitud(coord[0])
                            .longitud(coord[1])
                            .build();
                    almacenRepository.save(almacen);
                }
            }
        } catch (Exception e) {
            System.err.println("[AlmacenService] No se pudo seed desde dataset: " + e.getMessage());
        }
    }

    private int parseGmtOffset(String gmtStr) {
        try {
            gmtStr = gmtStr.trim();
            if (gmtStr.isEmpty()) return 0;
            boolean negativo = gmtStr.startsWith("-");
            String num = gmtStr.replaceAll("[^\\d]", "");
            if (num.isEmpty()) return 0;
            int val = Integer.parseInt(num);
            return negativo ? -val : val;
        } catch (Exception e) {
            return 0;
        }
    }

    private String determinarContinente(String codigoOACI) {
        char first = codigoOACI.charAt(0);
        if (first == 'K' || first == 'C' || first == 'S' || first == 'M' || first == 'T' || first == 'P') {
            return "AMERICA";
        } else if (first == 'E' || first == 'L' || first == 'U' || first == 'B') {
            return "EUROPA";
        } else if (first == 'O' || first == 'V' || first == 'R' || first == 'Z' || first == 'D' || first == 'F' || first == 'H') {
            return "ASIA";
        }
        return "AMERICA";
    }

    public List<Almacen> listar(AlmacenContexto contexto) {
        Map<String, Almacen> mapa = getMapaAlmacenes(contexto);
        return mapa.values().stream()
                .sorted((a, b) -> a.getCodigoOACI().compareToIgnoreCase(b.getCodigoOACI()))
                .toList();
    }

    public Optional<Almacen> obtenerPorId(AlmacenContexto contexto, String codigoOACI) {
        return Optional.ofNullable(getMapaAlmacenes(contexto).get(codigoOACI));
    }

    @Transactional
    public Almacen crear(AlmacenContexto contexto, Almacen almacen) {
        validarDatosAlmacen(contexto, almacen, false);
        if (almacenConfiguracionRepository.existsByContextoAndCodigoOACI(contexto, almacen.getCodigoOACI())) {
            throw new IllegalArgumentException(
                    "Ya existe una configuración de almacén para " + almacen.getCodigoOACI()
                            + " en el contexto " + contexto
            );
        }

        AlmacenConfiguracion configuracion = AlmacenConfiguracion.builder()
                .contexto(contexto)
                .codigoOACI(almacen.getCodigoOACI())
                .ciudad(almacen.getCiudad())
                .pais(almacen.getPais())
                .continente(almacen.getContinente())
                .gmtOffsetMinutos(almacen.getGmtOffsetMinutos())
                .capacidadMaxima(almacen.getCapacidadMaxima())
                .latitud(almacen.getLatitud())
                .longitud(almacen.getLongitud())
                .build();
        almacenConfiguracionRepository.save(configuracion);
        invalidarCache(contexto);
        return getMapaAlmacenes(contexto).get(almacen.getCodigoOACI());
    }

    @Transactional
    public Almacen actualizar(AlmacenContexto contexto, String codigoOACI, Almacen datos) {
        validarDatosAlmacen(contexto, datos, true);
        AlmacenConfiguracion configuracion = almacenConfiguracionRepository
                .findByContextoAndCodigoOACI(contexto, codigoOACI)
                .orElseGet(() -> AlmacenConfiguracion.builder()
                        .contexto(contexto)
                        .codigoOACI(codigoOACI)
                        .build());

        configuracion.setCiudad(datos.getCiudad());
        configuracion.setPais(datos.getPais());
        configuracion.setContinente(datos.getContinente());
        configuracion.setGmtOffsetMinutos(datos.getGmtOffsetMinutos());
        configuracion.setCapacidadMaxima(datos.getCapacidadMaxima());
        configuracion.setLatitud(datos.getLatitud());
        configuracion.setLongitud(datos.getLongitud());
        almacenConfiguracionRepository.save(configuracion);
        invalidarCache(contexto);
        return getMapaAlmacenes(contexto).get(codigoOACI);
    }

    @Transactional
    public void eliminar(AlmacenContexto contexto, String codigoOACI) {
        if (!almacenConfiguracionRepository.existsByContextoAndCodigoOACI(contexto, codigoOACI)) {
            throw new IllegalArgumentException(
                    "No existe una configuración editable para " + codigoOACI
                            + " en el contexto " + contexto
            );
        }
        almacenConfiguracionRepository.deleteByContextoAndCodigoOACI(contexto, codigoOACI);
        invalidarCache(contexto);
    }

    @Transactional
    public void limpiarContexto(AlmacenContexto contexto) {
        almacenConfiguracionRepository.deleteAllByContexto(contexto);
        invalidarCache(contexto);
    }

    private final Map<AlmacenContexto, Map<String, Almacen>> cachedMapaAlmacenes = new HashMap<>();
    private final Map<AlmacenContexto, Long> mapaCacheTime = new HashMap<>();
    private static final long MAPA_CACHE_TTL_MS = 5000;

    public Map<String, Almacen> getMapaAlmacenes(AlmacenContexto contexto) {
        long now = System.currentTimeMillis();
        long cacheTime = mapaCacheTime.getOrDefault(contexto, 0L);
        Map<String, Almacen> cached = cachedMapaAlmacenes.get(contexto);
        if (now - cacheTime > MAPA_CACHE_TTL_MS || cached == null || cached.isEmpty()) {
            Map<String, Almacen> mapa = construirMapaEfectivo(contexto);
            cachedMapaAlmacenes.put(contexto, mapa);
            mapaCacheTime.put(contexto, now);
        }
        return cachedMapaAlmacenes.getOrDefault(contexto, Map.of());
    }

    private Map<String, Almacen> construirMapaEfectivo(AlmacenContexto contexto) {
        Map<String, Almacen> mapa = new HashMap<>();
        for (Almacen base : almacenRepository.findAll()) {
            Almacen copia = copiar(base);
            copia.setEditable(false);
            mapa.put(base.getCodigoOACI(), copia);
        }

        for (AlmacenConfiguracion override : almacenConfiguracionRepository.findAllByContexto(contexto)) {
            Almacen base = mapa.getOrDefault(
                    override.getCodigoOACI(),
                    Almacen.builder().codigoOACI(override.getCodigoOACI()).build()
            );
            Almacen efectivo = aplicarOverride(base, override);
            efectivo.setEditable(true);
            mapa.put(override.getCodigoOACI(), efectivo);
        }
        return mapa;
    }

    private Almacen aplicarOverride(Almacen base, AlmacenConfiguracion override) {
        Almacen.AlmacenBuilder builder = Almacen.builder()
                .codigoOACI(base.getCodigoOACI())
                .ciudad(base.getCiudad())
                .pais(base.getPais())
                .continente(base.getContinente())
                .gmtOffsetMinutos(base.getGmtOffsetMinutos())
                .capacidadMaxima(base.getCapacidadMaxima())
                .latitud(base.getLatitud())
                .longitud(base.getLongitud());

        if (override.getCiudad() != null) builder.ciudad(override.getCiudad());
        if (override.getPais() != null) builder.pais(override.getPais());
        if (override.getContinente() != null) builder.continente(override.getContinente());
        if (override.getGmtOffsetMinutos() != null) builder.gmtOffsetMinutos(override.getGmtOffsetMinutos());
        if (override.getCapacidadMaxima() != null) builder.capacidadMaxima(override.getCapacidadMaxima());
        if (override.getLatitud() != null) builder.latitud(override.getLatitud());
        if (override.getLongitud() != null) builder.longitud(override.getLongitud());
        return builder.build();
    }

    private Almacen copiar(Almacen almacen) {
        return Almacen.builder()
                .codigoOACI(almacen.getCodigoOACI())
                .ciudad(almacen.getCiudad())
                .pais(almacen.getPais())
                .continente(almacen.getContinente())
                .gmtOffsetMinutos(almacen.getGmtOffsetMinutos())
                .capacidadMaxima(almacen.getCapacidadMaxima())
                .latitud(almacen.getLatitud())
                .longitud(almacen.getLongitud())
                .build();
    }

    private void validarDatosAlmacen(AlmacenContexto contexto, Almacen almacen, boolean actualizacion) {
        String codigo = almacen.getCodigoOACI();
        if (!actualizacion && (codigo == null || !codigo.matches("[A-Z0-9]{4}"))) {
            throw new IllegalArgumentException("El código OACI debe tener exactamente 4 caracteres alfanuméricos en mayúscula");
        }
        if (almacen.getCiudad() == null || almacen.getCiudad().isBlank()) {
            throw new IllegalArgumentException("La ciudad es obligatoria");
        }
        if (almacen.getCapacidadMaxima() <= 0) {
            throw new IllegalArgumentException("La capacidad máxima debe ser mayor que 0");
        }
        if (actualizacion && contexto == AlmacenContexto.OPERACION && codigo != null && !codigo.isBlank()) {
            int ocupacionActual = cargaArchivosService.getOcupacionAeropuerto(codigo, java.time.LocalDateTime.now(java.time.ZoneOffset.UTC));
            if (almacen.getCapacidadMaxima() < ocupacionActual) {
                throw new IllegalArgumentException(
                        "La capacidad no puede ser menor que la ocupación actual del almacén (" + ocupacionActual + " maletas)"
                );
            }
        }
    }

    private void invalidarCache(AlmacenContexto contexto) {
        cachedMapaAlmacenes.remove(contexto);
        mapaCacheTime.remove(contexto);
    }
}
