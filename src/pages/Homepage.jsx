import { useEffect, useState } from "react";
import { useAppointmentsFilter } from "../pages/Homepage/useAppointmentsFilters";
import { useDeleteAppointment } from "../pages/Homepage/useDeleteAppointment";

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
    rows, loading, error,
    onAddAppointment,
    onDeleteAppointment,
  } = props;

  const [toast, setToast] = useState(null);

  const { activeFilterKey, filteredRows, bookingDates } =
    useAppointmentsFilter(rows, selectedDate);

  const del = useDeleteAppointment(onDeleteAppointment, setToast);
  const isDataLoading = Boolean(loading);

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
      aria-busy={isDataLoading ? "true" : undefined}
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
        loading={loading}
        error={error}
        selectedDate={selectedDate}
        activeFilterKey={activeFilterKey}
        filteredRows={filteredRows}
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
        open={isDataLoading}
        label="กำลังโหลดข้อมูล..."
        subtext="โปรดรอสักครู่"
      />
    </section>
  );
}
