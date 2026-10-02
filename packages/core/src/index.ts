/**
 * @pt/core — problems, instances, responses and grades.
 * Zero framework dependencies, zero I/O.
 */
export * from './canonical/index.js';
export * from './diagnose/index.js';
export * from './errors.js';
export * from './expr/index.js';
export * from './grade/index.js';
export * from './instantiate/index.js';
export {
  cleanFloat,
  decimalExponent,
  decimalPlaces,
  roundHalfAway,
  roundToSigfigs,
  shiftDecimal,
  significantDigits,
} from './numbers/decimal.js';
export { type Formatted, formatNumber, formatValue, formatVector, type NumberFormat } from './numbers/format.js';
export { phpFloatString } from './numbers/php.js';
export * from './repo/index.js';
export * from './schema/index.js';
export * from './template/index.js';
export * from './units/index.js';
