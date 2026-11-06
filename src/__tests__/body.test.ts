import { describe, it, expect, beforeEach } from 'vitest';
import { releaseFromSlot, slotFromRelease, poseBody, DEFAULT_BODY, slotName } from '../body/pitcherBody';
import { useStore } from '../state/store';
import { len, sub } from '../physics/vec';

const initial = useStore.getState();
beforeEach(() => useStore.setState(initial, true));

describe('pitcher body and release geometry', () => {
  it('arm slot and release point round-trip for any body height', () => {
    for (const H of [1.6, 1.88, 2.05]) for (const slot of [5, 30, 45, 70, 90, 110]) {
      const r = releaseFromSlot(H, slot);
      expect(slotFromRelease(H, r.releaseHeight, r.releaseSide)).toBeCloseTo(slot, 9);
    }
  });
  it('gives realistic release heights: three-quarter ~6 ft, sidearm much lower and wider', () => {
    const tq = releaseFromSlot(1.88, 45), side = releaseFromSlot(1.88, 90);
    expect(tq.releaseHeight / 0.3048).toBeGreaterThan(5.5);
    expect(tq.releaseHeight / 0.3048).toBeLessThan(6.6);
    expect(side.releaseHeight).toBeLessThan(tq.releaseHeight - 0.3);
    expect(side.releaseSide).toBeGreaterThan(tq.releaseSide);
    expect(slotName(45)).toBe('three-quarter');
    expect(slotName(90)).toBe('sidearm');
  });
  it('linked delivery: arm slot moves the release point, editing height updates the slot', () => {
    const st = useStore.getState();
    st.setDelivery({ armSlotDeg: 85 });
    const d1 = useStore.getState().delivery;
    expect(d1.releaseHeight).toBeCloseTo(releaseFromSlot(DEFAULT_BODY.heightM, 85).releaseHeight, 9);
    useStore.getState().setDelivery({ releaseHeight: d1.releaseHeight + 0.3 });
    expect(useStore.getState().delivery.armSlotDeg).toBeLessThan(85);
    useStore.getState().setBody({ heightM: 2.0 });
    const d2 = useStore.getState().delivery;
    expect(d2.releaseHeight).toBeCloseTo(releaseFromSlot(2.0, d2.armSlotDeg).releaseHeight, 9);
    // unlinked: fields are independent
    useStore.getState().setBody({ link: false });
    useStore.getState().setDelivery({ armSlotDeg: 10 });
    expect(useStore.getState().delivery.releaseHeight).toBeCloseTo(d2.releaseHeight, 12);
  });
  it('the posed arm actually reaches the wrist target and segments keep their lengths', () => {
    const H = 1.88;
    const release: [number, number, number] = [0.58, 1.84, 16.5];
    const wrist: [number, number, number] = [0.6, 1.8, 16.6];
    const p = poseBody(DEFAULT_BODY, 'R', release, wrist, 40);
    expect(len(sub(p.elbowT, p.shoulderT))).toBeCloseTo(0.186 * H, 6);
    expect(len(sub(p.wristT, p.elbowT))).toBeCloseTo(0.146 * H, 6);
    expect(p.wristT).toEqual(wrist);
    expect(len(sub(p.kneeF, p.hipF))).toBeCloseTo(0.245 * H, 6);
  });
});
