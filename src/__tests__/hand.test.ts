import { describe, it, expect } from 'vitest';
import { buildHandPose, FINGER_RADIUS } from '../grip/handModel';
import { PRESETS } from '../grip/presets';
import { toWorld, FINGERS } from '../grip/types';
import { len, sub } from '../physics/vec';

describe('hand visualisation pose', () => {
  for (const p of PRESETS) {
    it(`${p.name}: fingertips reach their contacts and nothing passes through the ball`, () => {
      for (const hand of ['R', 'L'] as const) {
        const pose = buildHandPose(p.fingers, hand, 1);
        for (const f of pose.fingers) {
          // every joint after the knuckle stays outside the ball (allowing finger thickness)
          for (const j of f.joints.slice(1)) expect(len(j)).toBeGreaterThanOrEqual(1 + f.radius * 0.97 - 1e-9);
          if (!f.enabled) continue;
          const c = toWorld(p.fingers[f.id], hand);
          const contact = p.fingers[f.id].contact;
          // the touching point (fingertip, or DIP knuckle for bent-finger contact) sits on the contact
          const touching = contact === 'knuckle' ? f.joints[2] : f.joints[3];
          const k = 1 + FINGER_RADIUS[f.id];
          const surfacePoint = sub(touching, [c[0] * k, c[1] * k, c[2] * k]);
          expect(len(surfacePoint)).toBeLessThan(0.06);
        }
        // the palm stays outside the ball
        expect(len(pose.palmCenter)).toBeGreaterThan(1.2);
      }
    });
  }
  it('left hand is the mirror image of the right hand', () => {
    const p = PRESETS.find((x) => x.id === 'slider')!;
    const r = buildHandPose(p.fingers, 'R', 1), l = buildHandPose(p.fingers, 'L', 1);
    for (let i = 0; i < FINGERS.length; i++) {
      r.fingers[i].joints.forEach((j, k) => {
        const m = l.fingers[i].joints[k];
        expect(m[0]).toBeCloseTo(-j[0], 9); expect(m[1]).toBeCloseTo(j[1], 9); expect(m[2]).toBeCloseTo(j[2], 9);
      });
    }
  });
  it('hand size scales the hand, not the contacts', () => {
    const p = PRESETS[0];
    const a = buildHandPose(p.fingers, 'R', 0.85), b = buildHandPose(p.fingers, 'R', 1.15);
    expect(b.fingers[2].radius).toBeGreaterThan(a.fingers[2].radius);
    expect(len(sub(b.fingers[2].joints[3], a.fingers[2].joints[3]))).toBeLessThan(0.15);
  });
});
