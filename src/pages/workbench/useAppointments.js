import { useCallback, useEffect, useState } from "react";
import { deleteSheetVisit, getAppointments } from "../../utils/appointmentsApi";
import { normalizeRow, getRowTimestamp } from "./workbenchRow";

export function useAppointments(limit = 50) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reloadAppointments = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        const data = await getAppointments(limit, signal);
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
    [limit]
  );

  useEffect(() => {
    const controller = new AbortController();
    reloadAppointments(controller.signal);
    return () => controller.abort();
  }, [reloadAppointments]);

  const deleteAppointment = useCallback(
    async (id, pin, reason) => {
      await deleteSheetVisit(id, pin, reason);
      await reloadAppointments();
    },
    [reloadAppointments]
  );

  return { rows, loading, error, reloadAppointments, deleteAppointment };
}
