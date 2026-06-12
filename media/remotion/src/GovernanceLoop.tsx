import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export const FPS = 30;
export const LOOP_DURATION_FRAMES = 22 * FPS; // 22s

// DashClaw tokens (app/globals.css)
const T = {
  bg: '#0e1014',
  surface2: '#15171c',
  surface3: '#1d2026',
  elevated: '#272b32',
  border: 'rgba(255,255,255,0.08)',
  borderHover: 'rgba(255,255,255,0.16)',
  textPrimary: '#fafafa',
  textSecondary: '#c2c2cc',
  textTertiary: '#9b9ba8',
  brand: '#f97316',
  brandSubtle: 'rgba(249,115,22,0.12)',
  success: '#22c55e',
  successSubtle: 'rgba(34,197,94,0.12)',
  error: '#ef4444',
  warning: '#eab308',
};

const SANS = 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

// Scene boundaries (frames)
const S1 = { start: 0, end: 105 }; // intent
const S2 = { start: 95, end: 250 }; // guard
const S3 = { start: 240, end: 395 }; // approval
const S4 = { start: 385, end: 545 }; // ledger
const S5 = { start: 535, end: LOOP_DURATION_FRAMES }; // lockup

const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

function sceneOpacity(frame: number, s: { start: number; end: number }, fadeIn = 12, fadeOut = 12) {
  return interpolate(
    frame,
    [s.start, s.start + fadeIn, s.end - fadeOut, s.end],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}

const MetaLabel: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <div
    style={{
      fontFamily: MONO,
      fontSize: 12,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      color: color ?? T.textTertiary,
    }}
  >
    {children}
  </div>
);

const Card: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => (
  <div
    style={{
      background: T.surface2,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      padding: 28,
      boxShadow: '0 0 0 1px rgba(255,255,255,0.03), 0 30px 90px rgba(0,0,0,0.55)',
      ...style,
    }}
  >
    {children}
  </div>
);

const Chip: React.FC<{ label: string; tone: 'brand' | 'success' | 'neutral' | 'error' }> = ({ label, tone }) => {
  const tones = {
    brand: { bg: T.brandSubtle, fg: T.brand, bd: 'rgba(249,115,22,0.3)' },
    success: { bg: T.successSubtle, fg: T.success, bd: 'rgba(34,197,94,0.3)' },
    error: { bg: 'rgba(239,68,68,0.12)', fg: T.error, bd: 'rgba(239,68,68,0.3)' },
    neutral: { bg: T.surface3, fg: T.textSecondary, bd: T.border },
  } as const;
  const c = tones[tone];
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 13,
        padding: '4px 10px',
        borderRadius: 6,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
};

// ---------- Scene 1: intent ----------
const IntentScene: React.FC<{ frame: number }> = ({ frame }) => {
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - S1.start, fps, config: { damping: 200 }, durationInFrames: 24 });
  const cmd = 'deploy --target prod --version 2.13.4';
  const typed = cmd.slice(0, Math.round(interpolate(frame, [S1.start + 18, S1.start + 70], [0, cmd.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
  const caret = Math.floor(frame / 16) % 2 === 0;
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: sceneOpacity(frame, S1) }}>
      <div style={{ width: 620, transform: `translateY(${(1 - enter) * 28}px)` }}>
        <MetaLabel>incoming agent intent</MetaLabel>
        <Card style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: T.success, display: 'inline-block' }} />
            <span style={{ fontFamily: MONO, fontSize: 15, color: T.textSecondary }}>deploy-bot</span>
            <Chip label="irreversible" tone="error" />
            <Chip label="prod" tone="neutral" />
          </div>
          <div style={{ fontFamily: MONO, fontSize: 21, color: T.textPrimary }}>
            <span style={{ color: T.textTertiary }}>$ </span>
            {typed}
            <span style={{ opacity: caret ? 1 : 0, color: T.brand }}>▍</span>
          </div>
        </Card>
        <div style={{ marginTop: 16, fontFamily: SANS, fontSize: 16, color: T.textTertiary }}>
          An agent is about to touch a real system.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 2: guard ----------
const GuardScene: React.FC<{ frame: number }> = ({ frame }) => {
  const local = frame - S2.start;
  const risk = Math.round(interpolate(local, [22, 70], [0, 80], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutQuint }));
  const checks = [
    { at: 26, name: 'Deploy Gate', detail: 'matched · prod target' },
    { at: 46, name: 'Risk Threshold', detail: '80 ≥ 70 · hold' },
    { at: 66, name: 'Injection scan', detail: 'clean' },
  ];
  const verdictIn = interpolate(local, [92, 108], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutQuint });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: sceneOpacity(frame, S2) }}>
      <div style={{ width: 760 }}>
        <MetaLabel color={T.brand}>guard · policy evaluation before execution</MetaLabel>
        <div style={{ display: 'flex', gap: 20, marginTop: 14, alignItems: 'stretch' }}>
          <Card style={{ flex: 1.15 }}>
            {checks.map((c) => {
              const on = interpolate(local, [c.at, c.at + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              return (
                <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '11px 0', borderBottom: `1px solid ${T.border}`, opacity: on, transform: `translateX(${(1 - on) * 14}px)` }}>
                  <span style={{ fontFamily: SANS, fontSize: 17, color: T.textPrimary }}>{c.name}</span>
                  <span style={{ fontFamily: MONO, fontSize: 13, color: T.textTertiary }}>{c.detail}</span>
                </div>
              );
            })}
            <div style={{ paddingTop: 16, opacity: verdictIn, transform: `translateY(${(1 - verdictIn) * 10}px)` }}>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 16,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: T.brand,
                  background: T.brandSubtle,
                  border: '1px solid rgba(249,115,22,0.35)',
                  borderRadius: 8,
                  padding: '8px 14px',
                }}
              >
                require_approval
              </span>
            </div>
          </Card>
          <Card style={{ width: 240, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: T.surface3 }}>
            <MetaLabel>risk score</MetaLabel>
            <div style={{ fontFamily: SANS, fontVariantNumeric: 'tabular-nums', fontSize: 84, fontWeight: 650, color: risk >= 70 ? T.brand : T.textPrimary, lineHeight: 1.1 }}>
              {risk}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: T.textTertiary }}>/ 100</div>
          </Card>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 3: approval ----------
const ApprovalScene: React.FC<{ frame: number }> = ({ frame }) => {
  const local = frame - S3.start;
  const pressAt = 72;
  const approved = local >= pressAt + 10;
  const press = interpolate(local, [pressAt, pressAt + 6, pressAt + 10], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const flip = interpolate(local, [pressAt + 8, pressAt + 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutQuint });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: sceneOpacity(frame, S3) }}>
      <div style={{ width: 560 }}>
        <MetaLabel>held for a human · same queue on every surface</MetaLabel>
        <Card style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontFamily: SANS, fontSize: 19, fontWeight: 600, color: T.textPrimary }}>
              Ship release 2.13.4 to production
            </span>
            <Chip label="risk 80" tone="brand" />
          </div>
          <div style={{ fontFamily: MONO, fontSize: 14, color: T.textTertiary, marginBottom: 22 }}>
            deploy-bot · deploy · matched: Deploy Gate, Risk Threshold
          </div>
          {!approved ? (
            <div style={{ display: 'flex', gap: 12 }}>
              <div
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontFamily: SANS,
                  fontSize: 17,
                  fontWeight: 600,
                  padding: '13px 0',
                  borderRadius: 9,
                  color: T.error,
                  background: 'rgba(239,68,68,0.10)',
                  border: '1px solid rgba(239,68,68,0.3)',
                }}
              >
                Deny
              </div>
              <div
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontFamily: SANS,
                  fontSize: 17,
                  fontWeight: 600,
                  padding: '13px 0',
                  borderRadius: 9,
                  color: '#0e1014',
                  background: T.success,
                  transform: `scale(${1 - press * 0.05})`,
                  boxShadow: press > 0 ? `0 0 0 ${press * 6}px rgba(34,197,94,0.25)` : 'none',
                }}
              >
                Approve
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                padding: '13px 16px',
                borderRadius: 9,
                background: T.successSubtle,
                border: '1px solid rgba(34,197,94,0.3)',
                opacity: flip,
                transform: `translateY(${(1 - flip) * 8}px)`,
              }}
            >
              <span style={{ color: T.success, fontSize: 18 }}>✓</span>
              <span style={{ fontFamily: SANS, fontSize: 16, color: T.textPrimary }}>Approved by operator</span>
              <span style={{ fontFamily: MONO, fontSize: 13, color: T.textTertiary, marginLeft: 'auto' }}>unblocks in ~1s</span>
            </div>
          )}
        </Card>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 4: ledger ----------
const LedgerScene: React.FC<{ frame: number }> = ({ frame }) => {
  const local = frame - S4.start;
  const rows = [
    { at: 14, k: 'declared goal', v: 'Ship release 2.13.4 to production' },
    { at: 30, k: 'risk · decision', v: '80 · require_approval → approved' },
    { at: 46, k: 'assumption', v: 'Tests passed on the candidate commit ✓' },
    { at: 62, k: 'evidence', v: 'policies, reasoning, signals · replayable' },
  ];
  const done = interpolate(local, [88, 104], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutQuint });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: sceneOpacity(frame, S4) }}>
      <div style={{ width: 640 }}>
        <MetaLabel>decision record · written, durable, replayable</MetaLabel>
        <Card style={{ marginTop: 14 }}>
          {rows.map((r) => {
            const on = interpolate(local, [r.at, r.at + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <div key={r.k} style={{ display: 'flex', gap: 18, padding: '10px 0', borderBottom: `1px solid ${T.border}`, opacity: on, transform: `translateX(${(1 - on) * 12}px)` }}>
                <span style={{ fontFamily: MONO, fontSize: 13, color: T.textTertiary, width: 150, textTransform: 'uppercase', letterSpacing: '0.08em', paddingTop: 3 }}>{r.k}</span>
                <span style={{ fontFamily: SANS, fontSize: 16.5, color: T.textSecondary, flex: 1 }}>{r.v}</span>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: 16, opacity: done }}>
            <Chip label="outcome: completed" tone="success" />
            <span style={{ fontFamily: SANS, fontSize: 14.5, color: T.textTertiary }}>
              one-shot finality: a retried agent never double-executes
            </span>
          </div>
        </Card>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 5: lockup ----------
const LockupScene: React.FC<{ frame: number }> = ({ frame }) => {
  const { fps } = useVideoConfig();
  const local = frame - S5.start;
  const enter = spring({ frame: local, fps, config: { damping: 200 }, durationInFrames: 26 });
  const verbs = ['intercept', 'enforce', 'approve', 'record'];
  const fadeIn = interpolate(local, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: fadeIn }}>
      <div style={{ textAlign: 'center', transform: `translateY(${(1 - enter) * 18}px)` }}>
        <Img src={staticFile('logo.png')} style={{ width: 92, height: 92, borderRadius: 99, margin: '0 auto 22px' }} />
        <div style={{ fontFamily: SANS, fontSize: 46, fontWeight: 700, color: T.textPrimary, letterSpacing: '-0.02em' }}>
          DashClaw
        </div>
        <div style={{ fontFamily: SANS, fontSize: 21, color: T.textSecondary, marginTop: 10 }}>
          Govern AI agents before they act.
        </div>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 26 }}>
          {verbs.map((v, i) => {
            const on = interpolate(local, [22 + i * 8, 34 + i * 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <span key={v} style={{ fontFamily: MONO, fontSize: 14, letterSpacing: '0.14em', textTransform: 'uppercase', color: i === 0 ? T.brand : T.textTertiary, opacity: on }}>
                {v}
                {i < verbs.length - 1 ? <span style={{ color: T.textTertiary, marginLeft: 14 }}>·</span> : null}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Progress rail ----------
const Rail: React.FC<{ frame: number }> = ({ frame }) => {
  const steps = [
    { label: 'intent', s: S1 },
    { label: 'guard', s: S2 },
    { label: 'approve', s: S3 },
    { label: 'record', s: S4 },
  ];
  const visible = interpolate(frame, [0, 12, S5.start - 6, S5.start + 8], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', bottom: 30, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 26, opacity: visible }}>
      {steps.map(({ label, s }) => {
        const active = frame >= s.start + 10 && frame < s.end - 10;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: active ? T.brand : T.elevated, display: 'inline-block' }} />
            <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: active ? T.textSecondary : T.textTertiary }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
};

export const GovernanceLoop: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      {frame < S1.end && <IntentScene frame={frame} />}
      {frame >= S2.start && frame < S2.end && <GuardScene frame={frame} />}
      {frame >= S3.start && frame < S3.end && <ApprovalScene frame={frame} />}
      {frame >= S4.start && frame < S4.end && <LedgerScene frame={frame} />}
      {frame >= S5.start && <LockupScene frame={frame} />}
      <Rail frame={frame} />
    </AbsoluteFill>
  );
};
