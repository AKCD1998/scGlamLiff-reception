import "./LoadingOverlay.css";

export default function LoadingOverlay({
  open,
  label = "กำลังโหลดข้อมูล...",
  subtext = "โปรดรอสักครู่",
  className = "",
}) {
  const overlayClassName = [
    "loading-overlay",
    open ? "is-open" : "is-closed",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={overlayClassName}
      role={open ? "status" : undefined}
      aria-live={open ? "polite" : undefined}
      aria-hidden={open ? undefined : "true"}
    >
      <div className="loading-overlay-card">
        <div className="loading-overlay-spinner" aria-hidden="true" />
        <div className="loading-overlay-label">{label}</div>
        {subtext ? <div className="loading-overlay-subtext">{subtext}</div> : null}
      </div>
    </div>
  );
}
