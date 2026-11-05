/**
 * Modelo del formulario de propiedad: estado (texto de cada campo), conversión a lo que piden
 * los servicios y validación con mensajes en español (los de zod por defecto vienen en inglés).
 */
import type { OwnerPrivate, PropertyType, RentalMode } from '@/domain/types';
import { parseAmount, round2 } from '@/lib/money';
import type { PropertyView, svc } from '@/services';

export type CreateInput = Parameters<typeof svc.properties.createProperty>[1];
export type UpdateInput = Parameters<typeof svc.properties.updateProperty>[2];

export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Este de EE. UU. (Nueva York, Miami)' },
  { value: 'America/Chicago', label: 'Centro de EE. UU. (Chicago, Houston)' },
  { value: 'America/Denver', label: 'Montaña de EE. UU. (Denver)' },
  { value: 'America/Los_Angeles', label: 'Pacífico de EE. UU. (Los Ángeles)' },
  { value: 'America/Puerto_Rico', label: 'Puerto Rico (San Juan)' },
  { value: 'America/Bogota', label: 'Colombia (Bogotá)' },
  { value: 'America/Mexico_City', label: 'México (Ciudad de México)' },
  { value: 'Europe/Madrid', label: 'España (Madrid)' },
];

export interface FormState {
  name: string;
  type: PropertyType;
  rentalMode: RentalMode;
  country: string;
  region: string;
  city: string;
  neighborhood: string;
  address: string;
  lat: string;
  lng: string;
  timezone: string;
  currency: string;
  bedrooms: string;
  bathrooms: string;
  capacity: string;
  sizeM2: string;
  amenities: string;
  nightlyRate: string;
  cleaningFee: string;
  cleaningPay: string;
  monthlyRent: string;
  taxPercent: string;
  checkInTime: string;
  checkOutTime: string;
  licenseNumber: string;
  licenseExpires: string;
  manualEs: string;
  manualEn: string;
  instructionsEs: string;
  instructionsEn: string;
  directionsEs: string;
  directionsEn: string;
  defaultCleanerId: string;
  purchasePrice: string;
  purchaseDate: string;
  estimatedValue: string;
  mortgageLender: string;
  mortgagePayment: string;
  mortgageBalance: string;
  insuranceProvider: string;
  insurancePolicy: string;
  insurancePremium: string;
  insuranceExpires: string;
  hoaMonthly: string;
  propertyTaxAnnual: string;
}

export type FormErrors = Partial<Record<keyof FormState, string>>;

export const EMPTY_FORM: FormState = {
  name: '',
  type: 'apartment',
  rentalMode: 'nightly',
  country: 'Estados Unidos',
  region: '',
  city: '',
  neighborhood: '',
  address: '',
  lat: '',
  lng: '',
  timezone: 'America/New_York',
  currency: 'USD',
  bedrooms: '1',
  bathrooms: '1',
  capacity: '2',
  sizeM2: '',
  amenities: 'Wifi, Aire acondicionado',
  nightlyRate: '',
  cleaningFee: '',
  cleaningPay: '',
  monthlyRent: '',
  taxPercent: '0',
  checkInTime: '16:00',
  checkOutTime: '11:00',
  licenseNumber: '',
  licenseExpires: '',
  manualEs: '',
  manualEn: '',
  instructionsEs: '',
  instructionsEn: '',
  directionsEs: '',
  directionsEn: '',
  defaultCleanerId: '',
  purchasePrice: '',
  purchaseDate: '',
  estimatedValue: '',
  mortgageLender: '',
  mortgagePayment: '',
  mortgageBalance: '',
  insuranceProvider: '',
  insurancePolicy: '',
  insurancePremium: '',
  insuranceExpires: '',
  hoaMonthly: '',
  propertyTaxAnnual: '',
};

const str = (n: number | undefined | null) => (n == null ? '' : String(n));

/** Estado inicial a partir de la propiedad que entrega el servicio. */
export function fromView(p: PropertyView): FormState {
  const o = p.ownerPrivate;
  return {
    name: p.name,
    type: p.type,
    rentalMode: p.rentalMode,
    country: p.country,
    region: p.region,
    city: p.city,
    neighborhood: p.neighborhood,
    address: p.address,
    lat: String(p.lat),
    lng: String(p.lng),
    timezone: p.timezone,
    currency: p.currency,
    bedrooms: String(p.bedrooms),
    bathrooms: String(p.bathrooms),
    capacity: String(p.capacity),
    sizeM2: String(p.sizeM2),
    amenities: p.amenities.join(', '),
    nightlyRate: str(p.nightlyRate),
    cleaningFee: str(p.cleaningFee),
    cleaningPay: str(p.cleaningPay),
    monthlyRent: str(p.monthlyRent),
    taxPercent: String(round2(p.taxRate * 100)),
    checkInTime: p.checkInTime,
    checkOutTime: p.checkOutTime,
    licenseNumber: p.license?.number ?? '',
    licenseExpires: p.license?.expiresOn ?? '',
    manualEs: p.houseManual.es,
    manualEn: p.houseManual.en,
    instructionsEs: p.checkInInstructions.es,
    instructionsEn: p.checkInInstructions.en,
    directionsEs: p.directions.es,
    directionsEn: p.directions.en,
    defaultCleanerId: p.defaultCleanerId ?? '',
    purchasePrice: str(o?.purchasePrice),
    purchaseDate: o?.purchaseDate ?? '',
    estimatedValue: str(o?.estimatedValue),
    mortgageLender: o?.mortgage?.lender ?? '',
    mortgagePayment: str(o?.mortgage?.monthlyPayment),
    mortgageBalance: str(o?.mortgage?.balance),
    insuranceProvider: o?.insurance?.provider ?? '',
    insurancePolicy: o?.insurance?.policyNumber ?? '',
    insurancePremium: str(o?.insurance?.annualPremium),
    insuranceExpires: o?.insurance?.expiresOn ?? '',
    hoaMonthly: str(o?.hoaMonthly),
    propertyTaxAnnual: str(o?.propertyTaxAnnual),
  };
}

/** Lo que se manda al crear o editar (sin fotos, estado manual, proveedores ni notas). */
export type BuiltInput = Omit<CreateInput, 'photos' | 'statusOverride' | 'vendorIds' | 'notes' | 'ownerPrivate'> & { ownerPrivate?: OwnerPrivate };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/**
 * Valida y convierte. Si hay errores, `input` no viene y `errors` dice qué arreglar.
 * `includePrivate`: solo el propietario manda los datos privados.
 */
export function buildInput(f: FormState, { includePrivate }: { includePrivate: boolean }): { errors: FormErrors; input?: BuiltInput } {
  const errors: FormErrors = {};
  const fail = (key: keyof FormState, message: string) => {
    if (!errors[key]) errors[key] = message;
  };

  /** Número opcional: '' → undefined; texto inválido → error. */
  const optionalNumber = (key: keyof FormState, opts: { min?: number; max?: number; int?: boolean } = {}): number | undefined => {
    const raw = String(f[key]).trim();
    if (!raw) return undefined;
    const n = parseAmount(raw);
    let problem: string | undefined;
    if (!Number.isFinite(n)) problem = 'Escribe solo números.';
    else if (opts.int && !Number.isInteger(n)) problem = 'Usa un número entero.';
    else if (opts.min != null && n < opts.min) problem = `Debe ser ${opts.min} o más.`;
    else if (opts.max != null && n > opts.max) problem = `Debe ser ${opts.max} o menos.`;
    if (problem) {
      fail(key, problem);
      return undefined;
    }
    return n;
  };
  const requiredNumber = (key: keyof FormState, message: string, opts: { min?: number; max?: number; int?: boolean } = {}): number => {
    const n = optionalNumber(key, opts);
    if (n === undefined && !errors[key]) fail(key, message);
    return n ?? 0;
  };

  const name = f.name.trim();
  if (name.length < 2) fail('name', 'Escribe el nombre (al menos 2 letras).');
  const city = f.city.trim();
  if (!city) fail('city', 'Escribe la ciudad.');
  const lat = requiredNumber('lat', 'Escribe la latitud (ej. 25.7617).', { min: -90, max: 90 });
  const lng = requiredNumber('lng', 'Escribe la longitud (ej. -80.1918).', { min: -180, max: 180 });
  const currency = f.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail('currency', 'Moneda de 3 letras (ej. USD).');

  const bedrooms = requiredNumber('bedrooms', 'Escribe cuántos cuartos (0 si es estudio).', { min: 0, int: true });
  const bathrooms = requiredNumber('bathrooms', 'Escribe cuántos baños.', { min: 0 });
  const capacity = requiredNumber('capacity', 'Escribe para cuántas personas.', { min: 1, int: true });
  const sizeM2 = requiredNumber('sizeM2', 'Escribe el tamaño en m².', { min: 0 });

  const usesNights = f.rentalMode !== 'monthly';
  const nightlyRate = usesNights ? requiredNumber('nightlyRate', 'Escribe la tarifa por noche.', { min: 0 }) : (optionalNumber('nightlyRate', { min: 0 }) ?? 0);
  const cleaningFee = optionalNumber('cleaningFee', { min: 0 }) ?? 0;
  const cleaningPay = optionalNumber('cleaningPay', { min: 0 }) ?? 0;
  const monthlyRent = f.rentalMode === 'monthly' ? requiredNumber('monthlyRent', 'Escribe la renta mensual.', { min: 0 }) : optionalNumber('monthlyRent', { min: 0 });
  const taxPercent = optionalNumber('taxPercent', { min: 0, max: 100 }) ?? 0;

  if (!TIME.test(f.checkInTime)) fail('checkInTime', 'Elige la hora de entrada.');
  if (!TIME.test(f.checkOutTime)) fail('checkOutTime', 'Elige la hora de salida.');

  const licenseNumber = f.licenseNumber.trim();
  if (licenseNumber && !DATE.test(f.licenseExpires)) fail('licenseExpires', 'Elige la fecha de vencimiento de la licencia.');
  if (!licenseNumber && f.licenseExpires) fail('licenseNumber', 'Escribe el número de la licencia (o borra la fecha).');

  let ownerPrivate: OwnerPrivate | undefined;
  if (includePrivate) {
    const purchasePrice = optionalNumber('purchasePrice', { min: 0 });
    const estimatedValue = optionalNumber('estimatedValue', { min: 0 });
    const hoaMonthly = optionalNumber('hoaMonthly', { min: 0 });
    const propertyTaxAnnual = optionalNumber('propertyTaxAnnual', { min: 0 });
    if (f.purchaseDate && !DATE.test(f.purchaseDate)) fail('purchaseDate', 'Usa una fecha válida.');

    let mortgage: OwnerPrivate['mortgage'];
    if (f.mortgageLender.trim() || f.mortgagePayment.trim() || f.mortgageBalance.trim()) {
      if (!f.mortgageLender.trim()) fail('mortgageLender', 'Escribe el prestamista.');
      const monthlyPayment = requiredNumber('mortgagePayment', 'Escribe la cuota mensual.', { min: 0 });
      const balance = requiredNumber('mortgageBalance', 'Escribe el saldo.', { min: 0 });
      mortgage = { lender: f.mortgageLender.trim(), monthlyPayment, balance };
    }

    let insurance: OwnerPrivate['insurance'];
    if (f.insuranceProvider.trim() || f.insurancePolicy.trim() || f.insurancePremium.trim() || f.insuranceExpires) {
      if (!f.insuranceProvider.trim()) fail('insuranceProvider', 'Escribe la aseguradora.');
      if (!f.insurancePolicy.trim()) fail('insurancePolicy', 'Escribe el número de póliza.');
      const annualPremium = requiredNumber('insurancePremium', 'Escribe la prima anual.', { min: 0 });
      if (!DATE.test(f.insuranceExpires)) fail('insuranceExpires', 'Elige la fecha de vencimiento del seguro.');
      insurance = { provider: f.insuranceProvider.trim(), policyNumber: f.insurancePolicy.trim(), annualPremium, expiresOn: f.insuranceExpires };
    }

    ownerPrivate = {
      purchasePrice,
      purchaseDate: f.purchaseDate || undefined,
      estimatedValue,
      mortgage,
      insurance,
      hoaMonthly,
      propertyTaxAnnual,
    };
  }

  if (Object.keys(errors).length) return { errors };

  const input: BuiltInput = {
    name,
    type: f.type,
    rentalMode: f.rentalMode,
    country: f.country.trim(),
    region: f.region.trim(),
    city,
    neighborhood: f.neighborhood.trim(),
    address: f.address.trim(),
    lat,
    lng,
    timezone: f.timezone,
    currency,
    bedrooms,
    bathrooms,
    capacity,
    sizeM2,
    amenities: f.amenities
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    nightlyRate: round2(nightlyRate),
    cleaningFee: round2(cleaningFee),
    cleaningPay: round2(cleaningPay),
    monthlyRent: monthlyRent == null ? undefined : round2(monthlyRent),
    taxRate: round2(taxPercent) / 100,
    checkInTime: f.checkInTime,
    checkOutTime: f.checkOutTime,
    license: licenseNumber ? { number: licenseNumber, expiresOn: f.licenseExpires } : undefined,
    houseManual: { es: f.manualEs.trim(), en: f.manualEn.trim() },
    checkInInstructions: { es: f.instructionsEs.trim(), en: f.instructionsEn.trim() },
    directions: { es: f.directionsEs.trim(), en: f.directionsEn.trim() },
    defaultCleanerId: f.defaultCleanerId || undefined,
  };
  if (includePrivate) input.ownerPrivate = ownerPrivate;
  return { errors, input };
}
