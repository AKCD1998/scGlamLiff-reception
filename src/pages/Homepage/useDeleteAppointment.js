import { useState } from "react";

function resolveAppointmentId(row) {
  return String(row?.appointmentId || row?.appointment_id || row?.id || "").trim();
}

export function useDeleteAppointment(onDeleteAppointment, setToast) {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openDelete = (row) => {
    const appointmentId = resolveAppointmentId(row);
    if (!appointmentId) {
      setToast?.({ type: "error", message: "ไม่พบรหัสรายการสำหรับลบ" });
      return;
    }
    setDeleteTarget({ ...(row || {}), appointmentId, appointment_id: appointmentId, id: appointmentId });
    setDeleteReason("");
    setDeleteError("");
  };

  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeleteReason("");
    setDeleteError("");
  };

  const confirmDelete = async () => {
    const appointmentId = resolveAppointmentId(deleteTarget);
    if (!appointmentId) return;
    if (typeof onDeleteAppointment !== "function") {
      setDeleteError("ระบบลบยังไม่พร้อมใช้งาน");
      return;
    }

    try {
      setDeleteBusy(true);
      setDeleteError("");
      await onDeleteAppointment(appointmentId, deleteReason.trim());
      setToast?.({ type: "success", message: "ยกเลิกรายการเรียบร้อยแล้ว" });
      setDeleteTarget(null);
      setDeleteReason("");
    } catch (err) {
      setDeleteError(err?.message || "ลบรายการไม่สำเร็จ");
    } finally {
      setDeleteBusy(false);
    }
  };

  return {
    deleteTarget,
    deleteReason, setDeleteReason,
    deleteError, deleteBusy,
    openDelete, closeDelete, confirmDelete,
  };
}
