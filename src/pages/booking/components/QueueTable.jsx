export default function QueueTable({
  loading,
  error,
  rows,
  onOpenServiceModal,
  formatAppointmentStatus,
}) {
  return (
    <table className="booking-table">
      <thead>
        <tr>
          <th className="booking-table-check" aria-label="เลือกคิว" />
          <th>เวลาจอง</th>
          <th>ชื่อ-นามสกุล ลูกค้า</th>
          <th>โทรศัพท์</th>
          <th>Treatment item</th>
          <th>Staff Name</th>
          <th>สถานะลูกค้า</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr>
            <td colSpan="7">กำลังโหลด...</td>
          </tr>
        ) : error ? (
          <tr>
            <td colSpan="7">เกิดข้อผิดพลาด: {error}</td>
          </tr>
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan="7">ไม่มีข้อมูล</td>
          </tr>
        ) : (
          rows.map((row, idx) => (
            <tr key={`${row.bookingTime}-${row.customerName}-${idx}`}>
              <td className="booking-table-check">
                <label className="booking-check">
                  <input
                    type="checkbox"
                    className="booking-check-input"
                    checked={false}
                    readOnly
                    aria-label={`Confirm service for ${row.customerName || "customer"} ${row.bookingTime || ""}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpenServiceModal(row);
                    }}
                  />
                  <span className="booking-check-box" aria-hidden="true" />
                </label>
              </td>
              <td>{row.bookingTime}</td>
              <td>{row.customerName}</td>
              <td>{row.phone}</td>
              <td>
                <div className="booking-treatment-cell">
                  <span>{row.treatmentDisplay || row.treatmentItem}</span>
                  {row.hasContinuousCourse ? (
                    <span className="booking-badge booking-badge--continuous">คอร์สต่อเนื่อง</span>
                  ) : null}
                </div>
              </td>
              <td>{row.staffName}</td>
              <td className="booking-table-status">
                {formatAppointmentStatus(row.status)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
