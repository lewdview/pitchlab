import { useStore } from '../state/store';
import { useDerived } from '../state/derived';
import { fmtSpeed, fmtSmall, fmtLong } from '../util/units';
import type { PitchMetrics } from '../physics/pitch';
import type { Units } from '../state/store';

export function metricRows(m: PitchMetrics, u: Units, hand: 'R' | 'L') {
  const side = (x: number) => `${fmtSmall(Math.abs(x), u)} ${x >= 0 ? 'arm side' : 'glove side'}`;
  return [
    ['Release velocity', fmtSpeed(m.releaseSpeed, u)],
    ['Plate velocity', fmtSpeed(m.plateSpeed, u)],
    ['Flight time', `${m.flightTime.toFixed(3)} s`],
    ['Spin rate', `${m.spinRpm.toFixed(m.spinRpm < 300 ? 1 : 0)} rpm`],
    ['Spin efficiency', `${(m.spinEfficiency * 100).toFixed(0)}%`],
    ['Revolutions in flight', m.totalRevolutions.toFixed(m.totalRevolutions < 3 ? 2 : 1)],
    ['Horizontal movement', side(m.hMoveArmSide)],
    ['Induced vertical movement', fmtSmall(m.ivb, u, true)],
    ['Total vertical drop', fmtSmall(m.totalDrop, u)],
    ['Plate location', `${fmtSmall(Math.abs(m.plateX), u)} ${m.plateX >= 0 ? '1B side' : '3B side'}, ${fmtLong(m.plateY, u)} high`],
    ['Approach angles', `VAA ${m.vaa.toFixed(1)}°, HAA ${m.haa.toFixed(1)}°`],
    ['Flight distance', fmtLong(m.flightDistance, u)],
  ].map(([k, v]) => ({ k, v, hand }));
}

export function Measurements() {
  const { result } = useDerived();
  const units = useStore((s) => s.view.units);
  const hand = useStore((s) => s.hand);
  const m = result?.metrics;
  if (!result) return <div className="panel"><p className="fine">No active pitch.</p></div>;
  if (!m) return <div className="panel"><p className="warn-text">The ball reached the ground before the plate. Raise the release angle or use “Aim at zone target”.</p></div>;
  return (
    <div className="panel measurements">
      <dl className="metrics">
        {metricRows(m, units, hand).map((r) => (
          <div key={r.k}><dt>{r.k}</dt><dd>{r.v}</dd></div>
        ))}
      </dl>
      <details className="defs">
        <summary>What do these measurements mean?</summary>
        <ul>
          <li><b>Horizontal movement</b>: how far sideways the pitch ends up at the front of the plate, compared with the dashed reference. The reference leaves with the same velocity and feels gravity and drag but no lift (no Magnus or seam force).</li>
          <li><b>Induced vertical movement (IVB)</b>: the same comparison in height. <em>Positive IVB means the pitch dropped less than the reference. It does not mean the ball rose.</em> Every pitch still falls under gravity.</li>
          <li><b>Total vertical drop</b>: how far below the straight line of its release direction the pitch crosses the plate, including gravity.</li>
          <li><b>Spin efficiency</b>: the share of spin perpendicular to the flight direction. Only that part creates Magnus force; the rest is gyro spin.</li>
          <li><b>Flight time and distance</b> run from the release point (rubber minus extension) to the front edge of home plate. The crossing is interpolated between fixed simulation steps.</li>
          <li>Horizontal values are given as arm side / glove side for the current pitcher. Plate location uses the catcher's view (1B side = catcher's right).</li>
        </ul>
      </details>
    </div>
  );
}

export function KeyMetrics() {
  const { result, spec } = useDerived();
  const units = useStore((s) => s.view.units);
  const mode = useStore((s) => s.mode);
  const m = result?.metrics;
  const cards: [string, string, string?][] = m && spec
    ? [
        ['Release', fmtSpeed(m.releaseSpeed, units), mode === 'guided' ? 'est.' : 'manual'],
        ['At plate', fmtSpeed(m.plateSpeed, units)],
        ['Flight', `${m.flightTime.toFixed(3)} s`],
        ['Spin', `${m.spinRpm.toFixed(m.spinRpm < 300 ? 1 : 0)} rpm`, `${(m.spinEfficiency * 100).toFixed(0)}% eff · ${m.totalRevolutions.toFixed(2)} rev`],
        ['H move', `${fmtSmall(Math.abs(m.hMoveArmSide), units)}`, m.hMoveArmSide >= 0 ? 'arm side' : 'glove side'],
        ['IVB', fmtSmall(m.ivb, units, true), m.ivb >= 0 ? 'less drop than ref.' : 'more drop than ref.'],
        ['Total drop', fmtSmall(m.totalDrop, units)],
      ]
    : [];
  if (!cards.length) return null;
  return (
    <div className="key-metrics">
      {cards.map(([k, v, sub]) => (
        <div key={k} className="km"><span>{k}</span><b>{v}</b>{sub && <em>{sub}</em>}</div>
      ))}
    </div>
  );
}
