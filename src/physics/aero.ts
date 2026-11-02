// Drag and Magnus (lift) coefficient models.
//
// Source: A. M. Nathan, "Trajectory Calculator" (baseball.physics.illinois.edu), which parameterises
//   C_D = cd0 + cdSpin * (spin_rpm / 1000)
//   C_L = cl2 * S / (cl0 + cl1 * S),    S = r * omega_perp / v
// with cd0 = 0.3008, cdSpin = 0.0292, cl0 = 0.583, cl1 = 2.333, cl2 = 1.120.
// The C_L form saturates at large S and goes to zero for zero spin, so zero spin gives zero Magnus force.
// Only the component of spin perpendicular to the air-relative velocity produces Magnus force
// (gyro spin produces none).

import { BALL_RADIUS } from './constants';

export interface AeroCoefficients {
  cd0: number;
  cdSpin: number;
  cl0: number;
  cl1: number;
  cl2: number;
}

export const NATHAN_AERO: AeroCoefficients = { cd0: 0.3008, cdSpin: 0.0292, cl0: 0.583, cl1: 2.333, cl2: 1.12 };

export function dragCoefficient(spinRadS: number, c: AeroCoefficients = NATHAN_AERO): number {
  const rpm = (spinRadS * 60) / (2 * Math.PI);
  return c.cd0 + c.cdSpin * (rpm / 1000);
}

export function liftCoefficient(omegaPerp: number, speed: number, c: AeroCoefficients = NATHAN_AERO): number {
  if (omegaPerp <= 0 || speed <= 1e-9) return 0;
  const S = (BALL_RADIUS * omegaPerp) / speed;
  return (c.cl2 * S) / (c.cl0 + c.cl1 * S);
}
