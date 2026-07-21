# Operaciones Día a Día

## Parámetros usados

- Fecha de prueba: `2026-07-21`
- Hora de inicio en Lima: `08:00`
- Salida local SPIM: `2026-07-21 08:00 (America/Lima)`
- Salida local SABE: `2026-07-21 10:00 (America/Argentina/Buenos_Aires)`
- Salida local EKCH: `2026-07-21 15:00 (Europe/Copenhagen)`
- Salida local VIDP: `2026-07-21 18:30 (Asia/Kolkata)`

## Cómo regenerar

```bash
python3 scripts/generar_operacion_dia_a_dia.py \
  --fecha 2026-07-21 \
  --hora-lima 08:00 \
  --estudiantes 4 \
  --salida /home/rvs/PUCP/DP1/dp1-unite-air/operacion-dia-a-dia/salida_2026-07-21_0800
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

- Envío afectado: `11000001`
- Origen: `SPIM`
- Destino: `SKBO`
- Vuelo candidato a cancelar: `SPIM-SKBO-2026-07-21-10`
- Ruta inicial esperada: `SPIM-SKBO-2026-07-21-10`
- Ruta alternativa esperada: `SPIM-SKBO-2026-07-21-7`

## Diferencias entre enunciado y proyecto

- `planes_vuelo_operacion_dia_a_dia.txt` ya incluye vuelos base y adicionales porque el uploader actual reemplaza el dataset de vuelos.
- Los archivos de aeropuertos generados son copias completas en UTF-16 porque el parser no consume patches parciales.
- `envios_bootstrap_SPIM.txt` es un auxiliar técnico: el endpoint actual exige un archivo de envíos incluso para subir solo aeropuertos y vuelos.
- El parser real de vuelos usa offsets GMT fijos del archivo de aeropuertos, así que la zona de Copenhague no es plenamente dinámica en fechas de invierno.
