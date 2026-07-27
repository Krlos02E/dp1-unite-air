import type { MaletaEstado, VueloDTO } from '../types'

function getRelevantFlightId(maleta: MaletaEstado, vuelo: VueloDTO): string | null {
  if (vuelo.estado === 'ACTIVO') {
    return maleta.vueloActual
  }
  if (vuelo.estado === 'PROGRAMADO') {
    return maleta.vueloEsperado
  }
  return maleta.ultimoVuelo || maleta.vueloActual || maleta.vueloEsperado || null
}

export function getMaletasForVuelo(vuelo: VueloDTO, maletas: MaletaEstado[] = []): MaletaEstado[] {
  if (maletas.length === 0) return []
  return maletas.filter((maleta) => getRelevantFlightId(maleta, vuelo) === vuelo.id)
}

export function getDisplayedFlightLoad(vuelo: VueloDTO, maletas: MaletaEstado[] = []): number {
  void maletas
  return vuelo.cargaActual
}
