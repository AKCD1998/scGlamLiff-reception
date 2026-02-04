import "./ProgressDots.css";

export default function ProgressDots({ total = 0, used = 0, size = "md", ariaLabel }) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeUsed = Math.min(Math.max(0, Number(used) || 0), safeTotal);
  const label = ariaLabel || `Sessions used ${safeUsed} of ${safeTotal}`;
  const sizeClass = size ? `progress-dots--${size}` : "";

  if (safeTotal === 0) {
    return (
      <div className={`progress-dots ${sizeClass}`} aria-label={label} />
    );
  }

  return (
    <div className={`progress-dots ${sizeClass}`} aria-label={label}>
      {Array.from({ length: safeTotal }).map((_, index) => (
        <span
          key={index}
          className={`progress-dots__dot${index < safeUsed ? " is-used" : ""}`}
        />
      ))}
    </div>
  );
}
