import { describe, expect, it } from 'vitest';
import { phpFloatString } from '../src/index.ts';

describe('phpFloatString', () => {
  it("prints floats like PHP's default precision (14), as Moodle shows computed answers", () => {
    // From saved NU Moodle reviews (qtype_formulas "One possible correct answer is: …").
    expect(phpFloatString(Math.cbrt((3 * 7) / (4 * Math.PI * 18900)))).toBe('0.044550153919066');
    expect(phpFloatString((5.1 + 0.01) * (1.8 + 0.01) - 5.1 * 1.8 - 0.01 * 0.01)).toBe('0.068999999999999');
    expect(phpFloatString((50 * 3) / 5)).toBe('30');
    expect(phpFloatString(3.5)).toBe('3.5');
    // Float noise past 14 digits disappears; integers and negatives stay plain.
    expect(phpFloatString(0.1 + 0.2)).toBe('0.3');
    expect(phpFloatString(191.88)).toBe('191.88');
    expect(phpFloatString(-2.5)).toBe('-2.5');
    expect(phpFloatString(10000000000000)).toBe('10000000000000');
    expect(phpFloatString(0.0001)).toBe('0.0001');
    // zend_gcvt's exponent form.
    expect(phpFloatString(0.00001)).toBe('1.0E-5');
    expect(phpFloatString(1.5e-7)).toBe('1.5E-7');
    expect(phpFloatString(1e14)).toBe('1.0E+14');
    expect(phpFloatString(1.152e16)).toBe('1.152E+16');
    expect(phpFloatString(0)).toBe('0');
  });
});
