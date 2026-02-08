export default function AppointmentsTablePanel({
  loading,
  error,
  selectedDate,
  activeFilterKey,
  filteredRows,
  onAddAppointment,
  onOpenDelete,
}) {
  return (
    <div className="panel table-panel">
      {loading && (
        <div className="table-loading-overlay" role="status" aria-live="polite">
          <div className="workbench-loading-card">
            <div className="workbench-loading-spinner" aria-hidden="true" />
            <div className="workbench-loading-text">กำลังโหลดข้อมูล...</div>
          </div>
        </div>
      )}

      <div className="panel-title">
        <span>Appointments</span>
        <strong>ล่าสุด</strong>
        <button type="button" className="add-appointment-btn" onClick={onAddAppointment}>
          +เพิ่มรายการจองคิว
        </button>
      </div>

      {selectedDate && <div className="table-filter-badge">กำลังกรอง: {activeFilterKey}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>เวลาจอง</th>
              <th>ชื่อ-นามสกุล ลูกค้า</th>
              <th>โทรศัพท์</th>
              <th>อีเมล / line ID</th>
              <th>Treatment item</th>
              <th>Staff Name</th>
              <th>ID</th>
              <th>ลบ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="9">กำลังโหลด...</td></tr>
            ) : error ? (
              <tr><td colSpan="9" style={{ color: "var(--text-muted)" }}>เกิดข้อผิดพลาด: {error}</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan="9">ไม่มีข้อมูล</td></tr>
            ) : (
              filteredRows.map((row, idx) => (
                <tr key={`${row.id || row.date}-${row.bookingTime}-${row.lineId || "row"}-${idx}`}>
                  <td>{row.date}</td>
                  <td>{row.bookingTime}</td>
                  <td>{row.customerName}</td>
                  <td>{row.phone}</td>
                  <td>{row.lineId || "-"}</td>
                  <td>{row.treatmentItemDisplay || row.treatmentItem}</td>
                  <td>{row.staffName}</td>
                  <td className="row-id-cell">{row.id || "-"}</td>
                  <td>
                    <button type="button" className="row-delete-btn" onClick={() => onOpenDelete(row)}>
                      ลบ
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
