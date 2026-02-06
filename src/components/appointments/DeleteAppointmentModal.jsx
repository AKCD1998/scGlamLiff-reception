export default function DeleteAppointmentModal({
  open,
  target,
  pin,
  onPinChange,
  reason,
  onReasonChange,
  error,
  busy,
  onClose,
  onConfirm,
}) {
  if (!open) return null;

  return (
    <div className="delete-modal-backdrop" onClick={onClose}>
      <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
        <h3>ยืนยันการลบรายการ</h3>
        <p>
          รายการ: {target?.customerName || "-"} ({target?.bookingTime || "-"})
        </p>

        <label htmlFor="delete-pin">รหัส PIN ของพนักงาน</label>
        <input
          id="delete-pin"
          type="password"
          value={pin}
          onChange={(e) => onPinChange(e.target.value)}
          placeholder="กรอกรหัส PIN"
        />

        <label htmlFor="delete-reason">เหตุผล (ไม่บังคับ)</label>
        <input
          id="delete-reason"
          type="text"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="ใส่เหตุผลการลบ (ถ้ามี)"
        />

        {error && <div className="delete-error">{error}</div>}

        <div className="delete-modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "กำลังลบ..." : "ยืนยันลบ"}
          </button>
        </div>
      </div>
    </div>
  );
}
