import { useEffect, useMemo, useState } from "react";
import { useAppointmentsFilter } from "../pages/Homepage/useAppointmentsFilters";
import { useDeleteAppointment } from "../pages/Homepage/useDeleteAppointment";
import { isTestRecord, shouldHideTestRecordsByDefault } from "../utils/isTestRecord";

import ScheduleCalendarPanel from "../components/calendar/ScheduleCalendarPanel";
import AppointmentsTablePanel from "../components/appointments/AppointmentsTablePanel";
import DeleteAppointmentModal from "../components/appointments/DeleteAppointmentModal";
import Toast from "../components/appointments/Toast";
import LoadingOverlay from "../components/LoadingOverlay";
import "./Homepage.css";

export default function Homepage(props) {
  const {
    selectedDate, setSelectedDate,
    displayMonth, setDisplayMonth,
    isPickerOpen, setIsPickerOpen,
    pickerMonth, setPickerMonth,
    pickerYear, setPickerYear,
    rows, loading, error, hasLoadedOnce,
    onAddAppointment,
    onDeleteAppointment,
    canManageTestRecords = false,
  } = props;

  const [toast, setToast] = useState(null);
  const [showTestRecords, setShowTestRecords] = useState(
    () => !shouldHideTestRecordsByDefault()
  );
  const effectiveShowTestRecords = canManageTestRecords ? showTestRecords : false;

  const visibleRows = useMemo(() => {
    if (effectiveShowTestRecords) return rows;
    return rows.filter((row) => !isTestRecord(row));
  }, [rows, effectiveShowTestRecords]);

  const hiddenTestCount = useMemo(() => {
    if (effectiveShowTestRecords) return 0;
    return Math.max((rows?.length || 0) - visibleRows.length, 0);
  }, [rows, effectiveShowTestRecords, visibleRows.length]);

  const { activeFilterKey, filteredRows, bookingDates } =
    useAppointmentsFilter(visibleRows, selectedDate);

  const del = useDeleteAppointment(onDeleteAppointment, setToast);
  const pageInitialLoading = Boolean(loading && !hasLoadedOnce);
  const tableLoading = Boolean(loading && hasLoadedOnce);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const handleAdd = () => {
    if (typeof onAddAppointment === "function") return onAddAppointment();
    alert("TODO: เพิ่มรายการจองคิว");
  };

  return (
    <section
      className="workbench-body homepage-content"
      aria-busy={loading ? "true" : undefined}
    >
      <ScheduleCalendarPanel
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        displayMonth={displayMonth}
        setDisplayMonth={setDisplayMonth}
        isPickerOpen={isPickerOpen}
        setIsPickerOpen={setIsPickerOpen}
        pickerMonth={pickerMonth}
        setPickerMonth={setPickerMonth}
        pickerYear={pickerYear}
        setPickerYear={setPickerYear}
        bookingDates={bookingDates}
      />

      <AppointmentsTablePanel
        loading={tableLoading}
        hasLoadedOnce={hasLoadedOnce}
        error={error}
        selectedDate={selectedDate}
        activeFilterKey={activeFilterKey}
        filteredRows={filteredRows}
        showTestRecords={showTestRecords}
        hiddenTestCount={hiddenTestCount}
        onToggleShowTestRecords={setShowTestRecords}
        canManageTestRecords={canManageTestRecords}
        onAddAppointment={handleAdd}
        onOpenDelete={del.openDelete}
      />

      <DeleteAppointmentModal
        open={!!del.deleteTarget}
        target={del.deleteTarget}
        reason={del.deleteReason}
        onReasonChange={del.setDeleteReason}
        error={del.deleteError}
        busy={del.deleteBusy}
        onClose={del.closeDelete}
        onConfirm={del.confirmDelete}
      />

      <Toast toast={toast} />
      <LoadingOverlay
        open={pageInitialLoading}
        label="กำลังโหลดข้อมูล..."
        subtext="โปรดรอสักครู่"
      />
    </section>
  );
}
