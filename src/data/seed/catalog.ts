/**
 * Catálogo fijo de la demo: personas, cuentas, propiedades, proveedores y plantillas.
 * TODO ES INVENTADO: nombres, direcciones («de ejemplo»), teléfonos (555), correos (.test),
 * códigos y montos. Las fechas se calculan en ./index.ts a partir de «hoy».
 */
import { DEFAULT_VENDOR_FOR, TEMPLATE_VARIABLES } from '@/domain/config';
import type {
  AccessCode,
  Checklist,
  Lang,
  Property,
  Role,
  Template,
  Vendor,
} from '@/domain/types';

export const DEMO_EMAIL_DOMAIN = 'ejemplo.test';

export interface SeedUser {
  id: string;
  name: string;
  role: Role;
  title: string;
  propertyIds: 'all' | string[];
  personId?: string;
  vendorId?: string;
}

export const SEED_USERS: SeedUser[] = [
  { id: 'u-owner', name: 'Andrés Villalobos', role: 'owner', title: 'Propietario', propertyIds: 'all' },
  { id: 'u-admin', name: 'Mariana Ortiz', role: 'admin', title: 'Gerente de propiedades', propertyIds: 'all' },
  { id: 'u-support', name: 'Diego Paredes', role: 'support', title: 'Atención al cliente', propertyIds: 'all' },
  {
    id: 'u-clean-1',
    name: 'Rosa Jiménez',
    role: 'cleaner',
    title: 'Limpieza · Florida',
    propertyIds: ['p-miami', 'p-orlando', 'p-tampa'],
  },
  {
    id: 'u-clean-2',
    name: 'Carlos Rivas',
    role: 'cleaner',
    title: 'Limpieza · Atlanta, Houston y San Juan',
    propertyIds: ['p-atlanta', 'p-houston', 'p-sanjuan'],
  },
  {
    id: 'u-tech',
    name: 'Tomás Aguilar',
    role: 'technician',
    title: 'Técnico · Aguilar Servicios Técnicos',
    propertyIds: 'all',
    vendorId: 'v-aguilar',
  },
  { id: 'u-accountant', name: 'Patricia Lozano', role: 'accountant', title: 'Contabilidad', propertyIds: 'all' },
  { id: 'u-guest', name: 'Emily Carter', role: 'guest', title: 'Huésped · Casa Familiar Orlando', propertyIds: [], personId: 'g-emily' },
  { id: 'u-tenant', name: 'Javier Morales', role: 'tenant', title: 'Inquilino · Loft Ejecutivo Houston', propertyIds: [], personId: 't-javier' },
];

export interface SeedPerson {
  id: string;
  name: string;
  language: Lang;
  country: string;
  kind: 'guest' | 'tenant';
  doNotRent?: boolean;
  notes?: string;
}

export const SEED_TENANTS: SeedPerson[] = [
  { id: 't-javier', name: 'Javier Morales', language: 'es', country: 'Estados Unidos', kind: 'tenant' },
  { id: 't-paula', name: 'Paula Restrepo', language: 'es', country: 'Colombia', kind: 'tenant' },
];

/** Huéspedes con papel fijo en la historia de la demo. */
export const SEED_KEY_GUESTS: SeedPerson[] = [
  { id: 'g-emily', name: 'Emily Carter', language: 'en', country: 'Estados Unidos', kind: 'guest' },
  { id: 'g-lucia', name: 'Lucía Fernández', language: 'es', country: 'España', kind: 'guest' },
  { id: 'g-mark', name: 'Mark Thompson', language: 'en', country: 'Canadá', kind: 'guest' },
  { id: 'g-daniel', name: 'Daniel Kim', language: 'en', country: 'Estados Unidos', kind: 'guest' },
  {
    id: 'g-kevin',
    name: 'Kevin Walsh',
    language: 'en',
    country: 'Estados Unidos',
    kind: 'guest',
    doNotRent: true,
    notes: 'Fiesta no autorizada y daños en la sala. No volver a alquilar.',
  },
];

/** Resto de huéspedes para la historia de 6 meses. */
export const SEED_GUEST_POOL: SeedPerson[] = [
  ['Sofía Ramírez', 'es', 'México'],
  ['Valentina Rossi', 'es', 'Argentina'],
  ["James O'Connor", 'en', 'Irlanda'],
  ['Camila Torres', 'es', 'Chile'],
  ['Olivia Martin', 'en', 'Estados Unidos'],
  ['Mateo Herrera', 'es', 'Colombia'],
  ['Hannah Schmidt', 'en', 'Alemania'],
  ['Gabriel Souza', 'es', 'Brasil'],
  ['Isabella Cruz', 'es', 'Puerto Rico'],
  ['Ethan Brooks', 'en', 'Estados Unidos'],
  ['Natalia Vega', 'es', 'Perú'],
  ['Ryan Patel', 'en', 'Reino Unido'],
  ['Andrea Molina', 'es', 'Ecuador'],
  ['Chloe Dubois', 'en', 'Canadá'],
  ['Felipe Castro', 'es', 'Venezuela'],
  ['Grace Lee', 'en', 'Estados Unidos'],
  ['Martina López', 'es', 'Uruguay'],
  ['Noah Wilson', 'en', 'Australia'],
  ['Daniela Rojas', 'es', 'Costa Rica'],
  ['Liam Murphy', 'en', 'Estados Unidos'],
  ['Paula Andrade', 'es', 'Colombia'],
  ['Emma Fischer', 'en', 'Suiza'],
  ['Sebastián Díaz', 'es', 'República Dominicana'],
  ['Ava Johnson', 'en', 'Estados Unidos'],
  ['Renata Silva', 'es', 'Panamá'],
  ['Lucas Bennett', 'en', 'Estados Unidos'],
].map(([name, language, country], i) => ({
  id: `g-${String(i + 1).padStart(2, '0')}`,
  name,
  language: language as Lang,
  country,
  kind: 'guest' as const,
}));

export const SEED_VENDORS: Vendor[] = [
  {
    id: 'v-aguilar',
    name: 'Aguilar Servicios Técnicos',
    specialties: ['plumbing', 'electrical', 'hvac', 'appliances', 'locks', 'general'],
    contactName: 'Tomás Aguilar',
    phone: '+1 305 555 0142',
    email: `servicio@aguilar.${DEMO_EMAIL_DOMAIN}`,
    rating: 4.8,
    notes: 'Técnico de cabecera. Responde urgencias el mismo día.',
    active: true,
  },
  {
    id: 'v-piscinas',
    name: 'Piscinas del Sol',
    specialties: ['pool'],
    contactName: 'Laura Benítez',
    phone: '+1 813 555 0177',
    email: `agenda@piscinasdelsol.${DEMO_EMAIL_DOMAIN}`,
    rating: 4.7,
    notes: 'Mantenimiento semanal de piscinas en Tampa y Orlando.',
    active: true,
  },
  {
    id: 'v-fumi',
    name: 'FumiPro Control de Plagas',
    specialties: ['pests'],
    contactName: 'Hugo Salas',
    phone: '+1 407 555 0193',
    email: `citas@fumipro.${DEMO_EMAIL_DOMAIN}`,
    rating: 4.4,
    notes: 'Fumigación mensual. Avisar 24 h antes.',
    active: true,
  },
  {
    id: 'v-jardin',
    name: 'Jardines Verdes',
    specialties: ['garden'],
    contactName: 'Pedro Quintero',
    phone: '+1 407 555 0128',
    email: `hola@jardinesverdes.${DEMO_EMAIL_DOMAIN}`,
    rating: 4.6,
    notes: 'Jardín cada 2 semanas.',
    active: true,
  },
  {
    id: 'v-electro',
    name: 'ElectroFix',
    specialties: ['electrical', 'appliances'],
    contactName: 'Marcos Peña',
    phone: '+1 713 555 0165',
    email: `ordenes@electrofix.${DEMO_EMAIL_DOMAIN}`,
    rating: 4.2,
    notes: 'Electrodomésticos en Houston.',
    active: true,
  },
  {
    id: 'v-plomeria',
    name: 'PlomeríaYa',
    specialties: ['plumbing'],
    contactName: 'Iván Correa',
    phone: '+1 407 555 0111',
    email: `urgencias@plomeriaya.${DEMO_EMAIL_DOMAIN}`,
    rating: 4.5,
    notes: 'Plomería en Orlando.',
    active: true,
  },
];

type SeedProperty = Omit<Property, 'license' | 'ownerPrivate' | 'createdAt'> & {
  licenseDays?: number;
  licenseNumber?: string;
  insuranceDays: number;
  ownerPrivate: Omit<Property['ownerPrivate'], 'insurance'> & {
    insurance: { provider: string; policyNumber: string; annualPremium: number };
  };
};

const manual = (es: string, en: string) => ({ es, en });

const HOUSE_RULES_ES =
  'Bienvenido. No se permiten fiestas ni eventos. Silencio de 10 p. m. a 8 a. m. No fumar dentro. ' +
  'Separa la basura: reciclaje en la bolsa azul. Antes de salir, apaga el aire acondicionado y deja las llaves en la caja.';
const HOUSE_RULES_EN =
  'Welcome. No parties or events. Quiet hours 10 pm to 8 am. No smoking inside. ' +
  'Please recycle in the blue bag. Before leaving, turn off the A/C and return the keys to the lockbox.';

export const SEED_PROPERTIES: SeedProperty[] = [
  {
    id: 'p-miami',
    name: 'Apartamento Moderno Miami',
    type: 'apartment',
    country: 'Estados Unidos',
    region: 'FL',
    city: 'Miami',
    neighborhood: 'Brickell',
    address: '88 Bahía Azul Ave, Apt 2405 (dirección de ejemplo)',
    lat: 25.7653,
    lng: -80.1937,
    timezone: 'America/New_York',
    currency: 'USD',
    photos: [
      { id: 'ph-miami-1', src: 'demo/miami-1.svg', caption: 'Edificio frente a la bahía' },
      { id: 'ph-miami-2', src: 'demo/miami-2.svg', caption: 'Sala con vista' },
    ],
    bedrooms: 2,
    bathrooms: 2,
    capacity: 4,
    sizeM2: 110,
    amenities: ['Wifi', 'Aire acondicionado', 'Piscina del edificio', 'Gimnasio', 'Estacionamiento', 'Vista a la bahía'],
    rentalMode: 'nightly',
    statusOverride: 'none',
    licenseNumber: 'STR-MIA-0187',
    licenseDays: 25,
    insuranceDays: 160,
    houseManual: manual(HOUSE_RULES_ES, HOUSE_RULES_EN),
    checkInInstructions: manual(
      'Entrada desde las 4:00 p. m. Muestra tu nombre en la recepción del edificio y sube al piso 24. La puerta tiene cerradura con código.',
      'Check-in from 4:00 pm. Give your name at the building front desk and go up to floor 24. The door has a keypad lock.',
    ),
    directions: manual(
      'A 15 minutos del aeropuerto MIA. Estacionamiento de visitantes en el nivel P2 (puesto 2405).',
      '15 minutes from MIA airport. Guest parking on level P2 (spot 2405).',
    ),
    checkInTime: '16:00',
    checkOutTime: '11:00',
    nightlyRate: 220,
    cleaningFee: 120,
    cleaningPay: 75,
    taxRate: 0.13,
    defaultCleanerId: 'u-clean-1',
    vendorIds: ['v-aguilar', 'v-fumi'],
    ownerPrivate: {
      purchasePrice: 520000,
      purchaseDate: '2021-06-15',
      estimatedValue: 610000,
      mortgage: { lender: 'Banco Ejemplo', monthlyPayment: 2650, balance: 388000 },
      insurance: { provider: 'Seguros Ejemplo', policyNumber: 'POL-55821', annualPremium: 2400 },
      hoaMonthly: 650,
      propertyTaxAnnual: 9800,
    },
    notes: 'Edificio con recepción 24 h.',
    archived: false,
  },
  {
    id: 'p-orlando',
    name: 'Casa Familiar Orlando',
    type: 'house',
    country: 'Estados Unidos',
    region: 'FL',
    city: 'Orlando',
    neighborhood: 'Windermere',
    address: '17 Laguna Serena Ct (dirección de ejemplo)',
    lat: 28.4951,
    lng: -81.5351,
    timezone: 'America/New_York',
    currency: 'USD',
    photos: [
      { id: 'ph-orlando-1', src: 'demo/orlando-1.svg', caption: 'Fachada' },
      { id: 'ph-orlando-2', src: 'demo/orlando-2.svg', caption: 'Patio' },
    ],
    bedrooms: 4,
    bathrooms: 3,
    capacity: 10,
    sizeM2: 260,
    amenities: ['Wifi', 'Aire acondicionado', 'Piscina privada', 'Parrilla', 'Garaje para 2 autos', 'Cuna'],
    rentalMode: 'nightly',
    statusOverride: 'none',
    licenseNumber: 'STR-ORL-0442',
    licenseDays: 210,
    insuranceDays: 20,
    houseManual: manual(HOUSE_RULES_ES, HOUSE_RULES_EN),
    checkInInstructions: manual(
      'Entrada desde las 4:00 p. m. Abre el portón con el código y toma las llaves de la caja junto a la puerta principal.',
      'Check-in from 4:00 pm. Open the gate with the code and take the keys from the lockbox next to the front door.',
    ),
    directions: manual(
      'A 25 minutos de los parques. Estaciona en la entrada; el control del garaje está en la cocina.',
      '25 minutes from the parks. Park in the driveway; the garage remote is in the kitchen.',
    ),
    checkInTime: '16:00',
    checkOutTime: '10:00',
    nightlyRate: 180,
    cleaningFee: 150,
    cleaningPay: 95,
    taxRate: 0.125,
    defaultCleanerId: 'u-clean-1',
    vendorIds: ['v-aguilar', 'v-plomeria', 'v-jardin', 'v-piscinas', 'v-fumi'],
    ownerPrivate: {
      purchasePrice: 465000,
      purchaseDate: '2020-03-02',
      estimatedValue: 540000,
      mortgage: { lender: 'Banco Ejemplo', monthlyPayment: 2310, balance: 312000 },
      insurance: { provider: 'Aseguradora Demo', policyNumber: 'POL-77310', annualPremium: 3100 },
      hoaMonthly: 120,
      propertyTaxAnnual: 7200,
    },
    notes: 'Piscina con cerca de seguridad para niños.',
    archived: false,
  },
  {
    id: 'p-tampa',
    name: 'Villa con Piscina Tampa',
    type: 'villa',
    country: 'Estados Unidos',
    region: 'FL',
    city: 'Tampa',
    neighborhood: 'Bayshore',
    address: '305 Palmetto Grove Rd (dirección de ejemplo)',
    lat: 27.9187,
    lng: -82.4862,
    timezone: 'America/New_York',
    currency: 'USD',
    photos: [
      { id: 'ph-tampa-1', src: 'demo/tampa-1.svg', caption: 'Villa y piscina' },
      { id: 'ph-tampa-2', src: 'demo/tampa-2.svg', caption: 'Terraza al atardecer' },
    ],
    bedrooms: 5,
    bathrooms: 4,
    capacity: 12,
    sizeM2: 380,
    amenities: ['Wifi', 'Aire acondicionado', 'Piscina climatizada', 'Muelle', 'Cocina exterior', 'Seguridad 24 h'],
    rentalMode: 'nightly',
    statusOverride: 'maintenance',
    licenseNumber: 'STR-TPA-0093',
    licenseDays: 140,
    insuranceDays: 240,
    houseManual: manual(HOUSE_RULES_ES, HOUSE_RULES_EN),
    checkInInstructions: manual(
      'Entrada desde las 4:00 p. m. Marca el código en el portón y luego en la puerta principal. La calefacción de la piscina se enciende desde el panel del patio.',
      'Check-in from 4:00 pm. Enter the code at the gate and then at the front door. Pool heating is controlled from the patio panel.',
    ),
    directions: manual(
      'Sobre Bayshore Blvd, a 20 minutos del aeropuerto TPA. Hay espacio para 4 autos.',
      'On Bayshore Blvd, 20 minutes from TPA airport. Parking for 4 cars.',
    ),
    checkInTime: '16:00',
    checkOutTime: '10:00',
    nightlyRate: 350,
    cleaningFee: 220,
    cleaningPay: 140,
    taxRate: 0.12,
    defaultCleanerId: 'u-clean-1',
    vendorIds: ['v-piscinas', 'v-aguilar', 'v-jardin'],
    ownerPrivate: {
      purchasePrice: 980000,
      purchaseDate: '2022-09-20',
      estimatedValue: 1120000,
      mortgage: { lender: 'Banco Ejemplo', monthlyPayment: 5400, balance: 805000 },
      insurance: { provider: 'Seguros Ejemplo', policyNumber: 'POL-90218', annualPremium: 6200 },
      propertyTaxAnnual: 18500,
    },
    notes: 'Bomba de la piscina en revisión.',
    archived: false,
  },
  {
    id: 'p-houston',
    name: 'Loft Ejecutivo Houston',
    type: 'loft',
    country: 'Estados Unidos',
    region: 'TX',
    city: 'Houston',
    neighborhood: 'Midtown',
    address: '2100 Magnolia Loft St, Unit 5C (dirección de ejemplo)',
    lat: 29.7409,
    lng: -95.3791,
    timezone: 'America/Chicago',
    currency: 'USD',
    photos: [{ id: 'ph-houston-1', src: 'demo/houston-1.svg', caption: 'Loft' }],
    bedrooms: 1,
    bathrooms: 1,
    capacity: 2,
    sizeM2: 85,
    amenities: ['Wifi de fibra', 'Espacio de trabajo', 'Cerradura inteligente', 'Gimnasio', 'Lavadora y secadora'],
    rentalMode: 'monthly',
    statusOverride: 'none',
    insuranceDays: 300,
    houseManual: manual(
      'Recolección de basura: martes y viernes. El administrador del edificio atiende de 9 a 5. Mantén el filtro del aire limpio.',
      'Trash pickup: Tuesday and Friday. The building manager is available 9 to 5. Keep the A/C filter clean.',
    ),
    checkInInstructions: manual('Cerradura inteligente: el código se cambia en cada contrato.', 'Smart lock: the code changes with each lease.'),
    directions: manual('Frente al parque de Midtown. Estacionamiento cubierto, puesto 5C.', 'Across from Midtown park. Covered parking, spot 5C.'),
    checkInTime: '15:00',
    checkOutTime: '11:00',
    nightlyRate: 150,
    cleaningFee: 0,
    cleaningPay: 90,
    monthlyRent: 2800,
    taxRate: 0,
    defaultCleanerId: 'u-clean-2',
    vendorIds: ['v-aguilar', 'v-electro'],
    ownerPrivate: {
      purchasePrice: 310000,
      purchaseDate: '2019-11-05',
      estimatedValue: 335000,
      mortgage: { lender: 'Cooperativa Demo', monthlyPayment: 1750, balance: 201000 },
      insurance: { provider: 'Aseguradora Demo', policyNumber: 'POL-33107', annualPremium: 1500 },
      hoaMonthly: 380,
      propertyTaxAnnual: 6900,
    },
    notes: '',
    archived: false,
  },
  {
    id: 'p-atlanta',
    name: 'Estudio Centro Atlanta',
    type: 'studio',
    country: 'Estados Unidos',
    region: 'GA',
    city: 'Atlanta',
    neighborhood: 'Midtown',
    address: '75 Durazno Ave, Apt 1208 (dirección de ejemplo)',
    lat: 33.7817,
    lng: -84.3839,
    timezone: 'America/New_York',
    currency: 'USD',
    photos: [{ id: 'ph-atlanta-1', src: 'demo/atlanta-1.svg', caption: 'Estudio con vista a la ciudad' }],
    bedrooms: 0,
    bathrooms: 1,
    capacity: 2,
    sizeM2: 45,
    amenities: ['Wifi', 'Aire acondicionado', 'Tren a 2 cuadras', 'Vista a la ciudad', 'Escritorio'],
    rentalMode: 'mixed',
    statusOverride: 'none',
    licenseNumber: 'STR-ATL-0611',
    licenseDays: 300,
    insuranceDays: 190,
    houseManual: manual(HOUSE_RULES_ES, HOUSE_RULES_EN),
    checkInInstructions: manual(
      'Entrada desde las 3:00 p. m. Las llaves están en la caja de seguridad del lobby (código abajo).',
      'Check-in from 3:00 pm. Keys are in the lobby lockbox (code below).',
    ),
    directions: manual('A 2 cuadras de la estación Midtown del tren.', '2 blocks from Midtown train station.'),
    checkInTime: '15:00',
    checkOutTime: '11:00',
    nightlyRate: 120,
    cleaningFee: 80,
    cleaningPay: 60,
    monthlyRent: 1650,
    taxRate: 0.16,
    defaultCleanerId: 'u-clean-2',
    vendorIds: ['v-aguilar', 'v-fumi'],
    ownerPrivate: {
      purchasePrice: 210000,
      purchaseDate: '2023-02-14',
      estimatedValue: 236000,
      mortgage: { lender: 'Banco Ejemplo', monthlyPayment: 1180, balance: 168000 },
      insurance: { provider: 'Seguros Ejemplo', policyNumber: 'POL-61045', annualPremium: 900 },
      hoaMonthly: 290,
      propertyTaxAnnual: 3100,
    },
    notes: 'Mixto: contrato de 6 meses y luego por noches.',
    archived: false,
  },
  {
    id: 'p-sanjuan',
    name: 'Apartamento Condado San Juan',
    type: 'apartment',
    country: 'Puerto Rico',
    region: 'PR',
    city: 'San Juan',
    neighborhood: 'Condado',
    address: '1 Calle Brisa Marina, Apt 7B (dirección de ejemplo)',
    lat: 18.4573,
    lng: -66.0716,
    timezone: 'America/Puerto_Rico',
    currency: 'USD',
    photos: [
      { id: 'ph-sanjuan-1', src: 'demo/sanjuan-1.svg', caption: 'Edificio frente al mar' },
      { id: 'ph-sanjuan-2', src: 'demo/sanjuan-2.svg', caption: 'Vista desde el balcón' },
    ],
    bedrooms: 2,
    bathrooms: 2,
    capacity: 5,
    sizeM2: 95,
    amenities: ['Wifi', 'Aire acondicionado', 'Frente a la playa', 'Balcón', 'Estacionamiento'],
    rentalMode: 'nightly',
    statusOverride: 'none',
    licenseNumber: 'STR-SJU-0275',
    licenseDays: 260,
    insuranceDays: 120,
    houseManual: manual(HOUSE_RULES_ES, HOUSE_RULES_EN),
    checkInInstructions: manual(
      'Entrada desde las 3:00 p. m. Toma el ascensor al piso 7. La puerta abre con código.',
      'Check-in from 3:00 pm. Take the elevator to floor 7. The door opens with a code.',
    ),
    directions: manual(
      'A 15 minutos del aeropuerto SJU. Estacionamiento techado, puesto 7B.',
      '15 minutes from SJU airport. Covered parking, spot 7B.',
    ),
    checkInTime: '15:00',
    checkOutTime: '11:00',
    nightlyRate: 190,
    cleaningFee: 110,
    cleaningPay: 70,
    taxRate: 0.09,
    defaultCleanerId: 'u-clean-2',
    vendorIds: ['v-aguilar'],
    ownerPrivate: {
      purchasePrice: 395000,
      purchaseDate: '2024-01-10',
      estimatedValue: 450000,
      insurance: { provider: 'Aseguradora Demo', policyNumber: 'POL-12077', annualPremium: 2800 },
      hoaMonthly: 410,
      propertyTaxAnnual: 2600,
    },
    notes: 'Zona horaria de Puerto Rico (sin horario de verano).',
    archived: false,
  },
];

/** Códigos INVENTADOS para la demo. */
export const SEED_ACCESS_CODES: AccessCode[] = [
  { id: 'ac-miami-door', propertyId: 'p-miami', kind: 'door', label: 'Puerta 2405', value: '482913' },
  { id: 'ac-miami-wifi', propertyId: 'p-miami', kind: 'wifi', label: 'Brickell-2405', value: 'BahiaAzul-2405!' },
  { id: 'ac-orlando-gate', propertyId: 'p-orlando', kind: 'gate', label: 'Portón', value: '7316' },
  { id: 'ac-orlando-lockbox', propertyId: 'p-orlando', kind: 'lockbox', label: 'Caja de llaves', value: '2580' },
  { id: 'ac-orlando-alarm', propertyId: 'p-orlando', kind: 'alarm', label: 'Alarma', value: '9047' },
  { id: 'ac-orlando-wifi', propertyId: 'p-orlando', kind: 'wifi', label: 'CasaLaguna-5G', value: 'Laguna17Demo!' },
  { id: 'ac-tampa-gate', propertyId: 'p-tampa', kind: 'gate', label: 'Portón', value: '5521' },
  { id: 'ac-tampa-door', propertyId: 'p-tampa', kind: 'door', label: 'Puerta principal', value: '360144' },
  { id: 'ac-tampa-wifi', propertyId: 'p-tampa', kind: 'wifi', label: 'VillaBayshore', value: 'Palmera2026Demo' },
  { id: 'ac-houston-door', propertyId: 'p-houston', kind: 'door', label: 'Cerradura inteligente 5C', value: '815260' },
  { id: 'ac-houston-wifi', propertyId: 'p-houston', kind: 'wifi', label: 'Magnolia-5C', value: 'LoftFibra5C' },
  { id: 'ac-atlanta-lockbox', propertyId: 'p-atlanta', kind: 'lockbox', label: 'Caja del lobby', value: '1208' },
  { id: 'ac-atlanta-wifi', propertyId: 'p-atlanta', kind: 'wifi', label: 'Durazno-1208', value: 'Estudio1208!' },
  { id: 'ac-sanjuan-door', propertyId: 'p-sanjuan', kind: 'door', label: 'Puerta 7B', value: '730452' },
  { id: 'ac-sanjuan-wifi', propertyId: 'p-sanjuan', kind: 'wifi', label: 'BrisaMarina-7B', value: 'Condado7BDemo' },
];

const room = (name: string, items: string[]) => ({ name, items });

export const SEED_CHECKLISTS: Checklist[] = SEED_PROPERTIES.map((p) => {
  const rooms = [
    room('Entrada y sala', ['Aspirar y trapear pisos', 'Limpiar superficies y control remoto', 'Revisar que no haya daños']),
    room('Cocina', ['Lavar platos y vaciar el lavavajillas', 'Limpiar nevera y microondas', 'Reponer café, sal y aceite']),
    room('Habitaciones', ['Cambiar sábanas y fundas', 'Revisar debajo de las camas', 'Doblar mantas extra']),
    room('Baños', ['Desinfectar sanitario, ducha y lavamanos', 'Poner toallas limpias', 'Reponer papel y jabón']),
  ];
  if (p.type === 'house' || p.type === 'villa')
    rooms.push(room('Exterior', ['Limpiar muebles del patio', 'Revisar la piscina y la cerca', 'Sacar la basura al contenedor']));
  else rooms.push(room('Salida', ['Sacar la basura', 'Apagar el aire y las luces', 'Dejar llaves y control en su lugar']));
  return { id: `cl-${p.id.slice(2)}`, propertyId: p.id, rooms };
});

export const SEED_TEMPLATES: Template[] = [
  {
    id: 'tpl-welcome',
    key: 'welcome',
    name: 'Bienvenida',
    builtIn: true,
    body: {
      es: '¡Hola {{guest_name}}! Gracias por reservar {{property_name}} en {{city}}. Te esperamos el {{check_in}} desde las {{check_in_time}}. Cualquier cosa, escríbenos por aquí.',
      en: 'Hi {{guest_name}}! Thanks for booking {{property_name}} in {{city}}. We look forward to seeing you on {{check_in}} from {{check_in_time}}. Message us here anytime.',
    },
  },
  {
    id: 'tpl-checkin',
    key: 'checkin',
    name: 'Instrucciones de entrada',
    builtIn: true,
    body: {
      es: 'Hola {{guest_name}}, tu entrada es hoy desde las {{check_in_time}}. Los códigos de la puerta y del wifi aparecen en tu app durante la estadía: {{app_link}}',
      en: 'Hi {{guest_name}}, check-in is today from {{check_in_time}}. Your door and wifi codes are in your app during your stay: {{app_link}}',
    },
  },
  {
    id: 'tpl-checkout',
    key: 'checkout',
    name: 'Recordatorio de salida',
    builtIn: true,
    body: {
      es: 'Hola {{guest_name}}, esperamos que hayas disfrutado {{property_name}}. Te recordamos que la salida es mañana ({{check_out}}) a las {{check_out_time}}. Deja las llaves en la caja, por favor.',
      en: 'Hi {{guest_name}}, we hope you enjoyed {{property_name}}. A reminder that check-out is tomorrow ({{check_out}}) at {{check_out_time}}. Please leave the keys in the lockbox.',
    },
  },
  {
    id: 'tpl-rent',
    key: 'rent_due',
    name: 'Renta por vencer',
    builtIn: true,
    body: {
      es: 'Hola {{guest_name}}, te recordamos que la renta de {{property_name}} ({{amount}}) vence el {{due_date}}. Si ya pagaste, ignora este mensaje. ¡Gracias!',
      en: 'Hi {{guest_name}}, a reminder that rent for {{property_name}} ({{amount}}) is due on {{due_date}}. If you already paid, please ignore this message. Thank you!',
    },
  },
  {
    id: 'tpl-thanks',
    key: 'thanks',
    name: 'Gracias',
    builtIn: false,
    body: {
      es: 'Gracias por quedarte en {{property_name}}, {{guest_name}}. ¡Vuelve pronto!',
      en: 'Thanks for staying at {{property_name}}, {{guest_name}}. Come back soon!',
    },
  },
];

export { DEFAULT_VENDOR_FOR, TEMPLATE_VARIABLES };
