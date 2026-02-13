import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import MonthYearPopover from "./MonthYearPopover";
import { useThaiCalendar } from "../../hooks/useThaiCalendar";
import { formatDateKey } from "../../utils/dateFormat";

export default function ScheduleCalendarPanel({
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
  glowDays,
  glowError,
}) {
  const { monthLabel, yearRange, addMonths } = useThaiCalendar(displayMonth);

  const openPicker = () => {
    setPickerMonth(displayMonth.getMonth());
    setPickerYear(displayMonth.getFullYear());
    setIsPickerOpen(true);
  };

  const applyPicker = () => {
    setDisplayMonth(new Date(pickerYear, pickerMonth, 1));
    setIsPickerOpen(false);
  };

  const selectDate = (date) => {
    if (!date) return;
    setSelectedDate(date);
    setDisplayMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  return (
    <div className="panel date-panel">
      <div className="calendar-header">
        <div className="calendar-title">Schedule</div>

        <button
          type="button"
          className="calendar-label-button"
          onClick={() => (isPickerOpen ? setIsPickerOpen(false) : openPicker())}
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

      <MonthYearPopover
        open={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        yearRange={yearRange}
        pickerYear={pickerYear}
        setPickerYear={setPickerYear}
        pickerMonth={pickerMonth}
        setPickerMonth={setPickerMonth}
        onApply={applyPicker}
      />

      <DayPicker
        mode="single"
        selected={selectedDate}
        onSelect={selectDate}
        month={displayMonth}
        onMonthChange={setDisplayMonth}
        weekStartsOn={1}
        showOutsideDays={false}
        fixedWeeks
        modifiers={{
          hasBooking: (day) =>
            glowDays instanceof Set && glowDays.has(formatDateKey(day)),
        }}
        modifiersClassNames={{ hasBooking: "rdp-day-hasBooking" }}
        className="calendar-picker"
      />

      <div className="calendar-legend" aria-live="polite">
        <span className="calendar-legend-dot" aria-hidden="true" />
        <span>มีคิว</span>
        {glowError ? <em>โหลดวันนัดหมายไม่สำเร็จ</em> : null}
      </div>
    </div>
  );
}
