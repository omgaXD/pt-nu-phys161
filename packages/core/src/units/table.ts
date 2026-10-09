/**
 * Dimension classes. Units of one class convert by factor; the factor is
 * relative to the SI coherent unit the class's `dims` describe (kg, not g).
 * Across classes, units match when their SI dimensions agree (`J` ≡ `N m` ≡
 * `kg m^2 s^-2`), as in Moodle. A class without `dims` only matches itself.
 */
export interface UnitClass {
  /** Class id; conventionally its base unit name. */
  id: string;
  /** Unit name → factor relative to the class's SI coherent unit. */
  units: Readonly<Record<string, number>>;
  /** SI base dimensions of that unit: `{ kg: 1, m: 1, s: -2 }` for N. Angles count as their own dimension. */
  dims?: Readonly<Record<string, number>>;
}

const PREFIX: Record<string, number> = {
  E: 1e18,
  P: 1e15,
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  d: 1e-1,
  c: 1e-2,
  m: 1e-3,
  µ: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
};

/** `base` plus each prefixed variant; `µ` also accepts the ASCII `u` spelling. */
function prefixed(base: string, baseFactor: number, prefixes: string): Record<string, number> {
  const out: Record<string, number> = { [base]: baseFactor };
  for (const p of prefixes.split(' ').filter(Boolean)) {
    const f = PREFIX[p];
    if (f === undefined) throw new Error(`unknown SI prefix ${p}`);
    out[p + base] = f * baseFactor;
    if (p === 'µ') out[`u${base}`] = f * baseFactor;
  }
  return out;
}

export const SI_CLASSES: readonly UnitClass[] = Object.freeze<UnitClass[]>([
  { id: 'm', units: prefixed('m', 1, 'k c d m µ n p f'), dims: { m: 1 } },
  {
    id: 's',
    units: { ...prefixed('s', 1, 'm µ n p f'), min: 60, h: 3600, day: 86_400, days: 86_400 },
    dims: { s: 1 },
  },
  { id: 'g', units: prefixed('g', 1e-3, 'k m µ n p f'), dims: { kg: 1 } },
  { id: 'N', units: prefixed('N', 1, 'M k m µ n p f'), dims: { kg: 1, m: 1, s: -2 } },
  {
    id: 'J',
    units: {
      ...prefixed('J', 1, 'k M G T P m µ n p f'),
      ...prefixed('eV', 1 / 6.24150947e18, 'k M G'),
      cal: 4.184,
      kcal: 4184,
    },
    dims: { kg: 1, m: 2, s: -2 },
  },
  { id: 'W', units: prefixed('W', 1, 'k M G T P m µ n p f'), dims: { kg: 1, m: 2, s: -3 } },
  { id: 'Pa', units: { ...prefixed('Pa', 1, 'k M G T P'), atm: 101_325, bar: 1e5 }, dims: { kg: 1, m: -1, s: -2 } },
  // rpm is a rotational frequency: 1 rpm = 1/60 Hz.
  { id: 'Hz', units: { ...prefixed('Hz', 1, 'k M G T P E'), rpm: 1 / 60 }, dims: { s: -1 } },
  { id: 'rad', units: { rad: 1, rev: 2 * Math.PI, '°': Math.PI / 180, deg: Math.PI / 180 }, dims: { rad: 1 } },
  { id: 'L', units: prefixed('L', 1e-3, 'm µ d c'), dims: { m: 3 } },
  // Thermodynamics. Celsius is its own class: an offset scale, never converted to K.
  { id: 'K', units: prefixed('K', 1, 'm'), dims: { K: 1 } },
  { id: '°C', units: { '°C': 1 } },
  { id: 'mol', units: prefixed('mol', 1, 'k m µ'), dims: { mol: 1 } },
  // Logarithmic and relative "units" only match themselves (listed so they count as known).
  { id: 'dB', units: { dB: 1 } },
  { id: '%', units: { '%': 1 } },
]);

export interface UnitTable {
  readonly classes: readonly UnitClass[];
  /** Class id, factor and SI dimensions for a unit name, or undefined when unknown. */
  lookup(name: string): UnitInfo | undefined;
}

export interface UnitInfo {
  classId: string;
  factor: number;
  dims?: Readonly<Record<string, number>>;
}

export function createUnitTable(classes: readonly UnitClass[]): UnitTable {
  const index = new Map<string, UnitInfo>();
  for (const c of classes) {
    for (const [name, factor] of Object.entries(c.units)) {
      if (index.has(name)) throw new Error(`unit "${name}" is in more than one class`);
      index.set(name, { classId: c.id, factor, ...(c.dims && { dims: c.dims }) });
    }
  }
  return { classes, lookup: (name) => index.get(name) };
}

export const DEFAULT_UNIT_TABLE: UnitTable = createUnitTable(SI_CLASSES);
