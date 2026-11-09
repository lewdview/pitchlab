import { describe, it, expect } from 'vitest';
import { buildHandPose, FINGER_RADIUS } from '../grip/handModel';
import { PRESETS } from '../grip/presets';
import { toWorld, FINGERS } from '../grip/types';
import { len, sub } from '../physics/vec';

describe('hand visualisation pose', () => {
  for (const p of PRESETS) {
    it(`${p.name}: fingertips reach their contacts and nothing passes through the ball`, () => {
      for (const [hand, mode] of [['R', 'hold'], ['L', 'hold'], ['R', 'release'], ['L', 'release']] as const) {
        const pose = buildHandPose(p.fingers, hand, 1, mode);
        for (const f of pose.fingers) {
          // every joint after the knuckle stays outside the ball (allowing finger thickness)
          // holding presses the finger pads slightly into the leather (skin compresses); never deeper than that
          const minR = mode === 'hold' ? 0.9 : 0.97;
          for (const j of f.joints.slice(1)) expect(len(j)).toBeGreaterThanOrEqual(1 + f.radius * minR - 1e-9);
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

import { buildSkinField, skinDistanceAt } from '../grip/handSkin';
describe('continuous hand skin', () => {
  it('encloses every finger bone and the palm, and stays off the ball centre', () => {
    for (const p of PRESETS) {
      const pose = buildHandPose(p.fingers, 'R', 1);
      const sf = buildSkinField(pose, 96);
      expect(skinDistanceAt(sf, pose.palmCenter)).toBeLessThan(0);
      for (const f of pose.fingers) {
        for (let i = 0; i < 3; i++) {
          const mid: [number, number, number] = [0, 1, 2].map((k) => (f.joints[i][k] + f.joints[i + 1][k]) / 2) as [number, number, number];
          expect(skinDistanceAt(sf, mid)).toBeLessThan(0);
        }
      }
      expect(skinDistanceAt(sf, [0, 0, 0])).toBeGreaterThan(0);
    }
  });
});

describe('holding vs release pose', () => {
  it('when holding, the middle and end finger segments press the leather; at release they lift away', () => {
    const p = PRESETS.find((x) => x.id === 'four-seam')!;
    const hold = buildHandPose(p.fingers, 'R', 1, 'hold');
    const rel = buildHandPose(p.fingers, 'R', 1, 'release');
    for (const id of ['index', 'middle'] as const) {
      const h = hold.fingers.find((f) => f.id === id)!, r = rel.fingers.find((f) => f.id === id)!;
      // PIP and DIP within ~5% of a finger radius of touching (|p| = 1 + r) when holding
      for (const j of [1, 2]) expect(Math.abs(len(h.joints[j]) - (1 + h.radius))).toBeLessThan(0.06);
      // at release the PIP is well off the ball
      expect(len(r.joints[1]) - (1 + r.radius)).toBeGreaterThan(0.2);
    }
    // the ball sits closer to the palm when it is held
    expect(len(hold.palmCenter)).toBeLessThan(len(rel.palmCenter));
  });
});
