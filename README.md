# PitchLab

An interactive 3D baseball pitching simulator: **change your grip → see the estimated spin change → watch and compare the resulting pitch.**
It is built with React, TypeScript, Three.js and React Three Fiber.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics, grip-estimation and store tests (vitest)
npm run build      # typecheck + production build into dist/
```

## Architecture

| Layer | Files | Notes |
|---|---|---|
| **Grip estimation** | `src/grip/estimate.ts`, `presets.ts`, `knuckle.ts` | Grip + delivery → estimated release speed, spin rate, spin axis, initial orientation. Documented heuristics only. |
| **Flight physics** | `src/physics/simulate.ts`, `aero.ts`, `seamModel.ts`, `pitch.ts` | Release conditions → trajectory. Has no knowledge of grips, UI or cameras. |
| State | `src/state/store.ts`, `derived.tsx` | `computeDerived()` is a pure function: grip/delivery → spec → physics. View state is never an input. |
| Hand display | `src/grip/handModel.ts` | Anatomical hand pose reaching the contacts (display only). |
| UI | `src/components/*` | Grip editor, flight view, ball close-up, controls, compare and knuckle lab. |

All quantities are SI internally (m, s, kg, rad/s). Display units are converted at the edge (`src/util/units.ts`).
World frame: origin at the back tip of home plate, +y up, +z toward the pitcher, +x = pitcher's right (third-base side).

### Flight physics
* Gravity, drag `C_D = 0.3008 + 0.0292·(rpm/1000)`, and Magnus `C_L = 1.12·S/(0.583 + 2.333·S)` with `S = r·ω⊥/v`.
  These follow A. M. Nathan's trajectory calculator. Only spin perpendicular to the air-relative velocity produces lift, so zero spin gives zero Magnus force.
* Fixed-step classical RK4 (default 1 ms, selectable 2 / 1 / 0.5 / 0.25 ms). It is independent of the rendering frame rate.
  The plate crossing (front edge, 17 in) is found by cubic-Hermite interpolation between steps.
* Regulation geometry: 60 ft 6 in rubber to plate, 10 in mound. Release z = rubber − extension, so extension changes flight distance and time.
* Air density comes from temperature, elevation and humidity. Wind is optional.
* The **no-lift reference** (dashed) has the same release velocity with gravity and drag only.
  Horizontal movement and induced vertical movement (IVB) are measured against it at the plate.
* Seam-shifted wake is **not** in the default model. The seam model below can be applied to spinning pitches only through a toggle labelled EXPERIMENTAL.

### Grip estimation (Guided mode)
1. A lever-arm descriptor sums `pressure · (r × D)` over finger contacts. Fingers drive the ball along "down + 0.3·forward" and the thumb pushes up.
   This gives a grip tilt, a grip gyro angle and a leverage magnitude.
2. A feature vector (grip tilt and gyro, leverage, index–middle spread, knuckle contact score, number of top fingers, thumb latitude) is compared with each preset.
   The nearest preset within radius 2.5 becomes the base family. Outside every neighbourhood the grip is **unsupported**.
   PitchLab then shows no numbers until the user picks a family (labelled low-confidence) or enters release conditions in Physics mode.
3. Local adjustments around the base preset's reference release:
   * tilt = ref + 0.6·Δtilt + 0.7·(arm slot − 40°)
   * gyro = ref + 0.6·Δgyro
   * spin and speed scaled by leverage, spread and arm speed

   Every adjustment is listed in the explanation panel.

Physics mode locks speed, spin, axis and seam orientation to user values until **Restore grip estimates** is pressed. Release position and direction are delivery inputs in both modes.

## Knuckleball model (dedicated low-spin model)

**Status: qualitative approximation with replaceable coefficients. It is not fitted to measured data.**

* **Forces:** gravity, drag, residual Magnus (from the small residual spin), and a seam-dependent force.
  The seam force is computed from the actual seam curve (`seamGeometry.ts`, the same curve that is rendered) at the ball's instantaneous orientation.
* **Orientation:** updated analytically, `q(t) = Rot(ω̂, |ω|t)·q₀`. Slowly rotating seams therefore change the force's direction and size continuously.
  No random offsets, sharp corners or visual shaking are ever added.
* **Kernel:** each seam sample at angle φ from the front stagnation point contributes along its transverse direction, weighted by
  `w(φ) = exp(−((φ−75°)/12°)²) − 0.6·exp(−((φ−106°)/8°)²)`.
  The positive lobe is a trip: the seam delays separation on that side and pushes the ball toward it. The negative lobe sits at separation: the seam causes early separation and pushes the ball away.
  Symmetric layouts cancel. The result is normalised so its peak equals `C_peak = 0.20`.
* **Basis:**
  * Watts & Sawyer (1975, *Am. J. Phys.* 43, 960): orientation-dependent steady lateral force of order 0.1 lbf at about 21 m/s on a non-spinning ball, with fluctuations near critical angles.
  * Morrissey (2009 thesis) and Borg & Morrissey (2014, *Am. J. Phys.* 82, 921): slowly rotating two-seam and four-seam balls.
  * Nathan (2012, *Procedia Eng.* 34): measured knuckleball paths are smooth, and most do not change direction repeatedly.
* **Supported configurations:** two-seam and four-seam orientations rotating slowly (≲ 2 rev in flight) about a mostly transverse axis. Anything else is flagged in the UI as extrapolation.
* **Assumptions:** no Reynolds-number dependence between 25 and 40 m/s; quasi-steady (no wake lag); no fluctuating component; force perpendicular to the air-relative velocity.
* All six coefficients are editable in **Knuckle lab → model & coefficients**. Turning seam forces off leaves exactly the gravity + drag + residual-Magnus baseline (tested).
* Zero spin is not treated as maximum movement. At zero spin the force direction is fixed by the release orientation, and a symmetric orientation gives almost none.
* **Throw 20 pitches:** uniform sampling within the displayed ranges using a seeded mulberry32 generator. It is labelled *simulated sensitivity, not a calibrated probability forecast*.

## Verified behaviours (`npm test`)
* Backspin pushes up, topspin pushes down, and arm-side sidespin pushes toward the arm side for both hands. Magnus is perpendicular to velocity. Zero spin and pure gyro spin produce no Magnus force.
* Identical inputs give identical trajectories. Plate crossings agree to < 0.1 mm across 2 ms to 0.25 ms steps.
* Moving a finger changes the guided estimate and the trajectory. Physics-mode values stay locked through grip edits and preset loads.
* Camera and display changes never alter the simulation. Left-handed pitches exactly mirror right-handed ones, including the seam model.
* Knuckleball:
  * seam forces off gives the baseline
  * a 2° seam change or a 5 rpm spin change moves the pitch
  * the force varies smoothly
  * a slow-spinning knuckleball reverses at most twice
  * ensembles reproduce exactly for a given seed
* Saved grips persist to localStorage.
