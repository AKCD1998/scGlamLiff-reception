import { useCallback, useEffect, useRef, useState } from "react";
import { cancelAppointment, getAppointmentsQueue } from "../../utils/appointmentsApi";
import { normalizeRow, getRowTimestamp } from "./workbenchRow";

const AUTO_REFETCH_THROTTLE_MS = 2500;

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
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const requestIdRef = useRef(0);
  const lastAutoRefetchAtRef = useRef(0);

  const reloadAppointments = useCallback(
    async (signal) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError(null);
      try {
        const dateKey = selectedDate ? formatDateKey(selectedDate) : "";
        // Homepage data source:
        // - Endpoint: GET /api/appointments/queue
        // - Query params: date, branch_id, limit
        // - Identifier: appointment_id (appointments.id UUID)
        // - Backend joins: appointments->customers/treatments + APPOINTMENT_IDENTITY_JOINS_SQL on customer_id + ae.appointment_id.
        const data = await getAppointmentsQueue(
          { date: dateKey || undefined, branchId: branchId || undefined, limit },
          signal
        );
        if (requestId !== requestIdRef.current) return;
        const normalized = (data.rows || []).map(normalizeRow);
        normalized.sort((a, b) => getRowTimestamp(b) - getRowTimestamp(a));
        setRows(normalized);
        setHasLoadedOnce(true);
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (requestId !== requestIdRef.current) return;
        setError(err?.message || "Error loading appointments");
        setRows([]);
        setHasLoadedOnce(true);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [branchId, limit, selectedDate]
  );

  useEffect(() => {
    const controller = new AbortController();
    lastAutoRefetchAtRef.current = Date.now();
    reloadAppointments(controller.signal);
    return () => controller.abort();
  }, [reloadAppointments]);

  const refetch = useCallback(
    async ({ force = false } = {}) => {
      const now = Date.now();
      if (!force && now - lastAutoRefetchAtRef.current < AUTO_REFETCH_THROTTLE_MS) {
        return false;
      }
      lastAutoRefetchAtRef.current = now;
      await reloadAppointments();
      return true;
    },
    [reloadAppointments]
  );

  useEffect(() => {
    const onFocus = () => {
      void refetch();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void refetch();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refetch]);

  const deleteAppointment = useCallback(
    async (id, reason) => {
      await cancelAppointment(id, reason);
      await refetch({ force: true });
    },
    [refetch]
  );

  return { rows, loading, error, hasLoadedOnce, reloadAppointments, refetch, deleteAppointment };
}
