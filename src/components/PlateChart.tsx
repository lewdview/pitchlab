import { useStore } from '../state/store';
import { useDerived } from '../state/derived';
import { PLATE_WIDTH, IN } from '../physics/constants';

/** Catcher's-view plate-location chart, equal horizontal and vertical scale. */
export function PlateChart({ title = 'Plate location (catcher’s view)', showEnsembleLabel = false }: { title?: string; showEnsembleLabel?: boolean }) {
  const { result } = useDerived();
  const pinned = useStore((s) => s.pinned);
  const overlay = useStore((s) => s.overlay);
  const zoneTop = useStore((s) => s.view.zoneTop);
  const zoneBottom = useStore((s) => s.view.zoneBottom);
  // metres: x in [-0.65, 0.65], y in [0, 1.5]
  const W = 260, xr = 0.65, yMax = 1.5;
  const sc = W / (2 * xr);
  const H = yMax * sc;
  const X = (x: number) => W / 2 + x * sc; // x = catcher's right (+)
  const Y = (y: number) => H - y * sc;
  const hw = PLATE_WIDTH / 2;
  const dot = (x: number, y: number, c: string, r = 5, key?: string | number, op = 1) => <circle key={key} cx={X(x)} cy={Y(y)} r={r} fill={c} fillOpacity={op} stroke="#0a1428" strokeWidth={1} />;
  const crossings = (overlay?.results ?? []).map((r) => r.metrics);
  return (
    <figure className="plate-chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label="Plate location chart">
        <rect x={X(-hw)} y={Y(zoneTop)} width={PLATE_WIDTH * sc} height={(zoneTop - zoneBottom) * sc} fill="none" stroke="#e8eefc" strokeWidth={1.5} />
        {[1, 2].map((i) => <line key={`v${i}`} x1={X(-hw + (PLATE_WIDTH * i) / 3)} x2={X(-hw + (PLATE_WIDTH * i) / 3)} y1={Y(zoneTop)} y2={Y(zoneBottom)} stroke="#e8eefc" strokeOpacity={0.25} />)}
        {[1, 2].map((i) => <line key={`h${i}`} x1={X(-hw)} x2={X(hw)} y1={Y(zoneBottom + ((zoneTop - zoneBottom) * i) / 3)} y2={Y(zoneBottom + ((zoneTop - zoneBottom) * i) / 3)} stroke="#e8eefc" strokeOpacity={0.25} />)}
        <polygon points={`${X(-hw)},${H - 2} ${X(hw)},${H - 2} ${X(hw)},${H + 4} ${X(0)},${H + 10} ${X(-hw)},${H + 4}`} fill="#f2f2ec" opacity={0.8} />
        {crossings.map((m, i) => m && dot(m.plateX, m.plateY, overlay!.kind === 'ensemble' ? '#ffb347' : `hsl(${200 + (i / Math.max(1, crossings.length - 1)) * 140}, 90%, 65%)`, 4, `o${i}`, 0.85))}
        {pinned.filter((p) => p.visible && p.result.metrics).map((p) => dot(p.result.metrics!.plateX, p.result.metrics!.plateY, p.color, 6, p.id))}
        {result?.metrics && dot(result.metrics.plateX, result.metrics.plateY, '#ff4d5e', 7, 'active')}
        <text x={4} y={12} className="svg-lbl">◀ 3B</text>
        <text x={W - 4} y={12} className="svg-lbl" textAnchor="end">1B ▶</text>
        <text x={W - 4} y={H + 14} className="svg-lbl" textAnchor="end">1 ft = {(0.3048 * sc).toFixed(0)} px · equal scale</text>
      </svg>
      {showEnsembleLabel && overlay?.kind === 'ensemble' && <div className="fine">Orange dots: {overlay.results.length} simulated pitches (seed {overlay.seed}).</div>}
      <div className="fine">Zone {(zoneBottom / IN).toFixed(1)}–{(zoneTop / IN).toFixed(1)} in high, 17 in wide.</div>
    </figure>
  );
}
