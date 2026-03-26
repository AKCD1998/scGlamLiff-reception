import { useMemo, useState } from "react";

const PAGE_SIZE = 10;

export default function AppointmentsTablePanel({
  loading,
  hasLoadedOnce = false,
  error,
  selectedDate,
  activeFilterKey,
  filteredRows,
  showTestRecords = true,
  hiddenTestCount = 0,
  onToggleShowTestRecords,
  canManageTestRecords = false,
  onAddAppointment,
  onOpenDelete,
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalRows = filteredRows.length;
  const totalPages = Math.max(Math.ceil(totalRows / PAGE_SIZE), 1);
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const pageRows = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredRows, safeCurrentPage]);

  const pageStart = totalRows === 0 ? 0 : (safeCurrentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = totalRows === 0 ? 0 : Math.min(safeCurrentPage * PAGE_SIZE, totalRows);
  const showPagination = !loading && !error && hasLoadedOnce && totalRows > PAGE_SIZE;

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
        <span>ตารางนัดหมาย</span>
        <strong>ล่าสุด</strong>
        <button type="button" className="add-appointment-btn" onClick={onAddAppointment}>
          +เพิ่มรายการจองคิว
        </button>
      </div>

      {canManageTestRecords ? (
        <label className="table-e2e-toggle" htmlFor="home-show-e2e-toggle">
          <input
            id="home-show-e2e-toggle"
            type="checkbox"
            checked={showTestRecords}
            onChange={(event) => onToggleShowTestRecords?.(event.target.checked)}
          />
          <span>แสดงข้อมูลทดสอบ (E2E)</span>
          {!showTestRecords && hiddenTestCount > 0 ? (
            <em>{`ซ่อนอยู่ ${hiddenTestCount} รายการ`}</em>
          ) : null}
        </label>
      ) : null}

      {selectedDate && <div className="table-filter-badge">กำลังกรอง: {activeFilterKey}</div>}

      {hasLoadedOnce && !loading && !error && totalRows > 0 ? (
        <div className="table-pagination-summary" aria-live="polite">
          แสดง {pageStart}-{pageEnd} จาก {totalRows} รายการ
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>เวลาจอง</th>
              <th>ชื่อ-นามสกุล ลูกค้า</th>
              <th>โทรศัพท์</th>
              <th>อีเมล / line ID</th>
              <th>บริการ</th>
              <th>พนักงาน</th>
              <th>รหัส</th>
              <th>ลบ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="9">กำลังโหลด...</td></tr>
            ) : error ? (
              <tr><td colSpan="9" style={{ color: "var(--text-muted)" }}>เกิดข้อผิดพลาด: {error}</td></tr>
            ) : !hasLoadedOnce ? (
              <tr><td colSpan="9">กำลังโหลด...</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan="9">ไม่มีข้อมูล</td></tr>
            ) : (
              pageRows.map((row, idx) => (
                <tr
                  key={`${
                    row.appointmentId || row.appointment_id || row.id || row.date
                  }-${row.bookingTime}-${row.lineId || "row"}-${(safeCurrentPage - 1) * PAGE_SIZE + idx}`}
                >
                  <td>{row.date}</td>
                  <td>{row.bookingTime}</td>
                  <td>{row.customerName}</td>
                  <td>{row.phone}</td>
                  <td>{row.lineId || "-"}</td>
                  <td>{row.treatmentDisplay || row.treatmentItem || row.treatmentItemDisplay}</td>
                  <td>{row.staffName || "-"}</td>
                  <td className="row-id-cell">{row.appointmentId || row.appointment_id || row.id || "-"}</td>
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

      {showPagination ? (
        <div className="table-pagination" aria-label="Table pagination">
          <button
            type="button"
            className="table-pagination-btn"
            onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
            disabled={safeCurrentPage === 1}
          >
            ก่อนหน้า
          </button>
          <span className="table-pagination-status">
            หน้า {safeCurrentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="table-pagination-btn"
            onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
            disabled={safeCurrentPage === totalPages}
          >
            ถัดไป
          </button>
        </div>
      ) : null}
    </div>
  );
}
