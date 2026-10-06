import type { Location } from '../domain/types';
import type { DeliveryLine, ProductLocationRule } from './types';

export function determineDestination(productId: string, line: Pick<DeliveryLine, 'destinationLocationId'>, locations: Location[], rules: ProductLocationRule[] = []) {
  if (line.destinationLocationId) {
    const location = locations.find(l => l.id === line.destinationLocationId);
    return location ? { locationId: location.id, verified: true, reason: 'Door medewerker gekozen voor deze levering' }
      : { verified: false, reason: 'Kies een geldige voorraadruimte' };
  }
  const allowed = rules.filter(r => r.productId === productId && r.verified && locations.some(l => l.id === r.locationId));
  // User chose manual destination per delivery. Rules are only informational and never auto-assigned.
  return { verified: false, reason: 'Bestemming nog niet vastgesteld', allowedLocationIds: allowed.map(r => r.locationId) };
}
