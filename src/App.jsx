import React, { useState, useRef, useEffect, useMemo } from 'react';

// ─── Constants ──────────────────────────────────────────────────────────────

const APERTURES = [0.95,1,1.1,1.2,1.4,1.5,1.7,1.8,1.9,2,2.2,2.5,2.8,3.2,3.5,4,4.5,5,5.6,6.3,7.1,8,9,10,11,13,14,16,18,20,22];

const SENSORS = [
  { id: 'mft',  name: 'Micro 4/3',  short: 'MFT',  w: 17.3, h: 13.0, coc: 0.015, color: '#4db89a' },
  { id: 'apsc', name: 'APS-C',      short: 'APS-C',w: 23.5, h: 15.6, coc: 0.019, color: '#5b9bd5' },
  { id: 's35',  name: 'Super 35',   short: 'S35',  w: 24.9, h: 18.7, coc: 0.021, color: '#8b7fd4' },
  { id: 'ff',   name: 'Full Frame', short: 'FF',   w: 36.0, h: 24.0, coc: 0.029, color: '#c8a96e' },
  { id: '645',  name: '645',        short: '645',  w: 56.0, h: 42.0, coc: 0.047, color: '#d4925a' },
  { id: '66',   name: '6x6',        short: '6x6',  w: 56.0, h: 56.0, coc: 0.053, color: '#e0c490' },
  { id: '67',   name: '6x7',        short: '6x7',  w: 69.5, h: 56.0, coc: 0.059, color: '#d4705a' },
  { id: '69',   name: '6x9',        short: '6x9',  w: 84.0, h: 56.0, coc: 0.067, color: '#b05060' },
];

// ─── DoF math ───────────────────────────────────────────────────────────────

function calcDoF(fl_mm, aperture, coc_mm, dist_mm) {
  const H = (fl_mm * fl_mm) / (aperture * coc_mm);
  const Dn = (dist_mm * (H - fl_mm)) / (H + dist_mm - 2 * fl_mm);
  const Df = H > dist_mm
    ? (dist_mm * (H - fl_mm)) / (H - dist_mm)
    : Infinity;
  const dof = Df === Infinity ? Infinity : Df - Dn;
  return { Dn, Df, dof, inFront: dist_mm - Dn, behind: Df === Infinity ? Infinity : Df - dist_mm, H };
}

function fmtMM(mm) {
  if (!isFinite(mm)) return '∞';
  if (mm >= 1000) return (mm / 1000).toFixed(2) + ' m';
  return mm.toFixed(0) + ' mm';
}
function fmtCM(mm) {
  if (!isFinite(mm)) return '∞';
  return (mm / 10).toFixed(1) + ' cm';
}
function fmtM(mm) {
  if (!isFinite(mm)) return '∞';
  return (mm / 1000).toFixed(2) + ' m';
}

// ─── Stepped slider ──────────────────────────────────────────────────────────

function SteppedSlider({ values, value, onChange, label, formatVal }) {
  const idx = values.indexOf(value);
  return (
    <div className="slider-wrap">
      <div className="slider-row">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{formatVal ? formatVal(value) : value}</span>
      </div>
      <input
        type="range"
        min={0} max={values.length - 1}
        value={idx < 0 ? 0 : idx}
        onChange={e => onChange(values[+e.target.value])}
      />
    </div>
  );
}

function LogSlider({ min, max, value, onChange, label }) {
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  const ratio = (Math.log(value) - logMin) / (logMax - logMin);
  const pos = Math.round(ratio * 1000);
  const handleSliderChange = e => {
    const p = +e.target.value;
    const v = Math.exp(logMin + (logMax - logMin) * (p / 1000));
    onChange(Math.round(v));
  };
  const handleInputChange = e => {
    const v = Number(e.target.value);
    if (!isNaN(v)) onChange(v);
  };
  return (
    <div className="slider-wrap">
      <div className="slider-row">
        <span className="slider-label">{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={handleInputChange}
          style={{ width: '80px', marginLeft: '8px' }}
        />
      </div>
      <input
        type="range"
        min={0} max={1000}
        value={pos}
        onChange={handleSliderChange}
      />
    </div>
  );
}

// ─── Focus Zone Diagram ──────────────────────────────────────────────────────

function FocusZone({ results, subjectDist, framingWidth, onDistChange, onFramingChange, referenceSensorId }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 300 });

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: width, h: height });
    });
    if (svgRef.current) obs.observe(svgRef.current.parentElement);
    return () => obs.disconnect();
  }, []);

  const W = dims.w, H = dims.h;
  const PAD_L = 56, PAD_R = 20, PAD_TOP = 32, PAD_BOT = 50;
  const trackW = W - PAD_L - PAD_R;

  // Determine visible range: center on subject, show ~±40% of dist
  const span = Math.max(subjectDist * 0.5, 500);
  const rangeMin = subjectDist - span;
  const rangeMax = subjectDist + span;

  function mmToX(mm) {
    return PAD_L + ((mm - rangeMin) / (rangeMax - rangeMin)) * trackW;
  }
  function xToMm(x) {
    return rangeMin + ((x - PAD_L) / trackW) * (rangeMax - rangeMin);
  }

  const subjectX = mmToX(subjectDist);

  // Track rows: distribute evenly
  const nSensors = results.length;
  const rowAreaH = H - PAD_TOP - PAD_BOT;
  // Further reduce vertical spacing between sensor rows for a tighter diagram
  const rowSpacing = rowAreaH / (nSensors * 1);
  const rowYs = results.map((_, i) => PAD_TOP + rowSpacing / 2 + rowSpacing * i);

  // Axis ticks
  const tickCount = 8;
  const tickStep = (rangeMax - rangeMin) / tickCount;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => rangeMin + tickStep * i);

  // ── Pointer drag ────────────────────────────────────────────────────────
  function onPointerDown(e) {
    svgRef.current.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startDist: subjectDist, startFraming: framingWidth };
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragRef.current) return;
    const { startX, startY, startDist, startFraming } = dragRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // Horizontal: pan distance. 1px = (rangeMax-rangeMin)/trackW mm
    const mmPerPx = (rangeMax - rangeMin) / trackW;
    const newDist = Math.max(300, Math.min(50000, startDist + dx * mmPerPx));
    onDistChange(newDist);

    // Vertical: framing. drag down = wider framing. 1px = framing * 0.003
    const newFraming = Math.max(100, Math.min(10000, startFraming + dy * startFraming * 0.003));
    onFramingChange(newFraming);
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  // Build SVG content
  const svgContent = [];

  // Background grid lines (vertical at ticks)
  ticks.forEach((mm, i) => {
    const x = mmToX(mm);
    svgContent.push(
      <line key={`grid-${i}`} x1={x} y1={PAD_TOP} x2={x} y2={H - PAD_BOT}
        stroke="rgba(255,255,255,0.035)" strokeWidth="1"/>
    );
  });

  // Axis line
  svgContent.push(
    <line key="axis" x1={PAD_L} y1={H - PAD_BOT} x2={W - PAD_R} y2={H - PAD_BOT}
      stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
  );

  // Tick marks + labels
  ticks.forEach((mm, i) => {
    const x = mmToX(mm);
    const label = mm >= 10000 ? (mm/1000).toFixed(1)+'m' : mm >= 1000 ? (mm/1000).toFixed(2)+'m' : mm.toFixed(0)+'mm';
    svgContent.push(
      <line key={`tick-${i}`} x1={x} y1={H - PAD_BOT} x2={x} y2={H - PAD_BOT + 5}
        stroke="rgba(255,255,255,0.2)" strokeWidth="1"/>
    );
    svgContent.push(
      <text key={`tlbl-${i}`} x={x} y={H - PAD_BOT + 16}
        textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.3)"
        fontFamily="'DM Mono', monospace">{label}</text>
    );
  });

  // Subject line
  svgContent.push(
    <line key="subj" x1={subjectX} y1={PAD_TOP - 10} x2={subjectX} y2={H - PAD_BOT}
      stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="4 4"/>
  );
  svgContent.push(
    <text key="subj-lbl" x={subjectX} y={PAD_TOP - 14}
      textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.35)"
      fontFamily="'DM Mono', monospace">subject</text>
  );

  // DoF bars + labels
  results.forEach((r, i) => {
    const cy = rowYs[i];
    const nearX = Math.max(PAD_L, mmToX(r.Dn));
    const farX = Math.min(W - PAD_R, mmToX(Math.min(r.Df, rangeMax + span * 0.1)));
    const isRef = r.id === referenceSensorId;
    const barH = isRef ? 20 : 14;
    const col = r.color;
    const barW = Math.max(4, farX - nearX);

    svgContent.push(
      <g key={`dof-${r.id}`}>
        {/* Track */}
        <line x1={PAD_L} y1={cy} x2={W - PAD_R} y2={cy}
          stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
        {/* DoF fill */}
        <rect x={nearX} y={cy - barH/2} width={barW} height={barH} rx="3"
          fill={col} fillOpacity={isRef ? 0.22 : 0.13}/>
        <rect x={nearX} y={cy - barH/2} width={barW} height={barH} rx="3"
          fill="none" stroke={col} strokeWidth={isRef ? 1.5 : 0.75} strokeOpacity={isRef ? 0.9 : 0.55}/>
        {/* Subject dot */}
        <circle cx={subjectX} cy={cy} r={isRef ? 5 : 3.5} fill={col} fillOpacity={isRef ? 1 : 0.7}/>
        {/* Near/far tick marks */}
        <line x1={nearX} y1={cy - barH/2 - 3} x2={nearX} y2={cy + barH/2 + 3}
          stroke={col} strokeWidth={isRef ? 1.5 : 1} strokeOpacity="0.7"/>
        {isFinite(r.Df) && mmToX(r.Df) < W - PAD_R &&
          <line x1={farX} y1={cy - barH/2 - 3} x2={farX} y2={cy + barH/2 + 3}
            stroke={col} strokeWidth={isRef ? 1.5 : 1} strokeOpacity={isRef ? 0.7 : 0.55}/>}
        {/* Sensor label */}
        <text x={PAD_L - 8} y={cy + 1}
          textAnchor="end" dominantBaseline="central"
          fontSize={isRef ? 11 : 10} fontWeight={isRef ? "500" : "400"}
          fill={col} fillOpacity={isRef ? 1 : 0.75}
          fontFamily="'DM Mono', monospace">{r.short}</text>
        {/* Depth of field width label above the bar */}
        <text x={nearX + barW/2} y={cy - barH/2 - 6}
          textAnchor="middle" dominantBaseline="central"
          fontSize="9" fill={col} fillOpacity="0.85"
          fontFamily="'DM Mono', monospace">{fmtCM(r.dof)}</text>
      </g>
    );
  });

  // Framing indicator (right edge)
  const framingPx = (framingWidth / (subjectDist)) * trackW * 0.15;
  svgContent.push(
    <g key="framing">
      <line x1={W - PAD_R - 6} y1={H/2 - framingPx} x2={W - PAD_R - 6} y2={H/2 + framingPx}
        stroke="rgba(255,255,255,0.25)" strokeWidth="1.5"/>
      <line x1={W - PAD_R - 10} y1={H/2 - framingPx} x2={W - PAD_R - 2} y2={H/2 - framingPx}
        stroke="rgba(255,255,255,0.25)" strokeWidth="1"/>
      <line x1={W - PAD_R - 10} y1={H/2 + framingPx} x2={W - PAD_R - 2} y2={H/2 + framingPx}
        stroke="rgba(255,255,255,0.25)" strokeWidth="1"/>
      <text x={W - PAD_R - 14} y={H/2}
        textAnchor="end" dominantBaseline="central"
        fontSize="9" fill="rgba(255,255,255,0.3)"
        fontFamily="'DM Mono', monospace">{(framingWidth/1000).toFixed(2)}m</text>
    </g>
  );

  return (
    <svg
      ref={svgRef}
      className="diagram-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {svgContent}
    </svg>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [refSensorId, setRefSensorId] = useState('ff');
  const [apIdx, setApIdx] = useState(APERTURES.indexOf(2.8));
  const [subjectDist, setSubjectDist] = useState(3000); // mm
  const [framingWidth, setFramingWidth] = useState(1000); // mm

  const refSensor = SENSORS.find(s => s.id === refSensorId);
  const refSensorDiag = Math.sqrt(refSensor.w * refSensor.w + refSensor.h * refSensor.h);
  const derivedRefFL = (refSensorDiag * subjectDist) / framingWidth;

  const FL_VALUES = useMemo(() => {
    const vals = [];
    for (let f = 8; f <= 1000; f++) vals.push(f);
    return vals;
  }, []);

  const clampedFL = Math.max(FL_VALUES[0], Math.min(FL_VALUES[FL_VALUES.length-1], Math.round(derivedRefFL)));

  function onFLSlider(val) {
    const newFraming = (refSensor.w * subjectDist) / val;
    setFramingWidth(newFraming);
  }

  const aperture = APERTURES[apIdx];

  const results = useMemo(() => {
    return SENSORS.map(s => {
      const fl = (Math.sqrt(s.w * s.w + s.h * s.h) * subjectDist) / framingWidth;
      const dofResult = calcDoF(fl, aperture, s.coc, subjectDist);
      return { ...s, fl, ...dofResult };
    });
  }, [subjectDist, framingWidth, aperture]);

  const refResult = results.find(r => r.id === refSensorId);

  return (
    <div className="app">
      {/* ── Top bar ── */}
      <header className="topbar">
        <span className="topbar-title">DOF / CALCULATOR</span>
        <div className="topbar-divider"/>
        <span className="topbar-label">dist {fmtM(subjectDist)}</span>
        <span className="topbar-label">framing {(framingWidth/1000).toFixed(2)} m</span>
        <span className="topbar-label">f/{aperture}</span>
        <span className="topbar-label">{refSensor.name} · {clampedFL.toFixed(0)} mm</span>
      </header>

      {/* ── Sidebar ── */}
      <aside className="sidebar">

        {/* Sensor select */}
        <div className="section">
          <div className="section-head">Reference sensor</div>
          <div className="sensor-grid">
            {SENSORS.map(s => (
              <button key={s.id}
                className={`sensor-btn ${s.id === refSensorId ? 'active' : ''}`}
                onClick={() => setRefSensorId(s.id)}
                style={s.id === refSensorId ? { borderColor: s.color, color: s.color, background: s.color+'18' } : {}}
              >
                <div className="sensor-btn-name">{s.name}</div>
                <div className="sensor-btn-dim">{s.w}×{s.h}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Focal length for reference sensor */}
        <div className="section">
          <div className="section-head">Focal length</div>
          <div className="slider-wrap">
            <LogSlider
              min={8}
              max={600}
              value={clampedFL}
              onChange={onFLSlider}
              label={refSensor.name}
            />
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, fontFamily: 'var(--mono)' }}>
            Changes framing width proportionally
          </div>
        </div>

        {/* Aperture */}
        <div className="section">
          <div className="section-head">Aperture</div>
          <SteppedSlider
            values={APERTURES}
            value={aperture}
            onChange={v => setApIdx(APERTURES.indexOf(v))}
            label="f-stop"
            formatVal={v => `f/${v}`}
          />
        </div>

        {/* Subject distance */}
        <div className="section">
          <div className="section-head">Subject distance</div>
          <div className="slider-wrap">
            <LogSlider
              min={100}
              max={20000}
              value={subjectDist}
              onChange={setSubjectDist}
              label="Distance"
            />
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, fontFamily: 'var(--mono)' }}>
            Also: drag horizontally in the focus zone
          </div>
        </div>

        {/* Framing width */}
        <div className="section">
          <div className="section-head">Framing width</div>
          <div className="slider-wrap">
            <LogSlider
              min={100}
              max={10000}
              value={framingWidth}
              onChange={setFramingWidth}
              label="Width"
            />
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, fontFamily: 'var(--mono)' }}>
            Also: drag vertical in the focus zone
          </div>
        </div>

        {/* Equivalent FL list removed */}

      </aside>

      {/* ── Main area ── */}
      <main className="main">

        {/* Metrics for reference sensor */}
        <div className="metric-strip">
          {[
            { label: 'Total DoF', val: fmtCM(refResult.dof), sub: refResult.id === refSensorId ? refSensor.name : '' },
            { label: 'In front', val: fmtCM(refResult.inFront), sub: 'near → subject' },
            { label: 'Behind', val: fmtCM(refResult.behind), sub: 'subject → far' },
          ].map((m, i) => (
            <div key={i} className="metric-card">
              <div className="metric-accent" style={{ background: refSensor.color }}/>
              <div className="metric-card-label">{m.label}</div>
              <div className="metric-row">
                <span className="metric-val" style={{ color: refSensor.color }}>{m.val}</span>
                {m.sub && <span className="metric-sub">{m.sub}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Per-sensor DoF comparison row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
          {results.map(r => (
            <div key={r.id} style={{
              padding: '10px 14px',
              borderRight: '1px solid var(--line)',
              background: r.id === refSensorId ? r.color + '0d' : 'transparent',
            }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: r.color, letterSpacing: '0.08em', marginBottom: 3 }}>{r.short}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: r.color }}>{fmtCM(r.dof)}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{r.fl.toFixed(0)}mm</div>
            </div>
          ))}
        </div>

        {/* Focus zone diagram */}
        <div className="diagram-area">
          <FocusZone
            results={results}
            subjectDist={subjectDist}
            framingWidth={framingWidth}
            onDistChange={setSubjectDist}
            onFramingChange={setFramingWidth}
            referenceSensorId={refSensorId}
          />
          <div className="hint-bar">
            <span className="hint-item" data-icon="↔">drag horizontal — subject distance</span>
            <span className="hint-item" data-icon="↕">drag vertical — framing width</span>
          </div>
        </div>

      </main>
    </div>
  );
}
