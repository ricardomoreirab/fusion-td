import { describe, it, expect } from 'vitest';
import { aliveCount, isRunOver, shouldSpectate, type SlotAliveView } from '../src/survivors/coop/coopRunState';

describe('aliveCount', () => {
  it('counts zero from an empty list', () => {
    expect(aliveCount([])).toBe(0);
  });

  it('counts all alive slots', () => {
    const slots: SlotAliveView[] = [
      { id: 0, alive: true },
      { id: 1, alive: true },
    ];
    expect(aliveCount(slots)).toBe(2);
  });

  it('counts only alive slots when mixed', () => {
    const slots: SlotAliveView[] = [
      { id: 0, alive: true },
      { id: 1, alive: false },
    ];
    expect(aliveCount(slots)).toBe(1);
  });

  it('returns 0 when all dead', () => {
    const slots: SlotAliveView[] = [{ id: 0, alive: false }, { id: 1, alive: false }];
    expect(aliveCount(slots)).toBe(0);
  });
});

describe('isRunOver', () => {
  it('SP: single hero dead → run is over', () => {
    expect(isRunOver([{ id: 0, alive: false }])).toBe(true);
  });

  it('SP: hero still alive → run is NOT over', () => {
    expect(isRunOver([{ id: 0, alive: true }])).toBe(false);
  });

  it('co-op: 1-of-2 dead → run NOT over (teammate alive)', () => {
    const slots: SlotAliveView[] = [{ id: 0, alive: false }, { id: 1, alive: true }];
    expect(isRunOver(slots)).toBe(false);
  });

  it('co-op: 2-of-2 dead → run is over', () => {
    const slots: SlotAliveView[] = [{ id: 0, alive: false }, { id: 1, alive: false }];
    expect(isRunOver(slots)).toBe(true);
  });

  it('empty slot list → NOT over (guard for uninitialized state)', () => {
    expect(isRunOver([])).toBe(false);
  });
});

describe('shouldSpectate', () => {
  it('SP hero dies → should NOT spectate (SP ends run)', () => {
    const slots: SlotAliveView[] = [{ id: 0, alive: false }];
    expect(shouldSpectate(slots, false)).toBe(false);
  });

  it('co-op: just-died hero, teammate alive → should spectate', () => {
    // slots reflects state AFTER the hero died: id:0 dead, id:1 alive
    const slots: SlotAliveView[] = [{ id: 0, alive: false }, { id: 1, alive: true }];
    expect(shouldSpectate(slots, true)).toBe(true);
  });

  it('co-op: last hero dies → should NOT spectate (run ends)', () => {
    const slots: SlotAliveView[] = [{ id: 0, alive: false }, { id: 1, alive: false }];
    expect(shouldSpectate(slots, true)).toBe(false);
  });

  it('SP with alive hero → shouldSpectate false regardless (isCoop=false)', () => {
    const slots: SlotAliveView[] = [{ id: 0, alive: true }];
    expect(shouldSpectate(slots, false)).toBe(false);
  });

  it('aliveCount=0 in co-op → shouldSpectate false', () => {
    expect(shouldSpectate([], true)).toBe(false);
  });
});
