import { FT, MPH } from './constants';
import type { Vec3 } from './vec';

export interface EnvironmentSettings {
  temperatureF: number;
  elevationFt: number;
  relativeHumidity: number; // 0..1
  windMph: number;
  /** Direction the wind blows TOWARD, degrees in the horizontal plane: 0 = toward home plate (tailwind for the pitch),
   *  90 = toward the first-base side, 180 = toward the pitcher (headwind), 270 = toward third base. */
  windToDeg: number;
}

export const DEFAULT_ENV: EnvironmentSettings = {
  temperatureF: 70,
  elevationFt: 0,
  relativeHumidity: 0.5,
  windMph: 0,
  windToDeg: 0,
};

/** Moist-air density from temperature, elevation (standard-atmosphere pressure) and humidity. kg/m^3. */
export function airDensity(env: EnvironmentSettings): number {
  const T = ((env.temperatureF - 32) * 5) / 9 + 273.15;
  const h = env.elevationFt * FT;
  const P = 101325 * Math.pow(1 - 2.25577e-5 * h, 5.25588); // Pa
  const Tc = T - 273.15;
  const psat = 610.78 * Math.exp((17.27 * Tc) / (Tc + 237.3)); // Tetens, Pa
  const pv = Math.min(1, Math.max(0, env.relativeHumidity)) * psat;
  const pd = P - pv;
  return pd / (287.058 * T) + pv / (461.495 * T);
}

export function windVector(env: EnvironmentSettings): Vec3 {
  const s = env.windMph * MPH;
  const a = (env.windToDeg * Math.PI) / 180;
  // 0 deg -> toward plate (-z); 90 deg -> toward first base (-x)
  return [-s * Math.sin(a), 0, -s * Math.cos(a)];
}
