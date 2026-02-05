// npm install react-day-picker
import { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

const thaiMonths = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

function toBuddhistYear(yearAD) {
  return yearAD + 543;
}

function formatThaiMonthYear(date) {
  const monthName = thaiMonths[date.getMonth()];
  const yearTH = toBuddhistYear(date.getFullYear());
  return `${monthName} ${yearTH}`;
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeDateString(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (raw.includes("-")) {
    const parts = raw.split("-").map((p) => p.trim());
    if (parts.length === 3) {
      const [a, b, c] = parts;
      if (a.length === 4) {
        return `${a}-${pad2(b)}-${pad2(c)}`;
      }
      if (c.length === 4) {
        return `${c}-${pad2(b)}-${pad2(a)}`;
      }
    }
  }
  if (raw.includes("/")) {
    const parts = raw.split("/").map((p) => p.trim());
    if (parts.length === 3) {
      const [a, b, c] = parts;
      if (a.length === 4) {
        return `${a}-${pad2(b)}-${pad2(c)}`;
      }
      if (c.length === 4) {
        return `${c}-${pad2(b)}-${pad2(a)}`;
      }
    }
  }
  return raw;
}

export default function Homepage({
  selectedDate,
  setSelectedDate,
  displayMonth,
  setDisplayMonth,
  isPickerOpen,
  setIsPickerOpen,
  pickerMonth,
  setPickerMonth,
  pickerYear,
  setPickerYear,
  rows,
  loading,
  error,
  onAddAppointment,
  onDeleteAppointment,
}) {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePin, setDeletePin] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const monthLabel = useMemo(() => formatThaiMonthYear(displayMonth), [displayMonth]);
  const yearRange = useMemo(() => {
    const baseYear = new Date().getFullYear();
    return Array.from({ length: 21 }, (_, i) => baseYear - 10 + i);
  }, []);
  const activeFilterKey = useMemo(
    () => (selectedDate ? formatDateKey(selectedDate) : ""),
    [selectedDate]
  );
  const filteredRows = useMemo(() => {
    if (!selectedDate) return rows;
    const key = activeFilterKey;
    if (!key) return rows;
    return rows.filter((row) => normalizeDateString(row.date) === key);
  }, [rows, selectedDate, activeFilterKey]);
  const bookingDates = useMemo(() => {
    const seen = new Set();
    const dates = [];
    rows.forEach((row) => {
      const key = normalizeDateString(row.date);
      const parts = key.split("-");
      if (parts.length !== 3) return;
      const [yyyy, mm, dd] = parts.map((p) => Number(p));
      if (!yyyy || !mm || !dd) return;
      const dateObj = new Date(yyyy, mm - 1, dd);
      if (Number.isNaN(dateObj.getTime())) return;
      const stamp = dateObj.toDateString();
      if (seen.has(stamp)) return;
      seen.add(stamp);
      dates.push(dateObj);
    });
    return dates;
  }, [rows]);

  const handleOpenPicker = () => {
    setPickerMonth(displayMonth.getMonth());
    setPickerYear(displayMonth.getFullYear());
    setIsPickerOpen(true);
  };

  const handleApplyPicker = () => {
    setDisplayMonth(new Date(pickerYear, pickerMonth, 1));
    setIsPickerOpen(false);
  };

  const handleSelectDate = (date) => {
    if (!date) return;
    setSelectedDate(date);
    setDisplayMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  const handleAddAppointment = () => {
    if (typeof onAddAppointment === "function") {
      onAddAppointment();
      return;
    }
    alert("TODO: เพิ่มรายการจองคิว");
  };

  const handleOpenDelete = (row) => {
    if (!row?.id) {
      setToast({ type: "error", message: "ไม่พบรหัสรายการสำหรับลบ" });
      return;
    }
    setDeleteTarget(row);
    setDeletePin("");
    setDeleteReason("");
    setDeleteError("");
  };

  const handleCloseDelete = () => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeletePin("");
    setDeleteReason("");
    setDeleteError("");
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget?.id) return;
    if (!deletePin.trim()) {
      setDeleteError("กรุณากรอกรหัส PIN");
      return;
    }
    if (typeof onDeleteAppointment !== "function") {
      setDeleteError("ระบบลบยังไม่พร้อมใช้งาน");
      return;
    }
    try {
      setDeleteBusy(true);
      setDeleteError("");
      await onDeleteAppointment(deleteTarget.id, deletePin.trim(), deleteReason.trim());
      setToast({ type: "success", message: "ลบรายการเรียบร้อยแล้ว" });
      setDeleteTarget(null);
      setDeletePin("");
      setDeleteReason("");
    } catch (err) {
      setDeleteError(err?.message || "ลบรายการไม่สำเร็จ");
    } finally {
      setDeleteBusy(false);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <section className="workbench-body">
      <div className="panel date-panel">
        <div className="calendar-header">
          <div className="calendar-title">Schedule</div>
          <button
            type="button"
            className="calendar-label-button"
            onClick={() => (isPickerOpen ? setIsPickerOpen(false) : handleOpenPicker())}
          >
            {monthLabel}
          </button>
          <button
            type="button"
            className="calendar-showall"
            onClick={() => setSelectedDate(null)}
            disabled={!selectedDate}
          >
            แสดงทั้งหมด
          </button>
          <div className="calendar-nav">
            <button
              type="button"
              className="calendar-nav-button"
              aria-label="Previous month"
              onClick={() => setDisplayMonth((prev) => addMonths(prev, -1))}
            >
              ‹
            </button>
            <button
              type="button"
              className="calendar-nav-button"
              aria-label="Next month"
              onClick={() => setDisplayMonth((prev) => addMonths(prev, 1))}
            >
              ›
            </button>
          </div>
        </div>

        {isPickerOpen && (
          <div className="calendar-popover">
            <div className="calendar-popover-header">
              <span>เลือกเดือนและปี</span>
              <button
                type="button"
                className="calendar-close"
                onClick={() => setIsPickerOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="calendar-year">
              <label htmlFor="calendar-year-select">ปี (พ.ศ.)</label>
              <select
                id="calendar-year-select"
                value={pickerYear}
                onChange={(e) => setPickerYear(Number(e.target.value))}
              >
                {yearRange.map((year) => (
                  <option key={year} value={year}>
                    {toBuddhistYear(year)}
                  </option>
                ))}
              </select>
            </div>
            <div className="calendar-month-grid">
              {thaiMonths.map((month, idx) => (
                <button
                  type="button"
                  key={month}
                  className={`calendar-month-button ${idx === pickerMonth ? "selected" : ""}`}
                  onClick={() => setPickerMonth(idx)}
                >
                  {month}
                </button>
              ))}
            </div>
            <div className="calendar-popover-actions">
              <button type="button" className="calendar-apply" onClick={handleApplyPicker}>
                ใช้งาน
              </button>
              <button type="button" className="calendar-cancel" onClick={() => setIsPickerOpen(false)}>
                ยกเลิก
              </button>
            </div>
          </div>
        )}

        <DayPicker
          mode="single"
          selected={selectedDate}
          onSelect={handleSelectDate}
          month={displayMonth}
          onMonthChange={setDisplayMonth}
          weekStartsOn={1}
          showOutsideDays={false}
          fixedWeeks
          modifiers={{ hasBooking: bookingDates }}
          modifiersClassNames={{ hasBooking: "rdp-day-hasBooking" }}
          className="calendar-picker"
        />
      </div>

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
          <button
            type="button"
            className="add-appointment-btn"
            onClick={handleAddAppointment}
          >
            +เพิ่มรายการจองคิว
          </button>
        </div>
        {selectedDate && (
          <div className="table-filter-badge">
            กำลังกรอง: {activeFilterKey}
          </div>
        )}
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
                <tr>
                  <td colSpan="9">กำลังโหลด...</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="9" style={{ color: "var(--text-muted)" }}>
                    เกิดข้อผิดพลาด: {error}
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan="9">ไม่มีข้อมูล</td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => (
                  <tr key={`${row.id || row.date}-${row.bookingTime}-${row.lineId || "row"}-${idx}`}>
                    <td>{row.date}</td>
                    <td>{row.bookingTime}</td>
                    <td>{row.customerName}</td>
                    <td>{row.phone}</td>
                    <td>{row.lineId}</td>
                    <td>{row.treatmentItem}</td>
                    <td>{row.staffName}</td>
                    <td className="row-id-cell">{row.id || "-"}</td>
                    <td>
                      <button
                        type="button"
                        className="row-delete-btn"
                        onClick={() => handleOpenDelete(row)}
                      >
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

      {deleteTarget && (
        <div className="delete-modal-backdrop" onClick={handleCloseDelete}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>ยืนยันการลบรายการ</h3>
            <p>
              รายการ: {deleteTarget.customerName || "-"} ({deleteTarget.bookingTime || "-"})
            </p>
            <label htmlFor="delete-pin">รหัส PIN ของพนักงาน</label>
            <input
              id="delete-pin"
              type="password"
              value={deletePin}
              onChange={(e) => setDeletePin(e.target.value)}
              placeholder="กรอกรหัส PIN"
            />
            <label htmlFor="delete-reason">เหตุผล (ไม่บังคับ)</label>
            <input
              id="delete-reason"
              type="text"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="ใส่เหตุผลการลบ (ถ้ามี)"
            />
            {deleteError && <div className="delete-error">{deleteError}</div>}
            <div className="delete-modal-actions">
              <button type="button" onClick={handleCloseDelete} disabled={deleteBusy}>
                ยกเลิก
              </button>
              <button type="button" onClick={handleConfirmDelete} disabled={deleteBusy}>
                {deleteBusy ? "กำลังลบ..." : "ยืนยันลบ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`table-toast ${toast.type === "error" ? "is-error" : ""}`}>
          {toast.message}
        </div>
      )}
    </section>
  );
}
