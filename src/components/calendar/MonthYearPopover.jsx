import { thaiMonths, toBuddhistYear } from "../../hooks/useThaiCalendar";

export default function MonthYearPopover({
  open,
  onClose,
  yearRange,
  pickerYear,
  setPickerYear,
  pickerMonth,
  setPickerMonth,
  onApply,
}) {
  if (!open) return null;

  return (
    <div className="calendar-popover">
      <div className="calendar-popover-header">
        <span>เลือกเดือนและปี</span>
        <button type="button" className="calendar-close" onClick={onClose}>
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
        <button type="button" className="calendar-apply" onClick={onApply}>
          ใช้งาน
        </button>
        <button type="button" className="calendar-cancel" onClick={onClose}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
