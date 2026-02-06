import { useState } from "react";

export function useDeleteAppointment(onDeleteAppointment, setToast) {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePin, setDeletePin] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openDelete = (row) => {
    if (!row?.id) {
      setToast?.({ type: "error", message: "ไม่พบรหัสรายการสำหรับลบ" });
      return;
    }
    setDeleteTarget(row);
    setDeletePin("");
    setDeleteReason("");
    setDeleteError("");
  };

  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeletePin("");
    setDeleteReason("");
    setDeleteError("");
  };

  const confirmDelete = async () => {
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
      setToast?.({ type: "success", message: "ลบรายการเรียบร้อยแล้ว" });
      setDeleteTarget(null);
      setDeletePin("");
      setDeleteReason("");
    } catch (err) {
      setDeleteError(err?.message || "ลบรายการไม่สำเร็จ");
    } finally {
      setDeleteBusy(false);
    }
  };

  return {
    deleteTarget, deletePin, setDeletePin,
    deleteReason, setDeleteReason,
    deleteError, deleteBusy,
    openDelete, closeDelete, confirmDelete,
  };
}
