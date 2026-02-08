import { useCallback, useEffect, useState } from "react";
import { cancelAppointment, getAppointmentsQueue } from "../../utils/appointmentsApi";
import { normalizeRow, getRowTimestamp } from "./workbenchRow";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function useAppointments({ limit = 50, selectedDate = null, branchId = "" } = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reloadAppointments = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        const dateKey = selectedDate ? formatDateKey(selectedDate) : "";
        const data = await getAppointmentsQueue(
          { date: dateKey || undefined, branchId: branchId || undefined, limit },
          signal
        );
        const normalized = (data.rows || []).map(normalizeRow);
        normalized.sort((a, b) => getRowTimestamp(b) - getRowTimestamp(a));
        setRows(normalized);
      } catch (err) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Error loading appointments");
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [branchId, limit, selectedDate]
  );

  useEffect(() => {
    const controller = new AbortController();
    reloadAppointments(controller.signal);
    return () => controller.abort();
  }, [reloadAppointments]);

  const deleteAppointment = useCallback(
    async (id, reason) => {
      await cancelAppointment(id, reason);
      await reloadAppointments();
    },
    [reloadAppointments]
  );

  return { rows, loading, error, reloadAppointments, deleteAppointment };
}
