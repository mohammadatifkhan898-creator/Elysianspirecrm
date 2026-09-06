import { useEffect, useRef } from 'react';
import { inr } from './utils';

/* ═══════════════════════════════════════════════════════════════
   Chart components. Ports of the vanilla SVG builders (lineChart,
   barChart, horizBars) + the animateCharts / wireChartTips behaviors.
   Class names and structure match the vanilla output so the global
   stylesheet renders identically. The "live" pulsing behavior
   (driveLiveCharts) is driven by a shared interval in App.tsx.
   ═══════════════════════════════════════════════════════════════ */

export const GOLD = '#D4AF6A';
export const NAVY = '#111827';
export const SLATE = '#64748B';

interface LineChartProps {
  data: number[];
  labels: string[];
  gradId: string;
  accent?: string;
  hl?: number;
  unit?: 'count' | 'money';
}

export function LineChart({ data, labels, gradId, accent = GOLD, hl, unit }: LineChartProps) {
  const w = 560,
    h = 230,
    padL = 44,
    padR = 12,
    padT = 16,
    padB = 30;
  const iw = w - padL - padR,
    ih = h - padT - padB;
  const max = Math.max(...data) * 1.15;
  const pts = data.map((v, i) => [
    padL + (iw * (i / (data.length - 1 || 1))),
    padT + ih - (v / max) * ih,
  ]);
  let d = 'M' + pts[0][0] + ',' + pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1],
      [x1, y1] = pts[i],
      cx = (x0 + x1) / 2;
    d += ' C' + cx + ',' + y0 + ' ' + cx + ',' + y1 + ' ' + x1 + ',' + y1;
  }
  const area = d + ' L' + pts[pts.length - 1][0] + ',' + (padT + ih) + ' L' + pts[0][0] + ',' + (padT + ih) + ' Z';

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }} data-unit={unit || ''}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity=".28" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((g) => {
        const gy = padT + ih * (g / 4);
        const tick = Math.round((max / 4) * (4 - g));
        const tl = tick >= 1000 ? tick / 1000 + 'k' : tick;
        return (
          <g key={g}>
            <line x1={padL} y1={gy} x2={w - padR} y2={gy} stroke="#E6DEC9" strokeWidth="1" />
            <text x={padL - 8} y={gy + 4} textAnchor="end" fontSize="10.5" fill="#9B9586" fontFamily="var(--font-mono)">
              {tl}
            </text>
          </g>
        );
      })}
      <path d={area} fill={`url(#${gradId})`} className="lfade" />
      <path d={d} fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" className="lline" />
      {pts.map((p, i) => {
        const v = data[i];
        const lab = labels[i];
        return (
          <g
            key={i}
            className="ldot"
            data-i={i}
            data-v={v}
            data-lab={lab}
            data-x={Math.round(p[0])}
            data-y={Math.round(p[1])}
            style={{ cursor: 'pointer' }}
          >
            <circle r="14" fill="transparent" />
            <circle className="ldotc" cx={p[0]} cy={p[1]} r={i === hl ? 6 : 4} fill={accent} stroke="#fff" strokeWidth="2" />
          </g>
        );
      })}
      {hl != null && (
        <g
          className="hlmark"
          data-x={Math.round(pts[hl][0])}
          data-y={Math.round(pts[hl][1])}
          data-v={data[hl]}
          data-lab={labels[hl]}
          style={{ cursor: 'pointer' }}
        >
          <circle r="12" fill="transparent" />
        </g>
      )}
      {labels.map((lb, i) => {
        const x = padL + iw * (i / (data.length - 1 || 1));
        return (
          <text key={i} x={x} y={h - 9} textAnchor="middle" fontSize="10.5" fill="#9B9586">
            {lb}
          </text>
        );
      })}
    </svg>
  );
}

interface BarChartProps {
  data: number[];
  labels: string[];
  accent?: string;
  hl?: number;
}

export function BarChart({ data, labels, accent = GOLD, hl }: BarChartProps) {
  const w = 560,
    h = 230,
    padL = 36,
    padR = 12,
    padT = 18,
    padB = 28;
  const iw = w - padL - padR,
    ih = h - padT - padB;
  const max = Math.max(...data) * 1.15;
  const n = data.length,
    slot = iw / n,
    barW = Math.min(slot * 0.52, 34);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }} data-max={max.toFixed(3)} data-ih={ih} data-padt={padT}>
      {[0, 1, 2, 3, 4].map((g) => {
        const gy = padT + ih * (g / 4);
        return (
          <g key={g}>
            <line x1={padL} y1={gy} x2={w - padR} y2={gy} stroke="#E6DEC9" strokeWidth="1" />
            <text x={padL - 7} y={gy + 4} textAnchor="end" fontSize="10.5" fill="#9B9586" fontFamily="var(--font-mono)">
              {Math.round((max / 4) * (4 - g))}
            </text>
          </g>
        );
      })}
      {data.map((v, i) => {
        const x = padL + slot * i + (slot - barW) / 2;
        const bh = (v / max) * ih;
        const y = padT + ih - bh;
        const fill = i === hl ? accent : NAVY;
        return (
          <g key={i} className="barg" data-i={i} data-v={v} data-base={v} data-lab={labels[i]} style={{ cursor: 'pointer' }}>
            <rect className="barect" width={barW} height={bh} x={x} y={y} rx="5" fill={fill} data-y={y} data-h={bh} />
          </g>
        );
      })}
      {labels.map((lb, i) => {
        const x = padL + slot * i + slot / 2;
        return (
          <text key={i} x={x} y={h - 8} textAnchor="middle" fontSize="10.5" fill="#9B9586">
            {lb}
          </text>
        );
      })}
    </svg>
  );
}

interface HorizBarsProps {
  items: { name: string; orders: number; pct: number }[];
}

export function HorizBars({ items }: HorizBarsProps) {
  return (
    <div className="bar-list">
      {items.map((it, i) => {
        const shade = i === 0 ? GOLD : i < 3 ? NAVY : SLATE;
        return (
          <div className="bar-row" key={it.name}>
            <div className="bar-head">
              <span className="bl">{it.name}</span>
              <span className="bv">
                {it.orders} orders &middot; {it.pct}%
              </span>
            </div>
            <span className="bar-track">
              <span className="bar-fill" data-pct={it.pct} data-base={it.pct} style={{ background: shade, width: it.pct + '%' }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════ Chart tooltip wiring ═══════════════════ */
/** Wraps a chart SVG and wires the hover tooltip behavior. */
export function ChartTooltip({ children, unit }: { children: React.ReactNode; unit?: 'count' | 'money' }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = ref.current as HTMLDivElement;
    let tip: HTMLDivElement | null = box.querySelector('.charttip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'charttip';
      box.appendChild(tip);
    }
    tip.style.cssText =
      'position:absolute;pointer-events:none;background:var(--navy);color:#fff;border-radius:8px;padding:7px 10px;font-size:12px;box-shadow:var(--shadow-md);opacity:0;transition:opacity .12s ease;transform:translate(-50%,-110%);z-index:30;white-space:nowrap';

    const rootSVG = box.querySelector('svg');
    const vbw = rootSVG ? rootSVG.viewBox.baseVal.width || 560 : 560;
    const vbh = rootSVG ? rootSVG.viewBox.baseVal.height || 230 : 230;
    const scale = rootSVG ? rootSVG.getBoundingClientRect().width / (rootSVG.viewBox.baseVal.width || 560) : 1;
    const isCount = unit === 'count';
    const fmtLine = (v: string) =>
      isCount ? +v + ' reservations' : '₹' + (+v * 1000).toLocaleString('en-IN');

    function show(x: number, y: number, lab: string, val: string) {
      if (!tip) return;
      tip.innerHTML = isCount
        ? '<span style="color:var(--gold);font-family:var(--font-mono);font-weight:600">' + val + '</span>'
        : '<b>' + lab + '</b><span style="color:var(--gold);font-family:var(--font-mono);font-weight:600">' + val + '</span>';
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
      tip.style.opacity = '1';
    }
    function follow(ev: MouseEvent) {
      if (!tip) return;
      const r = box.getBoundingClientRect();
      tip.style.left = ev.clientX - r.left + 'px';
      tip.style.top = ev.clientY - r.top - 18 + 'px';
    }
    const leave = () => {
      if (tip) tip.style.opacity = '0';
    };

    box.querySelectorAll('.ldot, .hlmark').forEach((g) => {
      const el = g as SVGElement;
      const x = +el.dataset.x!,
        y = +el.dataset.y!;
      const val = fmtLine(el.dataset.v!);
      const lab = el.dataset.lab!;
      el.addEventListener('mouseenter', () => show(x * scale, y * scale, lab, val));
      el.addEventListener('mousemove', follow);
      el.addEventListener('mouseleave', leave);
    });
    box.querySelectorAll('.barg').forEach((g) => {
      const el = g as SVGElement;
      el.addEventListener('mouseenter', () => {
        if (tip)
          tip.innerHTML =
            '<b>' + el.dataset.lab + '</b><span style="color:var(--gold);font-family:var(--font-mono);font-weight:600">' + el.dataset.v + '</span>';
        tip!.style.opacity = '1';
      });
      el.addEventListener('mousemove', follow);
      el.addEventListener('mouseleave', leave);
    });

    if (rootSVG && box.querySelectorAll('.ldot').length) {
      const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      overlay.setAttribute('fill', 'transparent');
      overlay.setAttribute('width', String(vbw));
      overlay.setAttribute('height', String(vbh));
      rootSVG.insertBefore(overlay, rootSVG.firstChild);
      const pts = Array.from(box.querySelectorAll('.ldot')).map((g) => {
        const el = g as SVGElement;
        return { x: +el.dataset.x!, y: +el.dataset.y!, v: el.dataset.v!, lab: el.dataset.lab! };
      });
      const onMove = (ev: MouseEvent) => {
        const sr = rootSVG.getBoundingClientRect();
        const s = sr.width / (vbw || 560);
        const curX = (ev.clientX - sr.left) / s;
        let best = pts[0],
          bestD = 1e9;
        pts.forEach((p) => {
          const d = Math.abs(p.x - curX);
          if (d < bestD) {
            best = p;
            bestD = d;
          }
        });
        show(best.x * s, best.y * s, best.lab, fmtLine(best.v));
        tip!.style.left = ev.clientX - box.getBoundingClientRect().left + 'px';
        tip!.style.top = ev.clientY - box.getBoundingClientRect().top - 18 + 'px';
      };
      overlay.addEventListener('mousemove', onMove);
      overlay.addEventListener('mouseleave', leave);
      return () => overlay.remove();
    }
  }, []);

  return (
    <div className="chart-box" ref={ref}>
      {children}
    </div>
  );
}

export { inr };
