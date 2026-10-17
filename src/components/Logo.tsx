const brand1 = { fill: 'var(--brand1)' };
const accentFill = { fill: 'var(--accent)' };
const waitStroke = { stroke: 'var(--brand-wait)' };
const accentStroke = { stroke: 'var(--accent)' };

function MarkShapes() {
  return (
    <>
      <g style={brand1}>
        <circle cx="21" cy="13" r="6" />
        <rect x="14" y="22" width="14" height="34" rx="7" />
      </g>
      <g style={accentFill}>
        <circle cx="43" cy="24" r="6" />
        <rect x="36" y="33" width="14" height="23" rx="7" />
      </g>
    </>
  );
}

export function Mark({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Waitup">
      <MarkShapes />
    </svg>
  );
}

export function Lockup({ height = 36 }: { height?: number }) {
  return (
    <svg width={(height * 267) / 70} height={height} viewBox="0 0 267 70" role="img" aria-label="Waitup">
      <MarkShapes />
      <g transform="translate(66 8)">
        <g fill="none" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
          <g style={waitStroke}>
            <path d="M3.5 23.5V36A8.5 8.5 0 0 0 20.5 36V23.5V36A8.5 8.5 0 0 0 37.5 36V23.5" />
            <circle cx="64" cy="34" r="10.5" />
            <path d="M74.5 23.5V44.5" />
            <path d="M90.5 23.5V44.5" />
            <path d="M109.5 12V38A6.5 6.5 0 0 0 116 44.5H119.5M104.5 23.5H118.5" />
          </g>
          <g style={accentStroke}>
            <path d="M133.5 23.5V36A8.5 8.5 0 0 0 150.5 36V23.5V44.5" />
            <path d="M166.5 23.5V58" />
            <circle cx="177" cy="34" r="10.5" />
          </g>
        </g>
        <circle cx="90.5" cy="12" r="4.5" style={{ fill: 'var(--brand-wait)' }} />
      </g>
    </svg>
  );
}
