import { useId, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Engineering-style line drawings shown when a product has no photo. Drawn, not stock imagery:
 * an elevation of the item with its centre line and dimension marks on grid paper.
 */
export type DrawingKind =
  | "pipe"
  | "socket-pipe"
  | "elbow"
  | "elbow-45"
  | "tee"
  | "coupler"
  | "valve"
  | "trap"
  | "tank"
  | "can"
  | "tin"
  | "tap"
  | "pillar"
  | "mixer"
  | "angle"
  | "hose"
  | "box";

/**
 * A 45° elbow or bend: "Elbow 45°", "Bend 45° Plain", "45 degree bend", "Bend 45". Not a 45 mm size,
 * and not 45 inside another number or a model code ("87.5°", "AC-45").
 */
const DEG_45 = /(?<![\d.-])45\s*(?:°|º|˚|-?\s*deg)|\b(?:elbow|bend)\s+45\b(?!\s*mm)/;

/** Pick a drawing from the product name, falling back to its category icon. */
export function drawingKind(name: string, icon: string | null | undefined): DrawingKind {
  const n = name.toLowerCase();
  if (icon === "tank" || /\btank\b/.test(n)) return "tank";
  if (/solvent|cement/.test(n)) return "tin";
  if (/hose|connection pipe/.test(n)) return "hose";
  if (/valve/.test(n) && !/angle|angular/.test(n)) return "valve";
  if (/(angle|angular)( stop)? (cock|valve)/.test(n)) return "angle";
  if (/pillar|deck|basin mixer|single lever/.test(n)) return "pillar";
  if (/mixer/.test(n)) return "mixer";
  if (/cock|faucet|\btap\b|spout|shower/.test(n)) return "tap";
  if (/\btrap\b/.test(n)) return "trap";
  if (/elbow|\bbend\b/.test(n)) return DEG_45.test(n) ? "elbow-45" : "elbow";
  if (/\btee\b|single y/.test(n)) return "tee";
  if (/coupler|union|reducer|adapt|\bcap\b|socket|\b(fta|mta|fabt|mabt)\b|nipple/.test(n)) return "coupler";
  if (/\bpipe\b/.test(n)) return icon === "drain" ? "socket-pipe" : "pipe";
  if (icon === "paint" || /paint|emulsion|distemper|primer|putty|enamel/.test(n)) return "can";
  if (icon === "bath") return "tap";
  if (icon === "pipe") return "pipe";
  if (icon === "drain") return "socket-pipe";
  return "box";
}

/* Stroke helpers ---------------------------------------------------- */

/** A drawn stroke (draws in when the figure has `animate`; stagger comes from CSS nth-child). */
function D({ d, gold, thin }: { d: string; gold?: boolean; thin?: boolean }) {
  return <path d={d} pathLength={1} data-draw="" className={gold ? "text-gold-500" : undefined} stroke="currentColor" strokeWidth={thin ? 1 : 1.6} />;
}
function E({ cx, cy, rx, ry, thin, angle }: { cx: number; cy: number; rx: number; ry: number; thin?: boolean; angle?: number }) {
  return (
    <ellipse
      cx={cx}
      cy={cy}
      rx={rx}
      ry={ry}
      transform={angle ? `rotate(${angle} ${cx} ${cy})` : undefined}
      pathLength={1}
      data-draw=""
      strokeWidth={thin ? 1 : 1.6}
    />
  );
}
/** Hidden edge (dashed) — not animated. */
function Hidden({ d }: { d: string }) {
  return <path d={d} strokeWidth={0.9} strokeDasharray="3 3" className="text-navy-300" stroke="currentColor" />;
}
/** Centre line (long dash, dot). */
function Centre({ d }: { d: string }) {
  return <path d={d} strokeWidth={0.8} strokeDasharray="10 3 2 3" className="text-navy-300" stroke="currentColor" />;
}
/** Dimension with extension lines, arrows and a mono label. */
function Dim({ x1, y1, x2, y2, label, side = "below", marker }: { x1: number; y1: number; x2: number; y2: number; label: string; side?: "below" | "left"; marker: string }) {
  const vertical = x1 === x2;
  const tx = vertical ? x1 - 7 : (x1 + x2) / 2;
  const ty = vertical ? (y1 + y2) / 2 + 3 : y1 + (side === "below" ? 11 : -5);
  return (
    <g className="text-navy-400" stroke="currentColor" strokeWidth={0.8}>
      <path d={`M${x1} ${y1} L${x2} ${y2}`} markerStart={`url(#${marker})`} markerEnd={`url(#${marker})`} />
      <text x={tx} y={ty} textAnchor={vertical ? "end" : "middle"} className="fill-current tabular" stroke="none" fontSize={9} letterSpacing={0.5}>
        {label}
      </text>
    </g>
  );
}

function shapes(kind: DrawingKind, marker: string): ReactNode {
  switch (kind) {
    case "pipe":
    case "socket-pipe": {
      const socket = kind === "socket-pipe";
      const end = socket ? 182 : 196;
      return (
        <>
          <Centre d="M26 90 H214" />
          <D d={`M42 70 H${end}`} />
          <D d={`M42 110 H${end}`} />
          <D d="M42 70 A8 20 0 0 0 42 110" />
          <Hidden d="M42 70 A8 20 0 0 1 42 110" />
          {socket ? (
            <>
              <D d="M182 70 L192 63 M182 110 L192 117" />
              <D d="M192 63 H204 M192 117 H204" />
              <E cx={204} cy={90} rx={9} ry={27} />
              <E cx={204} cy={90} rx={6} ry={20} thin />
            </>
          ) : (
            <>
              <E cx={196} cy={90} rx={8} ry={20} />
              <E cx={196} cy={90} rx={5} ry={13} thin />
            </>
          )}
          <D d={`M46 77 H${end - 4}`} gold thin />
          <path d="M42 116 V140 M196 116 V140" className="text-navy-300" stroke="currentColor" strokeWidth={0.6} />
          <Dim x1={46} y1={134} x2={192} y2={134} label="L" marker={marker} />
          <Dim x1={22} y1={72} x2={22} y2={108} label="Ø" side="left" marker={marker} />
        </>
      );
    }
    case "elbow":
      return (
        <>
          <Centre d="M30 118 H96 A58 58 0 0 0 154 60 V20" />
          <D d="M44 100 H96 A40 40 0 0 0 136 60 V30" />
          <D d="M44 136 H96 A76 76 0 0 0 172 60 V30" />
          <D d="M62 96 V140 M132 46 H176" thin />
          <E cx={44} cy={118} rx={6} ry={18} />
          <E cx={154} cy={30} rx={18} ry={6} />
          <path d="M108 112 A16 16 0 0 0 124 96" className="text-gold-500" stroke="currentColor" strokeWidth={1} />
          <text x={128} y={118} className="fill-current tabular text-navy-400" stroke="none" fontSize={9}>
            90°
          </text>
        </>
      );
    case "elbow-45":
      // The same pipe and bend radius as the 90° elbow (bend centre 96,60; centre line r58), turned
      // through 45° only. The angle is marked from the run of the inlet, through the vertex at 120,118.
      return (
        <>
          <Centre d="M30 118 H96 A58 58 0 0 0 137.01 101.01 L196.41 41.62 M120.02 118 H178" />
          <D d="M44 100 H96 A40 40 0 0 0 124.28 88.28 L175.2 37.37" />
          <D d="M44 136 H96 A76 76 0 0 0 149.74 113.74 L200.65 62.83" />
          <D d="M62 96 V140 M161.05 45.86 L192.17 76.97" thin />
          <E cx={44} cy={118} rx={6} ry={18} />
          <E cx={187.92} cy={50.1} rx={18} ry={6} angle={45} />
          <path d="M160.02 118 A40 40 0 0 0 148.31 89.72" className="text-gold-500" stroke="currentColor" strokeWidth={1} />
          <text x={170} y={109} className="fill-current tabular text-navy-400" stroke="none" fontSize={9}>
            45°
          </text>
        </>
      );
    case "tee":
      return (
        <>
          <Centre d="M26 114 H214 M120 26 V114" />
          <D d="M44 96 H102 V40 M138 40 V96 H196" />
          <D d="M44 132 H196" />
          <D d="M62 92 V136 M178 92 V136 M98 56 H142" thin />
          <E cx={44} cy={114} rx={6} ry={18} />
          <E cx={196} cy={114} rx={6} ry={18} />
          <E cx={120} cy={40} rx={18} ry={6} />
        </>
      );
    case "coupler":
      return (
        <>
          <Centre d="M40 90 H200" />
          <D d="M72 64 H104 V70 H136 V64 H168" />
          <D d="M72 116 H104 V110 H136 V116 H168" />
          <D d="M72 64 A7 26 0 0 0 72 116" />
          <E cx={168} cy={90} rx={7} ry={26} />
          <E cx={168} cy={90} rx={4.5} ry={18} thin />
          <D d="M150 64 L146 116 M158 64 L154 116" thin gold />
          <Dim x1={72} y1={136} x2={168} y2={136} label="L" marker={marker} />
        </>
      );
    case "valve":
      return (
        <>
          <Centre d="M34 108 H206" />
          <D d="M52 92 H94 M146 92 H188 M52 124 H94 M146 124 H188" />
          <D d="M52 92 A6 16 0 0 0 52 124" />
          <E cx={188} cy={108} rx={6} ry={16} />
          <circle cx={120} cy={108} r={28} pathLength={1} data-draw="" strokeWidth={1.6} />
          <D d="M114 80 V58 M126 80 V58" />
          <D d="M106 50 H192 V60 H106 Z" />
          <circle cx={120} cy={108} r={11} className="text-gold-500" stroke="currentColor" strokeWidth={1} />
        </>
      );
    case "trap":
      return (
        <>
          <D d="M60 30 V112 A48 48 0 0 0 156 112 V102 H204" />
          <D d="M92 30 V112 A16 16 0 0 0 124 112 V70 H204" />
          <E cx={76} cy={30} rx={16} ry={5} />
          <E cx={204} cy={86} rx={5} ry={16} />
          <path d="M64 100 H88 M128 100 H152" className="text-sky-400" stroke="currentColor" strokeWidth={1} strokeDasharray="4 3" />
          <Centre d="M76 20 V112 A32 32 0 0 0 140 112 V86 H214" />
        </>
      );
    case "tank":
      return (
        <>
          <Centre d="M120 14 V166" />
          <D d="M66 58 V150 M174 58 V150" />
          <D d="M66 58 Q120 22 174 58" />
          <D d="M66 150 A54 10 0 0 0 174 150" />
          <D d="M66 88 A54 9 0 0 0 174 88 M66 119 A54 9 0 0 0 174 119" thin />
          <E cx={120} cy={32} rx={16} ry={4.5} />
          <D d="M104 32 V40 M136 32 V40" thin />
          <D d="M174 70 H192 M174 78 H192" />
          <E cx={192} cy={74} rx={2} ry={4} thin />
          <Dim x1={44} y1={30} x2={44} y2={150} label="H" side="left" marker={marker} />
        </>
      );
    case "can":
      return (
        <>
          <D d="M76 64 C76 14 164 14 164 64" thin />
          <D d="M76 62 V146 M164 62 V146" />
          <E cx={120} cy={62} rx={44} ry={10} />
          <E cx={120} cy={62} rx={38} ry={7.5} thin />
          <D d="M76 146 A44 10 0 0 0 164 146" />
          <D d="M76 92 A44 10 0 0 0 164 92 M76 124 A44 10 0 0 0 164 124" thin />
          <path d="M96 108 H144" className="text-gold-500" stroke="currentColor" strokeWidth={1.2} />
          <Dim x1={54} y1={56} x2={54} y2={150} label="H" side="left" marker={marker} />
        </>
      );
    case "tin":
      return (
        <>
          <D d="M88 82 V148 M152 82 V148" />
          <E cx={120} cy={82} rx={32} ry={7} />
          <D d="M88 148 A32 7 0 0 0 152 148" />
          <D d="M106 60 V80 M134 60 V80" />
          <E cx={120} cy={60} rx={14} ry={3.5} />
          <D d="M88 104 A32 7 0 0 0 152 104 M88 128 A32 7 0 0 0 152 128" thin />
          <path d="M104 116 H136" className="text-gold-500" stroke="currentColor" strokeWidth={1.2} />
        </>
      );
    case "tap":
      return (
        <>
          <D d="M40 66 H50 V114 H40 Z" />
          <D d="M50 84 H78 M50 96 H78" />
          <D d="M78 74 H128 A10 10 0 0 1 138 84 V96 A10 10 0 0 1 128 106 H78 Z" />
          <D d="M138 84 H174 A14 14 0 0 1 188 98 V124 M138 96 H168 A8 8 0 0 1 176 104 V124 M174 124 H190" />
          <D d="M102 74 V56 M110 74 V56" />
          <D d="M84 46 H128 A4 4 0 0 1 128 54 H84 A4 4 0 0 1 84 46 Z" />
          <path d="M182 132 V160" className="text-sky-400" stroke="currentColor" strokeWidth={1.2} strokeDasharray="4 4" />
          <path d="M56 90 H74" className="text-gold-500" stroke="currentColor" strokeWidth={1} />
        </>
      );
    case "pillar":
      return (
        <>
          <path d="M44 150 H196 M52 150 l-8 10 M68 150 l-8 10 M84 150 l-8 10 M156 150 l-8 10 M172 150 l-8 10 M188 150 l-8 10" className="text-navy-300" stroke="currentColor" strokeWidth={0.8} />
          <D d="M96 140 H144 V150 H96 Z" />
          <D d="M108 140 V76 M132 140 V76" />
          <D d="M132 86 H166 A14 14 0 0 1 180 100 V116 M132 98 H162 A6 6 0 0 1 168 104 V116 M166 116 H182" />
          <D d="M114 76 V64 M126 76 V64" />
          <D d="M94 52 H146 A4 4 0 0 1 146 64 H94 A4 4 0 0 1 94 52 Z" />
          <path d="M175 122 V146" className="text-sky-400" stroke="currentColor" strokeWidth={1.2} strokeDasharray="4 4" />
          <path d="M108 120 H132" className="text-gold-500" stroke="currentColor" strokeWidth={1} />
          <Centre d="M120 40 V160" />
        </>
      );
    case "mixer":
      return (
        <>
          <path d="M30 40 V140" className="text-navy-300" stroke="currentColor" strokeWidth={0.8} strokeDasharray="3 3" />
          <D d="M56 80 H104 M136 80 H184 M56 96 H104 M136 96 H184" />
          <E cx={56} cy={88} rx={4} ry={8} />
          <E cx={184} cy={88} rx={4} ry={8} />
          <D d="M104 70 H136 A4 4 0 0 1 140 74 V102 A4 4 0 0 1 136 106 H104 A4 4 0 0 1 100 102 V74 A4 4 0 0 1 104 70 Z" />
          <D d="M72 80 V66 M80 80 V66 M160 80 V66 M168 80 V66" />
          <D d="M62 56 H90 V66 H62 Z M150 56 H178 V66 H150 Z" />
          <D d="M116 70 V56 M124 70 V56 M112 50 H128 V56 H112 Z" thin />
          <D d="M112 106 V132 M128 106 V132" />
          <E cx={120} cy={132} rx={8} ry={2.5} />
          <path d="M120 138 V162" className="text-sky-400" stroke="currentColor" strokeWidth={1.2} strokeDasharray="4 4" />
          <path d="M66 61 H86" className="text-red-400" stroke="currentColor" strokeWidth={1} />
          <path d="M154 61 H174" className="text-sky-400" stroke="currentColor" strokeWidth={1} />
        </>
      );
    case "angle":
      return (
        <>
          <D d="M40 66 H48 V114 H40 Z" />
          <D d="M48 84 H80 M48 96 H80" />
          <D d="M80 76 H120 A8 8 0 0 1 128 84 V100 A8 8 0 0 1 120 108 H80 Z" />
          <D d="M94 108 V142 M114 108 V142" />
          <D d="M94 124 H114 M94 130 H114" thin />
          <E cx={104} cy={142} rx={10} ry={3} />
          <D d="M100 76 V60 M108 76 V60" />
          <D d="M86 50 H122 L116 60 H92 Z" />
          <path d="M136 112 A20 20 0 0 1 116 132" className="text-gold-500" stroke="currentColor" strokeWidth={1} />
          <text x={140} y={132} className="fill-current tabular text-navy-400" stroke="none" fontSize={9}>
            90°
          </text>
          <Centre d="M30 90 H104 V160" />
        </>
      );
    case "hose":
      return (
        <>
          <D d="M58 98 C96 30 140 150 182 82" />
          <D d="M58 112 C98 46 142 166 182 96" />
          <D d="M34 94 H58 V116 H34 Z M182 78 H206 V100 H182 Z" />
          <D d="M40 94 V116 M46 94 V116 M188 78 V100 M194 78 V100" thin />
        </>
      );
    default:
      return (
        <>
          <D d="M120 40 L180 70 L120 100 L60 70 Z" />
          <D d="M60 70 V128 L120 158 L180 128 V70 M120 100 V158" />
          <path d="M90 55 L150 85" className="text-gold-500" stroke="currentColor" strokeWidth={1} />
        </>
      );
  }
}

export function TechnicalDrawing({
  kind,
  className,
  animate,
  title,
}: {
  kind: DrawingKind;
  className?: string;
  /** Strokes draw in once when the figure first appears. */
  animate?: boolean;
  /** Accessible description; omit for purely decorative use. */
  title?: string;
}) {
  const marker = `arr${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      viewBox="0 0 240 180"
      className={cn("text-navy-800", animate && "drawing", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <marker id={marker} viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 1 L7 4 L0 7" fill="none" stroke="currentColor" strokeWidth="1" />
        </marker>
      </defs>
      <g stroke="currentColor">{shapes(kind, marker)}</g>
    </svg>
  );
}
