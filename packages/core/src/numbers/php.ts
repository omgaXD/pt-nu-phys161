/**
 * A float as PHP turns it into a string with its default `precision` ini (14):
 * what Moodle prints for computed values, e.g. qtype_formulas' "One possible
 * correct answer is: 0.068999999999999 cm^2". Up to `precision` significant
 * digits, trailing zeros dropped; exponent form ("1.5E-7", "1.0E+20") below
 * 1e-4 or from 10^precision on, as in zend_gcvt.
 */
export function phpFloatString(x: number, precision = 14): string {
  if (Number.isNaN(x)) return 'NAN';
  if (!Number.isFinite(x)) return x > 0 ? 'INF' : '-INF';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const [mantissa = '', exponent = '0'] = Math.abs(x).toExponential(precision - 1).split('e');
  const digits = mantissa.replace('.', '').replace(/0+$/, '');
  // x = 0.<digits> × 10^point
  const point = Number(exponent) + 1;
  let s: string;
  if (point < 0 ? point < -3 : point > precision) {
    const e = point - 1;
    s = `${digits[0]}.${digits.length > 1 ? digits.slice(1) : '0'}E${e < 0 ? '-' : '+'}${Math.abs(e)}`;
  } else if (point <= 0) {
    s = `0.${'0'.repeat(-point)}${digits}`;
  } else if (digits.length <= point) {
    s = digits + '0'.repeat(point - digits.length);
  } else {
    s = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return x < 0 ? `-${s}` : s;
}
