export const FLIGHT_DISPLAY_PERCENTAGE = 1

export function shouldDisplayFlight(flightId: string): boolean {
  let hash = 0
  for (let index = 0; index < flightId.length; index++) {
    hash = flightId.charCodeAt(index) + ((hash << 5) - hash)
  }
  const normalized = (Math.abs(hash) % 1000) / 1000
  return normalized < FLIGHT_DISPLAY_PERCENTAGE
}
