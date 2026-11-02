// Physical constants and regulation field geometry (SI units).

export const G = 9.80665; // m/s^2
export const BALL_MASS = 0.145; // kg (5.0–5.25 oz regulation; 5.125 oz midpoint)
export const BALL_RADIUS = 0.0369; // m (9.125 in circumference midpoint)
export const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;

export const FT = 0.3048;
export const IN = 0.0254;
export const MPH = 0.44704;

/** Front edge of the pitching rubber to the back tip of home plate: 60 ft 6 in. */
export const RUBBER_TO_PLATE = 60.5 * FT;
/** Front edge of home plate measured from the back tip (17 in). Plate crossing is measured here. */
export const PLATE_FRONT_Z = 17 * IN;
export const PLATE_WIDTH = 17 * IN;
/** Mound height above home plate: 10 in. */
export const MOUND_HEIGHT = 10 * IN;
/** Centre of the 18-ft mound is 18 in behind the rubber front edge. */
export const MOUND_CENTER_Z = RUBBER_TO_PLATE + 18 * IN;
export const MOUND_RADIUS = 9 * FT;
