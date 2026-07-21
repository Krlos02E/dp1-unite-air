#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_AIRPORTS = ROOT / "dp1-backend/src/main/resources/default-data/input/aeropuertos/c.1inf54.26.1.v1.Aeropuerto.husos.v1.20250818__estudiantes.txt"
DEFAULT_FLIGHTS = ROOT / "dp1-backend/src/main/resources/default-data/input/vuelos/planes_vuelo.txt"

SEDES = {
    "SPIM": {"city": "Lima", "timezone": "America/Lima", "airport_file_gmt_hours": -5},
    "SABE": {"city": "Buenos Aires", "timezone": "America/Argentina/Buenos_Aires", "airport_file_gmt_hours": -3},
    "EKCH": {"city": "Copenhague", "timezone": "Europe/Copenhagen", "airport_file_gmt_hours": 2},
    "VIDP": {"city": "Delhi", "timezone": "Asia/Kolkata", "airport_file_gmt_hours": 5},
}

SEDES_ORDENADAS = ["SPIM", "SABE", "EKCH", "VIDP"]

DESTINOS_CURSO = [
    ("SCEL", 180),
    ("SVMI", 180),
    ("SBBR", 10),
    ("SKBO", 10),
    ("SGAS", 15),
    ("SUAA", 15),
    ("EBCI", 180),
    ("LBSF", 180),
    ("OAKB", 10),
    ("OPKC", 10),
    ("EHAM", 15),
    ("OMDB", 15),
]

SUBCONJUNTO_MANUAL = ["SCEL", "SVMI", "SBBR", "EBCI", "EHAM", "OMDB"]
SUBCONJUNTO_ARCHIVO = ["SKBO", "SGAS", "SUAA", "LBSF", "OAKB", "EHAM"]

ADDITIONAL_TEMPLATE = {
    "SPIM": {
        "south_america": ["SCEL", "SVMI", "SBBR", "SKBO", "SGAS", "SUAA"],
        "outside": ["EBCI", "LBSF", "OAKB", "OPKC", "EHAM", "OMDB"],
    },
    "SABE": {
        "south_america": ["SCEL", "SVMI", "SBBR", "SKBO", "SGAS", "SUAA"],
        "outside": ["EBCI", "LBSF", "OAKB", "OPKC", "EHAM", "OMDB"],
    },
    "EKCH": {
        "europe_asia": ["EBCI", "LBSF", "OAKB", "OPKC", "EHAM", "OMDB"],
        "outside": ["SCEL", "SVMI", "SBBR", "SKBO", "SGAS", "SUAA"],
    },
    "VIDP": {
        "europe_asia": ["EBCI", "LBSF", "OAKB", "OPKC", "EHAM", "OMDB"],
        "outside": ["SCEL", "SVMI", "SBBR", "SKBO", "SGAS", "SUAA"],
    },
}

DEPARTURE_OFFSETS = [
    timedelta(hours=1, minutes=12),
    timedelta(hours=1, minutes=24),
    timedelta(hours=2, minutes=12),
    timedelta(hours=2, minutes=24),
    timedelta(hours=3, minutes=12),
    timedelta(hours=3, minutes=24),
]

MANUAL_INPUT_OFFSETS = [
    timedelta(minutes=5),
    timedelta(minutes=10),
    timedelta(minutes=15),
    timedelta(minutes=20),
    timedelta(minutes=25),
    timedelta(minutes=30),
]

FILE_INPUT_OFFSETS = [
    timedelta(minutes=35),
    timedelta(minutes=40),
    timedelta(minutes=45),
    timedelta(minutes=50),
    timedelta(minutes=55),
    timedelta(minutes=60),
]

PATRON_AEROPUERTO = re.compile(r"^(\s*\d+\s+)([A-Z]{4})(\s+.*?\s+)([+-]\d+)(\s+)(\d+)(\s+Latitude.*)$")


@dataclass(frozen=True)
class Airport:
    code: str
    continent: str
    gmt_hours: int
    capacity: int
    raw_line: str


@dataclass(frozen=True)
class FlightLine:
    origin: str
    destination: str
    departure_local: time
    arrival_local: time
    capacity: int
    source: str


@dataclass(frozen=True)
class FlightInstance:
    flight_id: str
    origin: str
    destination: str
    departure_utc: datetime
    arrival_utc: datetime
    source: str


@dataclass(frozen=True)
class Shipment:
    shipment_id: str
    origin: str
    destination: str
    quantity: int
    local_date: date
    local_time: time
    client_id: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Genera archivos de ensayo para Operaciones Día a Día.")
    parser.add_argument("--fecha", default=str(date.today()), help="Fecha de la prueba en formato YYYY-MM-DD.")
    parser.add_argument("--hora-lima", default="08:00", help="Hora exacta de inicio en Lima, formato HH:MM.")
    parser.add_argument("--estudiantes", type=int, default=4, help="Cantidad de estudiantes. Debe ser 4 para este escenario.")
    parser.add_argument(
        "--salida",
        default=str(ROOT / "operacion-dia-a-dia" / f"salida_{date.today().isoformat()}_0800"),
        help="Carpeta de salida.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.estudiantes != 4:
        raise SystemExit("Este generador está definido para 4 estudiantes/sedes.")

    fecha_prueba = date.fromisoformat(args.fecha)
    hora_lima = time.fromisoformat(args.hora_lima)
    salida = Path(args.salida).resolve()
    salida.mkdir(parents=True, exist_ok=True)

    airports_data = parse_airports(DEFAULT_AIRPORTS)
    validate_required_airports(airports_data)

    if has_copenhagen_offset_mismatch(fecha_prueba):
        print(
            "[ADVERTENCIA] La fecha elegida cae con Europe/Copenhagen en UTC+1, "
            "pero el parser actual usa GMT fijo +2 desde el archivo de aeropuertos."
        )

    test_start_utc = datetime.combine(fecha_prueba, hora_lima, ZoneInfo("America/Lima")).astimezone(ZoneInfo("UTC"))
    local_starts = {
        code: test_start_utc.astimezone(ZoneInfo(data["timezone"]))
        for code, data in SEDES.items()
    }

    base_flights_lines = load_base_flights(DEFAULT_FLIGHTS)
    additional_flights_lines = build_additional_flights(local_starts)
    combined_flights_lines = base_flights_lines + additional_flights_lines

    manual_guide = build_manual_guide(local_starts)
    file_shipments = build_file_shipments(local_starts)
    bootstrap_file = " \n"

    write_airport_variant(DEFAULT_AIRPORTS, salida / "aeropuertos_preparacion_operacion_dia_a_dia.txt", {
        "SPIM": 999,
        "SABE": 999,
        "EKCH": 999,
        "VIDP": 999,
    })
    write_airport_variant(DEFAULT_AIRPORTS, salida / "aeropuertos_restauracion_operacion_dia_a_dia.txt", {
        "SPIM": 440,
        "SABE": 460,
        "EKCH": 480,
        "VIDP": 480,
    })

    flights_output = salida / "planes_vuelo_operacion_dia_a_dia.txt"
    flights_output.write_text("\n".join(format_flight_line(line) for line in combined_flights_lines) + "\n", encoding="utf-8")

    (salida / "envios_bootstrap_SPIM.txt").write_text(bootstrap_file, encoding="utf-8")
    (salida / "envios_manuales_guia.txt").write_text(render_manual_guide(manual_guide), encoding="utf-8")
    for code, shipments in file_shipments.items():
        (salida / f"envios_{code}.txt").write_text(render_shipments(shipments) + "\n", encoding="utf-8")

    validation = validate_generated_data(
        airports_path=salida / "aeropuertos_preparacion_operacion_dia_a_dia.txt",
        flights_path=flights_output,
        local_starts=local_starts,
        file_shipments=file_shipments,
        additional_flights_lines=additional_flights_lines,
    )

    readme_output = salida / "README_operacion_dia_a_dia.md"
    readme_output.write_text(
        render_readme(
            fecha_prueba=fecha_prueba,
            hora_lima=hora_lima,
            local_starts=local_starts,
            validation=validation,
        ),
        encoding="utf-8",
    )

    (salida / "validacion_operacion_dia_a_dia.json").write_text(
        json.dumps(validation, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Archivos generados en: {salida}")
    print(f"Vuelo candidato a cancelar: {validation['cancelacion']['vuelo_candidato']}")


def parse_airports(path: Path) -> dict[str, Airport]:
    airports: dict[str, Airport] = {}
    continent = None
    for raw_line in path.read_text(encoding="utf-16").splitlines():
        stripped = raw_line.strip()
        if not stripped:
            continue
        lower = stripped.lower()
        if "america del sur" in lower:
            continent = "AMERICA"
            continue
        if lower == "europa":
            continent = "EUROPA"
            continue
        if lower == "asia":
            continent = "ASIA"
            continue
        match = PATRON_AEROPUERTO.match(raw_line)
        if not match or continent is None:
            continue
        code = match.group(2)
        gmt_hours = int(match.group(4))
        capacity = int(match.group(6))
        airports[code] = Airport(code=code, continent=continent, gmt_hours=gmt_hours, capacity=capacity, raw_line=raw_line)
    if not airports:
        raise ValueError(f"No se pudieron parsear aeropuertos desde {path}")
    return airports


def validate_required_airports(airports: dict[str, Airport]) -> None:
    required = {code for code in SEDES} | {dest for dest, _ in DESTINOS_CURSO}
    missing = sorted(required - airports.keys())
    if missing:
        raise ValueError(f"Faltan aeropuertos requeridos en el dataset: {', '.join(missing)}")


def has_copenhagen_offset_mismatch(fecha_prueba: date) -> bool:
    copenhagen = ZoneInfo("Europe/Copenhagen")
    dt = datetime.combine(fecha_prueba, time(12, 0), copenhagen)
    dynamic_hours = int(dt.utcoffset().total_seconds() // 3600)
    return dynamic_hours != SEDES["EKCH"]["airport_file_gmt_hours"]


def load_base_flights(path: Path) -> list[FlightLine]:
    lines: list[FlightLine] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        origin, destination, dep, arr, capacity = raw.split("-")
        lines.append(
            FlightLine(
                origin=origin,
                destination=destination,
                departure_local=time.fromisoformat(dep),
                arrival_local=time.fromisoformat(arr),
                capacity=int(capacity),
                source="base",
            )
        )
    return lines


def build_additional_flights(local_starts: dict[str, datetime]) -> list[FlightLine]:
    flights: list[FlightLine] = []
    for origin in SEDES_ORDENADAS:
        start_local = local_starts[origin]
        source_continent = "south_america" if origin in {"SPIM", "SABE"} else "europe_asia"
        for block_name, destinations in ADDITIONAL_TEMPLATE[origin].items():
            duration_hours = resolve_duration(origin, block_name)
            for idx, destination in enumerate(destinations):
                departure_local_dt = (start_local + DEPARTURE_OFFSETS[idx]).replace(second=0, microsecond=0)
                arrival_local_dt = compute_arrival_local(
                    departure_local_dt,
                    SEDES[origin]["timezone"],
                    infer_timezone_for_airport(destination),
                    timedelta(hours=duration_hours),
                )
                flights.append(
                    FlightLine(
                        origin=origin,
                        destination=destination,
                        departure_local=departure_local_dt.timetz().replace(tzinfo=None),
                        arrival_local=arrival_local_dt.timetz().replace(tzinfo=None),
                        capacity=150,
                        source="additional",
                    )
                )
    return flights


def resolve_duration(origin: str, block_name: str) -> int:
    if origin in {"SPIM", "SABE"}:
        return 6 if block_name == "south_america" else 12
    return 4 if block_name == "europe_asia" else 13


def infer_timezone_for_airport(code: str) -> str:
    custom = {
        "SCEL": "America/Santiago",
        "SVMI": "America/Caracas",
        "SBBR": "America/Sao_Paulo",
        "SKBO": "America/Bogota",
        "SGAS": "America/Asuncion",
        "SUAA": "America/Montevideo",
        "EBCI": "Europe/Brussels",
        "LBSF": "Europe/Sofia",
        "OAKB": "Asia/Kabul",
        "OPKC": "Asia/Karachi",
        "EHAM": "Europe/Amsterdam",
        "OMDB": "Asia/Dubai",
        "SPIM": "America/Lima",
        "SABE": "America/Argentina/Buenos_Aires",
        "EKCH": "Europe/Copenhagen",
        "VIDP": "Asia/Kolkata",
    }
    if code not in custom:
        raise ValueError(f"No hay zona IANA definida para {code}")
    return custom[code]


def compute_arrival_local(
    departure_local_dt: datetime,
    origin_timezone: str,
    destination_timezone: str,
    duration: timedelta,
) -> datetime:
    departure_aware = departure_local_dt.replace(tzinfo=ZoneInfo(origin_timezone))
    arrival_utc = departure_aware.astimezone(ZoneInfo("UTC")) + duration
    return arrival_utc.astimezone(ZoneInfo(destination_timezone))


def build_manual_guide(local_starts: dict[str, datetime]) -> dict[str, list[dict[str, str | int]]]:
    guide: dict[str, list[dict[str, str | int]]] = {}
    for code in SEDES_ORDENADAS:
        entries = []
        for idx, destination in enumerate(SUBCONJUNTO_MANUAL):
            quantity = dict(DESTINOS_CURSO)[destination]
            local_dt = (local_starts[code] + MANUAL_INPUT_OFFSETS[idx]).replace(second=0, microsecond=0)
            entries.append(
                {
                    "destino": destination,
                    "cantidad": quantity,
                    "cliente": "0007729",
                    "hora_local_referencial": local_dt.strftime("%Y-%m-%d %H:%M"),
                }
            )
        guide[code] = entries
    return guide


def build_file_shipments(local_starts: dict[str, datetime]) -> dict[str, list[Shipment]]:
    shipments_by_site: dict[str, list[Shipment]] = {}
    base_id = {
        "SPIM": 11000001,
        "SABE": 12000001,
        "EKCH": 13000001,
        "VIDP": 14000001,
    }
    quantity_map = dict(DESTINOS_CURSO)
    for code in SEDES_ORDENADAS:
        shipments: list[Shipment] = []
        for idx, destination in enumerate(SUBCONJUNTO_ARCHIVO):
            local_dt = (local_starts[code] + FILE_INPUT_OFFSETS[idx]).replace(second=0, microsecond=0)
            shipments.append(
                Shipment(
                    shipment_id=str(base_id[code] + idx),
                    origin=code,
                    destination=destination,
                    quantity=quantity_map[destination],
                    local_date=local_dt.date(),
                    local_time=local_dt.timetz().replace(tzinfo=None),
                    client_id="0007729",
                )
            )
        shipments_by_site[code] = shipments
    return shipments_by_site


def format_flight_line(flight: FlightLine) -> str:
    return (
        f"{flight.origin}-{flight.destination}-"
        f"{flight.departure_local.strftime('%H:%M')}-"
        f"{flight.arrival_local.strftime('%H:%M')}-"
        f"{flight.capacity:04d}"
    )


def render_manual_guide(manual_guide: dict[str, list[dict[str, str | int]]]) -> str:
    lines: list[str] = []
    labels = {
        "SPIM": "Estudiante 1 - SPIM - Lima",
        "SABE": "Estudiante 2 - SABE - Buenos Aires",
        "EKCH": "Estudiante 3 - EKCH - Copenhague",
        "VIDP": "Estudiante 4 - VIDP - Delhi",
    }
    for code in SEDES_ORDENADAS:
        lines.append(labels[code])
        lines.append("Ingresar solo estos valores en la pantalla manual:")
        for idx, entry in enumerate(manual_guide[code], start=1):
            lines.append(
                f"{idx:02d}. destino={entry['destino']} cantidad={entry['cantidad']} cliente={entry['cliente']} "
                f"(hora local referencial: {entry['hora_local_referencial']})"
            )
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def render_shipments(shipments: Iterable[Shipment]) -> str:
    return "\n".join(
        f"{shipment.shipment_id}-{shipment.local_date.strftime('%Y%m%d')}-"
        f"{shipment.local_time.strftime('%H')}-{shipment.local_time.strftime('%M')}-"
        f"{shipment.destination}-{shipment.quantity:03d}-{shipment.client_id}"
        for shipment in shipments
    )


def write_airport_variant(source: Path, target: Path, capacities: dict[str, int]) -> None:
    content = source.read_text(encoding="utf-16").splitlines()
    updated: list[str] = []
    for line in content:
        match = PATRON_AEROPUERTO.match(line)
        if match and match.group(2) in capacities:
            replacement = (
                f"{match.group(1)}{match.group(2)}{match.group(3)}{match.group(4)}"
                f"{match.group(5)}{capacities[match.group(2)]}{match.group(7)}"
            )
            updated.append(replacement)
        else:
            updated.append(line)
    target.write_text("\n".join(updated) + "\n", encoding="utf-16")


def validate_generated_data(
    airports_path: Path,
    flights_path: Path,
    local_starts: dict[str, datetime],
    file_shipments: dict[str, list[Shipment]],
    additional_flights_lines: list[FlightLine],
) -> dict:
    airports = parse_airports(airports_path)
    flights_lines = load_base_flights(flights_path)
    flight_instances = build_flight_instances(flights_lines, airports, local_starts["SPIM"].date())

    validate_no_comments(flights_path)
    validate_unique_shipment_ids(file_shipments)
    validate_additional_flight_conversions(additional_flights_lines, local_starts)

    route_checks = []
    for code, shipments in file_shipments.items():
        for shipment in shipments:
            route = find_route(shipment, flight_instances, airports, excluded_flight_ids=set())
            if not route:
                raise ValueError(f"El envío {shipment.shipment_id} no tiene ruta viable")
            route_checks.append(
                {
                    "shipmentId": shipment.shipment_id,
                    "origin": shipment.origin,
                    "destination": shipment.destination,
                    "route": [flight.flight_id for flight in route],
                }
            )

    cancelation = select_cancelation_candidate(file_shipments, flight_instances, airports)
    return {
        "fecha_prueba": local_starts["SPIM"].date().isoformat(),
        "hora_inicio_lima": local_starts["SPIM"].strftime("%H:%M"),
        "zonas_locales": {
            code: {
                "timezone": SEDES[code]["timezone"],
                "inicio_local": local_starts[code].strftime("%Y-%m-%d %H:%M"),
            }
            for code in SEDES_ORDENADAS
        },
        "archivos_validados": {
            "aeropuertos_preparacion": str(airports_path),
            "planes_vuelo": str(flights_path),
        },
        "rutas_envios_archivo": route_checks,
        "cancelacion": cancelation,
        "diferencias_formato": [
            "El uploader actual reemplaza el dataset de vuelos; por eso planes_vuelo_operacion_dia_a_dia.txt incluye vuelos base y adicionales.",
            "El parser real de envíos requiere archivos separados por sede y el origen se infiere por el nombre del archivo o por timezone del request, no por una columna dentro de la línea.",
            "El parser de aeropuertos consume el archivo maestro completo en UTF-16; no acepta un patch parcial de capacidades.",
            "El backend actual requiere enviar un archivo de envíos incluso cuando se sube un dataset completo; por eso se genera envios_bootstrap_SPIM.txt con solo espacio en blanco.",
            "El modelo de vuelos usa offsets GMT fijos del archivo de aeropuertos; Europe/Copenhagen no es verdaderamente dinámico si se elige una fecha de invierno.",
        ],
    }


def validate_no_comments(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("**"):
            raise ValueError(f"Se encontró comentario no permitido en {path}")


def validate_unique_shipment_ids(file_shipments: dict[str, list[Shipment]]) -> None:
    seen: set[str] = set()
    for shipments in file_shipments.values():
        for shipment in shipments:
            if shipment.shipment_id in seen:
                raise ValueError(f"ID duplicado: {shipment.shipment_id}")
            seen.add(shipment.shipment_id)


def validate_additional_flight_conversions(additional_flights: list[FlightLine], local_starts: dict[str, datetime]) -> None:
    for flight in additional_flights:
        expected_timezone = infer_timezone_for_airport(flight.destination)
        departure_local_dt = None
        for offset in DEPARTURE_OFFSETS:
            candidate = (local_starts[flight.origin] + offset).replace(second=0, microsecond=0)
            if candidate.time() == flight.departure_local:
                departure_local_dt = candidate
                break
        if departure_local_dt is None:
            raise ValueError(f"No se pudo reconstruir la salida local de {flight.origin}-{flight.destination}")
        duration_hours = resolve_duration(
            flight.origin,
            "south_america" if flight.origin in {"SPIM", "SABE"} and flight.destination in ADDITIONAL_TEMPLATE[flight.origin]["south_america"]
            else "outside" if flight.origin in {"SPIM", "SABE"}
            else "europe_asia" if flight.destination in ADDITIONAL_TEMPLATE[flight.origin]["europe_asia"]
            else "outside"
        )
        arrival = compute_arrival_local(
            departure_local_dt,
            SEDES[flight.origin]["timezone"],
            expected_timezone,
            timedelta(hours=duration_hours),
        )
        if arrival.time().replace(second=0, microsecond=0) != flight.arrival_local:
            raise ValueError(f"Llegada inconsistente en {flight.origin}-{flight.destination}")


def build_flight_instances(flights: list[FlightLine], airports: dict[str, Airport], base_date: date, days: int = 3) -> list[FlightInstance]:
    instances: list[FlightInstance] = []
    counters: defaultdict[tuple[str, str], int] = defaultdict(int)
    for flight in flights:
        for day_offset in range(days):
            current_date = base_date + timedelta(days=day_offset)
            counters[(flight.origin, flight.destination)] += 1
            instance_id = f"{flight.origin}-{flight.destination}-{current_date.isoformat()}-{counters[(flight.origin, flight.destination)]}"
            dep_utc, arr_utc = local_flight_to_utc(
                airports[flight.origin].gmt_hours,
                airports[flight.destination].gmt_hours,
                current_date,
                flight.departure_local,
                flight.arrival_local,
            )
            instances.append(
                FlightInstance(
                    flight_id=instance_id,
                    origin=flight.origin,
                    destination=flight.destination,
                    departure_utc=dep_utc,
                    arrival_utc=arr_utc,
                    source=flight.source,
                )
            )
    instances.sort(key=lambda item: item.departure_utc)
    return instances


def local_flight_to_utc(origin_gmt_hours: int, destination_gmt_hours: int, flight_date: date, departure_local: time, arrival_local: time) -> tuple[datetime, datetime]:
    departure_local_dt = datetime.combine(flight_date, departure_local)
    arrival_local_dt = datetime.combine(flight_date, arrival_local)
    if arrival_local_dt <= departure_local_dt:
        arrival_local_dt += timedelta(days=1)
    dep_utc = departure_local_dt - timedelta(hours=origin_gmt_hours)
    arr_utc = arrival_local_dt - timedelta(hours=destination_gmt_hours)
    while arr_utc <= dep_utc:
        arrival_local_dt += timedelta(days=1)
        arr_utc = arrival_local_dt - timedelta(hours=destination_gmt_hours)
    return dep_utc, arr_utc


def shipment_creation_utc(shipment: Shipment, airports: dict[str, Airport]) -> datetime:
    return datetime.combine(shipment.local_date, shipment.local_time) - timedelta(hours=airports[shipment.origin].gmt_hours)


def find_route(
    shipment: Shipment,
    flights: list[FlightInstance],
    airports: dict[str, Airport],
    excluded_flight_ids: set[str],
    max_legs: int = 3,
) -> list[FlightInstance] | None:
    flights_by_origin: defaultdict[str, list[FlightInstance]] = defaultdict(list)
    for flight in flights:
        if flight.flight_id in excluded_flight_ids:
            continue
        flights_by_origin[flight.origin].append(flight)

    start_utc = shipment_creation_utc(shipment, airports)
    queue = deque([(shipment.origin, start_utc, [])])
    best_seen: dict[tuple[str, int], datetime] = {(shipment.origin, 0): start_utc}

    while queue:
        airport_code, ready_time, path = queue.popleft()
        if airport_code == shipment.destination and path:
            return path
        if len(path) >= max_legs:
            continue
        for flight in flights_by_origin.get(airport_code, []):
            minimum_departure = ready_time if not path else ready_time + timedelta(minutes=10)
            if flight.departure_utc < minimum_departure:
                continue
            if any(existing.flight_id == flight.flight_id for existing in path):
                continue
            next_path = path + [flight]
            state_key = (flight.destination, len(next_path))
            best_time = best_seen.get(state_key)
            if best_time is not None and flight.arrival_utc >= best_time:
                continue
            best_seen[state_key] = flight.arrival_utc
            queue.append((flight.destination, flight.arrival_utc, next_path))
    return None


def select_cancelation_candidate(
    file_shipments: dict[str, list[Shipment]],
    flights: list[FlightInstance],
    airports: dict[str, Airport],
) -> dict:
    for code in SEDES_ORDENADAS:
        for shipment in file_shipments[code]:
            primary_route = find_route(shipment, flights, airports, excluded_flight_ids=set())
            if not primary_route:
                continue
            first_leg = primary_route[0]
            alternative = find_route(shipment, flights, airports, excluded_flight_ids={first_leg.flight_id})
            if alternative and [flight.flight_id for flight in alternative] != [flight.flight_id for flight in primary_route]:
                return {
                    "envio_candidato": shipment.shipment_id,
                    "origen": shipment.origin,
                    "destino": shipment.destination,
                    "vuelo_candidato": first_leg.flight_id,
                    "ruta_inicial": [flight.flight_id for flight in primary_route],
                    "ruta_alternativa": [flight.flight_id for flight in alternative],
                }
    raise ValueError("No se encontró un vuelo cancelable con ruta alternativa")


def render_readme(
    fecha_prueba: date,
    hora_lima: time,
    local_starts: dict[str, datetime],
    validation: dict,
) -> str:
    cancelacion = validation["cancelacion"]
    return f"""# Operaciones Día a Día

## Parámetros usados

- Fecha de prueba: `{fecha_prueba.isoformat()}`
- Hora de inicio en Lima: `{hora_lima.strftime("%H:%M")}`
- Salida local SPIM: `{local_starts['SPIM'].strftime("%Y-%m-%d %H:%M")} ({SEDES['SPIM']['timezone']})`
- Salida local SABE: `{local_starts['SABE'].strftime("%Y-%m-%d %H:%M")} ({SEDES['SABE']['timezone']})`
- Salida local EKCH: `{local_starts['EKCH'].strftime("%Y-%m-%d %H:%M")} ({SEDES['EKCH']['timezone']})`
- Salida local VIDP: `{local_starts['VIDP'].strftime("%Y-%m-%d %H:%M")} ({SEDES['VIDP']['timezone']})`

## Cómo regenerar

```bash
python3 scripts/generar_operacion_dia_a_dia.py \\
  --fecha {fecha_prueba.isoformat()} \\
  --hora-lima {hora_lima.strftime("%H:%M")} \\
  --estudiantes 4 \\
  --salida {Path(validation['archivos_validados']['planes_vuelo']).parent}
```

## Orden de carga recomendado

1. Subir `aeropuertos_preparacion_operacion_dia_a_dia.txt`, `planes_vuelo_operacion_dia_a_dia.txt` y `envios_bootstrap_SPIM.txt` desde Gestión de Envíos.
2. Verificar que el backend acepte el dataset completo.
3. Cada sede registra sus envíos manuales usando `envios_manuales_guia.txt`.
4. Luego cada sede carga su archivo `envios_XXXX.txt` desde una PC con la zona horaria correcta de esa sede.
5. Revisar rutas y estados en Operación Día a Día.
6. Cancelar el vuelo candidato indicado abajo y verificar la reasignación.
7. Al terminar, restaurar el archivo `aeropuertos_restauracion_operacion_dia_a_dia.txt` y volver a cargar el `planes_vuelo.txt` original del proyecto si se desea retornar al dataset base.

## Cancelación sugerida

- Envío afectado: `{cancelacion['envio_candidato']}`
- Origen: `{cancelacion['origen']}`
- Destino: `{cancelacion['destino']}`
- Vuelo candidato a cancelar: `{cancelacion['vuelo_candidato']}`
- Ruta inicial esperada: `{', '.join(cancelacion['ruta_inicial'])}`
- Ruta alternativa esperada: `{', '.join(cancelacion['ruta_alternativa'])}`

## Diferencias entre enunciado y proyecto

- `planes_vuelo_operacion_dia_a_dia.txt` ya incluye vuelos base y adicionales porque el uploader actual reemplaza el dataset de vuelos.
- Los archivos de aeropuertos generados son copias completas en UTF-16 porque el parser no consume patches parciales.
- `envios_bootstrap_SPIM.txt` es un auxiliar técnico: el endpoint actual exige un archivo de envíos incluso para subir solo aeropuertos y vuelos.
- El parser real de vuelos usa offsets GMT fijos del archivo de aeropuertos, así que la zona de Copenhague no es plenamente dinámica en fechas de invierno.
"""


if __name__ == "__main__":
    main()
