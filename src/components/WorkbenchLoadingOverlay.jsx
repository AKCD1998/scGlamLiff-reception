export default function WorkbenchLoadingOverlay({ open, text = "กำลังโหลดข้อมูล..."}) {
  if (!open) return null;

  return (
    <div className="workbench-loading-overlay" role="status" aria-live="polite">
      <div className="workbench-loading-card">
        <div className="workbench-loading-spinner" aria-hidden="true" />
        <div className="workbench-loading-text">{text}</div>
      </div>
    </div>
  );
}