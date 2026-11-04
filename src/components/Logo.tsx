interface LogoProps {
  size?: number;
  /** Show the STRATA wordmark next to the mark. */
  wordmark?: boolean;
  className?: string;
}

/**
 * Strata mark: three stacked plates read as geological strata — the layered
 * capital that the product schedules. Drawn rather than substituted from an
 * icon set, so the brand stays recognisable at 16px and at 40px.
 */
export function StrataMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="strata-mark-top" x1="4" y1="1" x2="28" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--strata-mark-a)" />
          <stop offset="1" stopColor="var(--strata-mark-b)" />
        </linearGradient>
      </defs>
      <path d="M6 21.4 16 15.9l10 5.5-10 5.5z" fill="url(#strata-mark-top)" opacity="0.22" />
      <path d="M6 16.4 16 10.9l10 5.5-10 5.5z" fill="url(#strata-mark-top)" opacity="0.52" />
      <path d="M9.2 11.2 16 7.4l6.8 3.8-6.8 3.8z" fill="#7FF0DE" />
    </svg>
  );
}

export function Logo({ size = 26, wordmark = true, className }: LogoProps) {
  return (
    <span className={className ? `logo ${className}` : 'logo'}>
      <StrataMark size={size} />
      {wordmark && <span className="logo-word">STRATA</span>}
    </span>
  );
}
