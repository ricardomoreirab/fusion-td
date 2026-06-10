import { describe, it, expect } from 'vitest';
import { encode, decode, type InputMsg } from '../src/net/Protocol';
import { packButtons, unpackButtons } from '../src/net/InputButtons';

describe('InputMsg round-trip', () => {
  it('round-trips through encode/decode', () => {
    const msg: InputMsg = { t: 'input', seq: 42, dx: 0.5, dz: -0.3, buttons: 0b1010 };
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('round-trips with zero fields', () => {
    const msg: InputMsg = { t: 'input', seq: 0, dx: 0, dz: 0, buttons: 0 };
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('round-trips with all buttons set', () => {
    const msg: InputMsg = { t: 'input', seq: 999, dx: -1, dz: 1, buttons: 0b1111 };
    expect(decode(encode(msg))).toEqual(msg);
  });
});

describe('InputButtons bitfield', () => {
  it('packs and unpacks all-false', () => {
    const b = { dash: false, ult1: false, ult2: false, ability3: false };
    expect(unpackButtons(packButtons(b))).toEqual(b);
  });

  it('packs and unpacks all-true', () => {
    const b = { dash: true, ult1: true, ult2: true, ability3: true };
    expect(unpackButtons(packButtons(b))).toEqual(b);
  });

  it('each bit is independent', () => {
    const combos = [
      { dash: true,  ult1: false, ult2: false, ability3: false },
      { dash: false, ult1: true,  ult2: false, ability3: false },
      { dash: false, ult1: false, ult2: true,  ability3: false },
      { dash: false, ult1: false, ult2: false, ability3: true  },
    ];
    for (const b of combos) {
      expect(unpackButtons(packButtons(b))).toEqual(b);
    }
  });

  it('all 16 combinations round-trip correctly', () => {
    for (let n = 0; n < 16; n++) {
      const b = {
        dash:     (n & 1) !== 0,
        ult1:     (n & 2) !== 0,
        ult2:     (n & 4) !== 0,
        ability3: (n & 8) !== 0,
      };
      expect(unpackButtons(packButtons(b))).toEqual(b);
      // Also verify the packed number matches n
      expect(packButtons(b)).toBe(n);
    }
  });

  it('packButtons produces a number in [0,15]', () => {
    const max = { dash: true, ult1: true, ult2: true, ability3: true };
    expect(packButtons(max)).toBe(15);
    const min = { dash: false, ult1: false, ult2: false, ability3: false };
    expect(packButtons(min)).toBe(0);
  });
});
