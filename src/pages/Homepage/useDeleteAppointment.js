import { useState } from "react";

export function useDeleteAppointment(onDeleteAppointment, setToast) {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openDelete = (row) => {
    if (!row?.id) {
      setToast?.({ type: "error", message: "ไม่พบรหัสรายการสำหรับลบ" });
      return;
    }
    setDeleteTarget(row);
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
    if (!deleteTarget?.id) return;
    if (typeof onDeleteAppointment !== "function") {
      setDeleteError("ระบบลบยังไม่พร้อมใช้งาน");
      return;
    }

    try {
      setDeleteBusy(true);
      setDeleteError("");
      await onDeleteAppointment(deleteTarget.id, deleteReason.trim());
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
