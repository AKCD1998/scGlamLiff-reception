export default function StatusOverlay({ open, mode, onClose }) {
  if (!open) return null;

  return (
    <div className="status-overlay" role="dialog" aria-modal="true">
      <div className="status-card">
        {mode === "loading" ? (
          <>
            <div className="status-spinner" aria-hidden="true" />
            <div className="status-message">กำลังส่งข้อมูล...</div>
          </>
        ) : (
          <>
            <div className={`status-icon ${mode === "success" ? "success" : "error"}`}>
              {mode === "success" ? (
                <svg className="status-svg" viewBox="0 0 52 52" aria-hidden="true">
                  <circle className="status-circle" cx="26" cy="26" r="24" fill="none" />
                  <path
                    className="status-check"
                    fill="none"
                    d="M14 27l7 7 17-17"
                  />
                </svg>
              ) : (
                <svg className="status-svg" viewBox="0 0 52 52" aria-hidden="true">
                  <circle className="status-circle" cx="26" cy="26" r="24" fill="none" />
                  <path
                    className="status-cross"
                    fill="none"
                    d="M17 17l18 18M35 17L17 35"
                  />
                </svg>
              )}
            </div>
            <div className="status-message">
              {mode === "success" ? (
                <>
                  บันทึกการจองเรียบร้อย
                  <br />
                  ระบบกำลังพากลับไปหน้า Workbench
                </>
              ) : (
                <>บันทึกไม่สำเร็จ กรุณาลองใหม่</>
              )}
            </div>
            <button className="status-button" type="button" onClick={onClose}>
              ปิด
            </button>
          </>
        )}
      </div>
    </div>
  );
}

