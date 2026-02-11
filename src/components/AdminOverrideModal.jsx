import "./AdminOverrideModal.css";

export default function AdminOverrideModal({
  open,
  violations,
  password,
  onPasswordChange,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  const canConfirm = password === "123123";

  return (
    <div className="admin-override-overlay" role="dialog" aria-modal="true">
      <div className="admin-override-card">
        <div className="admin-override-title">คำเตือนผู้ดูแลระบบ</div>
        <div className="admin-override-body">การจองนี้ฝ่าภายใต้เงื่อนไขต่อไปนี้:</div>
        <ul className="admin-override-list">
          {violations.map((violation) => (
            <li key={violation.key} className="admin-override-item">
              <div className="admin-override-item-title">{violation.titleTh}</div>
              <div className="admin-override-item-detail">{violation.detailTh}</div>
            </li>
          ))}
        </ul>

        <label className="admin-override-label" htmlFor="admin-override-password">
          รหัสผ่านผู้ดูแล (Admin)
        </label>
        <input
          id="admin-override-password"
          type="password"
          className="admin-override-input"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />

        <div className="admin-override-actions">
          <button type="button" className="admin-override-cancel" onClick={onCancel}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="admin-override-confirm"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            ยืนยันทำรายการ
          </button>
        </div>
      </div>
    </div>
  );
}

