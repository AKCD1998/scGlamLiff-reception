import "./LoadingOverlay.css";

export default function LoadingOverlay({
  open,
  label = "กำลังโหลดข้อมูล...",
  subtext = "โปรดรอสักครู่",
  className = "",
}) {
  if (!open) return null;

  const overlayClassName = ["loading-overlay", className].filter(Boolean).join(" ");

  return (
    <div className={overlayClassName} role="status" aria-live="polite">
      <div className="loading-overlay-card">
        <div className="loading-overlay-spinner" aria-hidden="true" />
        <div className="loading-overlay-label">{label}</div>
        {subtext ? <div className="loading-overlay-subtext">{subtext}</div> : null}
      </div>
    </div>
  );
}
