import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelService,
  completeService,
  getCustomerProfile,
  noShowService,
  revertService,
  syncAppointmentCourse,
} from "../utils/appointmentsApi";
import ProgressDots from "./ProgressDots";
import "./ServiceConfirmationModal.css";

const NO_COURSE_ID = "__NO_COURSE__";

function normalizePlanMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "oneoff") return "one_off";
  if (mode === "one_off") return "one_off";
  if (mode === "package") return "package";
  return "";
}

function normalizePackageId(value) {
  return String(value || "").trim();
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function statusLabel(status) {
  const s = normalizeStatus(status);
  if (s === "completed") return "ให้บริการแล้ว";
  if (s === "cancelled" || s === "canceled") return "ยกเลิกการจอง";
  if (s === "no_show" || s === "no-show" || s === "noshow") return "ลูกค้าไม่มารับบริการ";
  if (s === "ensured" || s === "confirmed") return "ยืนยันแล้ว";
  if (s === "rescheduled") return "เลื่อนนัด";
  return "จองแล้ว";
}

// eslint-disable-next-line react-refresh/only-export-components
export function isRevertableStatus(status) {
  const s = normalizeStatus(status);
  return ["completed", "no_show", "cancelled", "canceled"].includes(s);
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(Math.trunc(parsed), 0);
}

function clampInt(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  const truncated = Math.trunc(parsed);
  return Math.min(Math.max(truncated, min), max);
}

// eslint-disable-next-line react-refresh/only-export-components
export function calculateDeductionPreview({
  sessionsRemaining = 0,
  maskRemaining = 0,
  deductSessions = 0,
  deductMask = 0,
} = {}) {
  const safeSessionsRemaining = toNonNegativeInt(sessionsRemaining, 0);
  const safeMaskRemaining = toNonNegativeInt(maskRemaining, 0);
  const safeDeductSessions = toNonNegativeInt(deductSessions, 0);
  const safeDeductMask = toNonNegativeInt(deductMask, 0);
  return {
    nextSessions: Math.max(safeSessionsRemaining - safeDeductSessions, 0),
    nextMask: Math.max(safeMaskRemaining - safeDeductMask, 0),
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildActivePackages(packages = []) {
  return packages
    .filter((pkg) => String(pkg?.status || "").toLowerCase() === "active")
    .map((pkg) => {
      const sessionsTotal = Number(pkg?.package?.sessions_total);
      const sessionsTotalSafe = Number.isFinite(sessionsTotal) ? sessionsTotal : 0;

      const sessionsUsed = Number(pkg?.usage?.sessions_used);
      const sessionsUsedSafe = Number.isFinite(sessionsUsed) ? sessionsUsed : 0;

      const sessionsRemainingRaw = Number(pkg?.usage?.sessions_remaining);
      const sessionsRemaining = Number.isFinite(sessionsRemainingRaw)
        ? sessionsRemainingRaw
        : Math.max(sessionsTotalSafe - sessionsUsedSafe, 0);

      const maskTotal = Number(pkg?.package?.mask_total);
      const maskTotalSafe = Number.isFinite(maskTotal) ? maskTotal : 0;

      const maskUsed = Number(pkg?.usage?.mask_used);
      const maskUsedSafe = Number.isFinite(maskUsed) ? maskUsed : 0;

      const maskRemainingRaw = Number(pkg?.usage?.mask_remaining);
      const maskRemaining = Number.isFinite(maskRemainingRaw)
        ? maskRemainingRaw
        : Math.max(maskTotalSafe - maskUsedSafe, 0);

      return {
        ...pkg,
        _computed: {
          sessionsTotal: Math.max(sessionsTotalSafe, 0),
          sessionsUsed: Math.max(sessionsUsedSafe, 0),
          sessionsRemaining: Math.max(sessionsRemaining, 0),
          maskTotal: Math.max(maskTotalSafe, 0),
          maskUsed: Math.max(maskUsedSafe, 0),
          maskRemaining: Math.max(maskRemaining, 0),
        },
      };
    })
    .filter((pkg) => pkg._computed.sessionsRemaining > 0)
    .sort((a, b) => {
      const remainingDiff = b._computed.sessionsRemaining - a._computed.sessionsRemaining;
      if (remainingDiff !== 0) return remainingDiff;

      const totalDiff = b._computed.sessionsTotal - a._computed.sessionsTotal;
      if (totalDiff !== 0) return totalDiff;

      const aPurchasedAt = Date.parse(String(a?.purchased_at || ""));
      const bPurchasedAt = Date.parse(String(b?.purchased_at || ""));
      const aTs = Number.isNaN(aPurchasedAt) ? 0 : aPurchasedAt;
      const bTs = Number.isNaN(bPurchasedAt) ? 0 : bPurchasedAt;
      if (aTs !== bTs) return bTs - aTs;

      return String(a?.customer_package_id || "").localeCompare(
        String(b?.customer_package_id || "")
      );
    });
}

export default function ServiceConfirmationModal({
  open,
  onClose,
  booking,
  currentUser,
  onAfterAction,
}) {
  const closeButtonRef = useRef(null);
  const fetchCompletedRef = useRef(false);
  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasResolvedOnce, setHasResolvedOnce] = useState(false);

  const [packages, setPackages] = useState([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [packagesError, setPackagesError] = useState("");

  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [actionStatus, setActionStatus] = useState("completed");
  const [deductSessions, setDeductSessions] = useState(1);
  const [deductMask, setDeductMask] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");

  const isAdmin = ["admin", "owner"].includes(String(currentUser?.role_name || "").toLowerCase());
  const bookingPlanMode = useMemo(
    () => normalizePlanMode(booking?.treatmentPlanMode ?? booking?.treatment_plan_mode),
    [booking?.treatmentPlanMode, booking?.treatment_plan_mode]
  );
  const bookingPlanPackageId = useMemo(
    () =>
      normalizePackageId(
        booking?.treatmentPlanPackageId ?? booking?.treatment_plan_package_id
      ),
    [booking?.treatmentPlanPackageId, booking?.treatment_plan_package_id]
  );
  const bookingTreatmentText = useMemo(
    () => String(booking?.treatmentItem || "").trim(),
    [booking?.treatmentItem]
  );
  const looksLikeOneOffByText = useMemo(() => {
    const text = bookingTreatmentText.toLowerCase();
    return /\b1\s*\/\s*1\b/.test(text) && /\bmask\s*0\s*\/\s*0\b/.test(text);
  }, [bookingTreatmentText]);
  const oneOffCardCode = useMemo(
    () => bookingTreatmentText || "NO COURSE DEDUCTION",
    [bookingTreatmentText]
  );
  const allowNoCourseCompletion = useMemo(() => {
    if (bookingPlanMode === "one_off") return true;
    if (bookingPlanMode === "package") return false;
    if (bookingPlanPackageId) return false;

    const text = bookingTreatmentText.toLowerCase();
    // Fallback heuristic for older rows without treatment plan mode metadata.
    if (/\b1\s*\/\s*1\b/.test(text) && /\bmask\s*0\s*\/\s*0\b/.test(text)) {
      return true;
    }

    // Sheet/course strings look like "1/3 ..." or "2/10 ..." etc. If it's not a progress string,
    // allow completing without deducting any package (one-off services like "smooth 399 free").
    return !/\b\d+\s*\/\s*\d+\b/.test(text);
  }, [bookingPlanMode, bookingPlanPackageId, bookingTreatmentText]);

  const showOnlyOneOffOption = bookingPlanMode === "one_off" || looksLikeOneOffByText;
  const effectiveNoCourseCompletion = allowNoCourseCompletion || showOnlyOneOffOption;

  useEffect(() => {
    if (!open) return undefined;
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      fetchCompletedRef.current = false;
      setHasResolvedOnce(false);
      return;
    }

    if (fetchCompletedRef.current && !loading && !packagesLoading) {
      const raf = requestAnimationFrame(() => {
        setHasResolvedOnce(true);
      });
      return () => cancelAnimationFrame(raf);
    }

    return undefined;
  }, [loading, open, packagesLoading]);

  useEffect(() => {
    if (!open) return;

    fetchCompletedRef.current = false;
    setHasResolvedOnce(false);
    setAppointment(null);
    setError("");
    setLoading(true);
    setPackages([]);
    setPackagesError("");
    setPackagesLoading(false);
    setSelectedPackageId(effectiveNoCourseCompletion ? NO_COURSE_ID : "");
    setDeductSessions(1);
    setDeductMask(0);
    setSubmitError("");
    setSubmitSuccess("");
    setSubmitting(false);
    setActionStatus("completed");

    const controller = new AbortController();

    const run = async () => {
      let shouldFinalize = true;
      try {
        const appointmentId = booking?.appointmentId || booking?.appointment_id || booking?.id || "";
        const customerId = booking?.customerId || booking?.customer_id || null;

        if (!appointmentId) {
          throw new Error("Missing appointment id");
        }

        const appt = {
          id: appointmentId,
          customer_id: customerId,
          status: booking?.status || "booked",
        };

        setAppointment(appt);

        if (!appt?.customer_id) {
          setPackages([]);
          return;
        }

        setPackagesLoading(true);
        setPackagesError("");
        try {
          let syncErrorMessage = "";
          if (!effectiveNoCourseCompletion) {
            try {
              await syncAppointmentCourse(appointmentId, controller.signal);
            } catch (syncErr) {
              syncErrorMessage = syncErr?.message || "ซิงค์คอร์สไม่สำเร็จ";
            }
          }

          const profile = await getCustomerProfile(appt.customer_id, controller.signal);
          let list = Array.isArray(profile.packages) ? profile.packages : [];
          if (showOnlyOneOffOption) {
            list = [];
          }
          if (list.length === 0 && !effectiveNoCourseCompletion && syncErrorMessage) {
            setPackagesError(syncErrorMessage);
          }

          setPackages(list);
        } catch (pkgErr) {
          if (pkgErr?.name === "AbortError") {
            shouldFinalize = false;
            return;
          }
          setPackages([]);
          setPackagesError(pkgErr?.message || "โหลดคอร์สไม่สำเร็จ");
        }
      } catch (e) {
        if (e?.name === "AbortError") {
          shouldFinalize = false;
          return;
        }
        setError(e?.message || "Server error");
      } finally {
        if (shouldFinalize) {
          setPackagesLoading(false);
          setLoading(false);
          fetchCompletedRef.current = true;
        }
      }
    };

    run();

    return () => controller.abort();
  }, [
    allowNoCourseCompletion,
    effectiveNoCourseCompletion,
    showOnlyOneOffOption,
    booking?.appointmentId,
    booking?.appointment_id,
    booking?.customerId,
    booking?.customer_id,
    booking?.id,
    booking?.status,
    booking?.treatmentItem,
    bookingPlanMode,
    bookingPlanPackageId,
    open,
  ]);

  const isInitialLoading =
    open &&
    !hasResolvedOnce &&
    (!fetchCompletedRef.current || loading || packagesLoading);

  const appointmentStatus = appointment?.status || booking?.status || "booked";
  const appointmentStatusNormalized = normalizeStatus(appointmentStatus);
  const canMutate = useMemo(() => {
    return ["booked", "rescheduled"].includes(appointmentStatusNormalized);
  }, [appointmentStatusNormalized]);
  const canRevert = isAdmin && isRevertableStatus(appointmentStatusNormalized);

  const activePackages = useMemo(() => {
    return buildActivePackages(packages);
  }, [packages]);
  const packageChoices = useMemo(() => {
    if (showOnlyOneOffOption) return [];
    if (!bookingPlanPackageId) return activePackages;

    const matched = activePackages.filter(
      (pkg) => String(pkg?.customer_package_id || "") === bookingPlanPackageId
    );
    return matched.length > 0 ? matched : activePackages;
  }, [activePackages, bookingPlanPackageId, showOnlyOneOffOption]);

  const selectedPkg = useMemo(
    () => packageChoices.find((pkg) => pkg.customer_package_id === selectedPackageId) || null,
    [packageChoices, selectedPackageId]
  );

  const completingWithoutCourse =
    effectiveNoCourseCompletion && selectedPackageId === NO_COURSE_ID;

  useEffect(() => {
    if (!open) return;

    if (showOnlyOneOffOption) {
      if (selectedPackageId !== NO_COURSE_ID) {
        setSelectedPackageId(NO_COURSE_ID);
      }
      return;
    }

    if (bookingPlanPackageId) {
      const matched = packageChoices.some(
        (pkg) => String(pkg?.customer_package_id || "") === bookingPlanPackageId
      );
      if (matched && selectedPackageId !== bookingPlanPackageId) {
        setSelectedPackageId(bookingPlanPackageId);
        return;
      }
    }

    if (!selectedPackageId && packageChoices.length === 1) {
      const onlyId = String(packageChoices[0]?.customer_package_id || "");
      if (onlyId) {
        setSelectedPackageId(onlyId);
      }
    }
  }, [
    bookingPlanPackageId,
    open,
    packageChoices,
    selectedPackageId,
    showOnlyOneOffOption,
  ]);

  const syncCourses = async () => {
    const appointmentId = appointment?.id || booking?.appointmentId || booking?.appointment_id || booking?.id || "";
    const customerId = appointment?.customer_id || booking?.customerId || booking?.customer_id || null;

    if (!appointmentId || !customerId) {
      setPackagesError("Missing appointment/customer id");
      return;
    }

    setPackagesLoading(true);
    setPackagesError("");
    try {
      await syncAppointmentCourse(appointmentId);
      const profile = await getCustomerProfile(customerId);
      const list = Array.isArray(profile.packages) ? profile.packages : [];
      setPackages(list);
    } catch (err) {
      setPackages([]);
      setPackagesError(err?.message || "โหลดคอร์สไม่สำเร็จ");
    } finally {
      setPackagesLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (actionStatus !== "completed" || completingWithoutCourse || !selectedPkg) {
      setDeductSessions(1);
      setDeductMask(0);
      return;
    }

    const maxSessions = Math.max(selectedPkg._computed.sessionsRemaining, 1);
    const maxMask = Math.max(
      Math.min(selectedPkg._computed.maskRemaining, maxSessions),
      0
    );

    setDeductSessions((prev) => clampInt(prev, 1, maxSessions));
    setDeductMask((prev) => clampInt(prev, 0, maxMask));
  }, [actionStatus, completingWithoutCourse, open, selectedPkg]);

  const deductionValidation = useMemo(() => {
    if (actionStatus !== "completed") return { valid: true, message: "" };
    if (completingWithoutCourse) return { valid: true, message: "" };
    if (!selectedPkg) {
      return { valid: false, message: "เลือกคอร์ส 1 รายการก่อนยืนยัน" };
    }

    const sessionsRemaining = Math.max(selectedPkg._computed.sessionsRemaining, 0);
    const maskRemaining = Math.max(selectedPkg._computed.maskRemaining, 0);

    if (!Number.isInteger(deductSessions) || deductSessions < 1) {
      return { valid: false, message: "จำนวนครั้งบริการต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป" };
    }
    if (deductSessions > sessionsRemaining) {
      return {
        valid: false,
        message: `จำนวนครั้งที่เลือก (${deductSessions}) มากกว่าคงเหลือ (${sessionsRemaining})`,
      };
    }
    if (!Number.isInteger(deductMask) || deductMask < 0) {
      return { valid: false, message: "จำนวน Mask ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" };
    }
    if (deductMask > maskRemaining) {
      return {
        valid: false,
        message: `จำนวน Mask ที่เลือก (${deductMask}) มากกว่าคงเหลือ (${maskRemaining})`,
      };
    }
    if (deductMask > deductSessions) {
      return {
        valid: false,
        message: "จำนวน Mask ที่ตัดต้องไม่เกินจำนวนครั้งบริการที่ตัด",
      };
    }

    return { valid: true, message: "" };
  }, [actionStatus, completingWithoutCourse, deductMask, deductSessions, selectedPkg]);

  const progressState = useMemo(() => {
    if (submitting) {
      return {
        used: 3,
        label: "ขั้นตอน 3/3 กำลังบันทึกรายการ",
      };
    }
    if (submitSuccess) {
      return {
        used: 3,
        label: "ขั้นตอน 3/3 เสร็จสิ้น",
      };
    }
    if (actionStatus !== "completed") {
      return {
        used: 1,
        label: "ขั้นตอน 1/3 เลือกสถานะการทำรายการ",
      };
    }
    if (completingWithoutCourse) {
      return {
        used: 2,
        label: "ขั้นตอน 2/3 พร้อมยืนยันแบบไม่ตัดคอร์ส",
      };
    }
    if (deductionValidation.valid) {
      return {
        used: 2,
        label: "ขั้นตอน 2/3 พร้อมยืนยันการตัดคอร์ส",
      };
    }
    return {
      used: 1,
      label: "ขั้นตอน 1/3 เลือกคอร์สและจำนวนที่ต้องตัด",
    };
  }, [
    actionStatus,
    completingWithoutCourse,
    deductionValidation.valid,
    submitSuccess,
    submitting,
  ]);

  const preview = useMemo(() => {
    if (!selectedPkg) return null;
    const { sessionsRemaining, maskRemaining } = selectedPkg._computed;
    if (actionStatus !== "completed" || completingWithoutCourse) {
      return {
        nextSessions: Math.max(sessionsRemaining, 0),
        nextMask: Math.max(maskRemaining, 0),
      };
    }
    return calculateDeductionPreview({
      sessionsRemaining,
      maskRemaining,
      deductSessions,
      deductMask,
    });
  }, [
    actionStatus,
    completingWithoutCourse,
    deductMask,
    deductSessions,
    selectedPkg,
  ]);

  const maxMaskDeduction = useMemo(() => {
    if (!selectedPkg) return 0;
    return Math.max(
      Math.min(selectedPkg._computed.maskRemaining, deductSessions),
      0
    );
  }, [deductSessions, selectedPkg]);

  const handleDeductSessionsChange = (event) => {
    if (!selectedPkg) return;
    const maxSessions = Math.max(selectedPkg._computed.sessionsRemaining, 1);
    const parsed = Number.parseInt(String(event.target.value ?? ""), 10);
    const nextSessions = Number.isFinite(parsed)
      ? clampInt(parsed, 1, maxSessions)
      : 1;
    setDeductSessions(nextSessions);
    setDeductMask((prev) => clampInt(prev, 0, Math.min(selectedPkg._computed.maskRemaining, nextSessions)));
  };

  const handleDeductMaskChange = (event) => {
    if (!selectedPkg) return;
    const parsed = Number.parseInt(String(event.target.value ?? ""), 10);
    const nextMask = Number.isFinite(parsed)
      ? clampInt(parsed, 0, maxMaskDeduction)
      : 0;
    setDeductMask(nextMask);
  };

  const isConfirmDisabled =
    submitting ||
    !canMutate ||
    (actionStatus === "completed" && !deductionValidation.valid);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitError("");
    setSubmitSuccess("");

    if (!appointment?.id) {
      setSubmitError("ไม่พบข้อมูล appointment");
      return;
    }

    if (!canMutate) {
      setSubmitError("ไม่สามารถแก้ไขสถานะรายการนี้ได้");
      return;
    }

    if (actionStatus === "completed") {
      if (completingWithoutCourse) {
        // One-off completion: no course/package deduction.
      } else if (!selectedPackageId) {
        setSubmitError("กรุณาเลือกคอร์สที่ต้องการตัด");
        return;
      } else if (selectedPackageId === NO_COURSE_ID) {
        if (!effectiveNoCourseCompletion) {
          setSubmitError("รายการนี้ต้องเลือกคอร์สเพื่อทำรายการ");
          return;
        }
      }
      if (!selectedPkg) {
        if (!completingWithoutCourse) {
          setSubmitError("คอร์สที่เลือกไม่ถูกต้อง");
          return;
        }
      }
      if (selectedPkg) {
        if (selectedPkg._computed.sessionsRemaining <= 0) {
          setSubmitError("คอร์สนี้เหลือ 0 ครั้งแล้ว");
          return;
        }
        if (deductSessions < 1) {
          setSubmitError("จำนวนครั้งบริการต้องอย่างน้อย 1");
          return;
        }
        if (deductSessions > selectedPkg._computed.sessionsRemaining) {
          setSubmitError(
            `จำนวนครั้งที่ตัด (${deductSessions}) เกินจำนวนที่เหลือ (${selectedPkg._computed.sessionsRemaining})`
          );
          return;
        }
        if (deductMask < 0) {
          setSubmitError("จำนวน Mask ต้องเป็น 0 หรือมากกว่า");
          return;
        }
        if (deductMask > selectedPkg._computed.maskRemaining) {
          setSubmitError(
            `จำนวน Mask ที่ตัด (${deductMask}) เกินจำนวนที่เหลือ (${selectedPkg._computed.maskRemaining})`
          );
          return;
        }
        if (deductMask > deductSessions) {
          setSubmitError("จำนวน Mask ที่ตัดต้องไม่เกินจำนวนครั้งบริการที่ตัด");
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      let actionResult = null;
      if (actionStatus === "completed") {
        if (completingWithoutCourse) {
          actionResult = await completeService(appointment.id, {});
        } else {
          actionResult = await completeService(appointment.id, {
            customer_package_id: selectedPackageId,
            deduct_sessions: deductSessions,
            deduct_mask: deductMask,
          });
        }
      } else if (actionStatus === "cancelled") {
        actionResult = await cancelService(appointment.id);
      } else if (actionStatus === "no_show") {
        actionResult = await noShowService(appointment.id);
      }

      await onAfterAction?.(actionResult);
      onClose?.();
    } catch (e) {
      setSubmitError(e?.message || "ทำรายการไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevert = async () => {
    if (!canRevert || submitting) return;
    if (!appointment?.id) return;
    const confirmed = window.confirm("ยืนยันย้อนกลับเป็นสถานะจองแล้ว/ยืนยันแล้ว ?");
    if (!confirmed) return;

    setSubmitError("");
    setSubmitSuccess("");
    setSubmitting(true);
    try {
      await revertService(appointment.id);
      setAppointment((prev) => (prev ? { ...prev, status: "booked" } : prev));
      setActionStatus("completed");
      setDeductSessions(1);
      setDeductMask(0);
      setSubmitSuccess("ย้อนกลับเป็นสถานะจองแล้ว/ยืนยันแล้วสำเร็จ");
      try {
        await onAfterAction?.();
      } catch (refreshError) {
        console.error("[ServiceConfirmationModal] onAfterAction failed after revert", refreshError);
      }
    } catch (e) {
      setSubmitError(e?.message || "Revert ไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="booking-modal-overlay" onClick={onClose}>
      <div
        className="booking-modal-card service-confirmation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-confirmation-title"
        onClick={(event) => event.stopPropagation()}
      >
        {isInitialLoading ? (
          <div className="modal-loading-overlay" role="status" aria-live="polite">
            <div className="workbench-loading-card">
              <div className="workbench-loading-spinner" aria-hidden="true" />
              <div className="workbench-loading-text">กำลังโหลดข้อมูลลูกค้า...</div>
              <div className="workbench-loading-subtext">โปรดรอสักครู่</div>
            </div>
          </div>
        ) : null}

        <div className="scm-header">
          <div className="scm-title-wrap">
            <div className="scm-title" id="service-confirmation-title">
              ยืนยันการให้บริการ
            </div>
            <div className="scm-progress" aria-live="polite">
              <ProgressDots
                total={3}
                used={progressState.used}
                size="sm"
                ariaLabel={progressState.label}
              />
              <span className="scm-progress__label">{progressState.label}</span>
            </div>
          </div>
          <button
            type="button"
            className="booking-modal-close"
            aria-label="ปิดการยืนยันการให้บริการ"
            onClick={onClose}
            ref={closeButtonRef}
          >
            ×
          </button>
        </div>

        <div className="scm-body">
          <section className="scm-section">
            <div className="scm-section__title">1) สรุปการนัดหมาย</div>
            <div className="scm-summary">
              <div>
                <div className="scm-label">ลูกค้า</div>
                <div className="scm-value">{booking?.customerName || "-"}</div>
              </div>
              <div>
                <div className="scm-label">เวลาการจอง</div>
                <div className="scm-value">{`${booking?.date || "-"} ${booking?.bookingTime || ""}`}</div>
              </div>
              <div>
                <div className="scm-label">การรักษา</div>
                <div className="scm-value">{booking?.treatmentItem || "-"}</div>
              </div>
              <div>
                <div className="scm-label">ผู้ให้บริการ</div>
                <div className="scm-value">{booking?.staffName || "-"}</div>
              </div>
              <div>
                <div className="scm-label">ผู้รับบริการ</div>
                <div className="scm-value">{currentUser?.display_name || currentUser?.username || "-"}</div>
              </div>
              <div>
                <div className="scm-label">สถานะปัจจุบัน</div>
                <div className="scm-value">{statusLabel(appointmentStatus)}</div>
              </div>
            </div>

            {loading ? <div className="scm-state">กำลังโหลดข้อมูล...</div> : null}
            {error ? (
              <div className="scm-state scm-state--error">{error}</div>
            ) : null}
          </section>

          <section className="scm-section">
            <div className="scm-section__title">2) โปรดเลือกบริการ</div>
            {packagesLoading ? (
              <div className="scm-state">กำลังโหลดคอร์ส...</div>
            ) : packagesError ? (
              <>
                <div className="scm-state scm-state--error">{packagesError}</div>
                {effectiveNoCourseCompletion ? (
                  <div className="scm-packages" role="radiogroup" aria-label="Select package">
                    <button
                      type="button"
                      className={`scm-package${completingWithoutCourse ? " is-selected" : ""}`}
                      onClick={() => {
                        setSelectedPackageId(NO_COURSE_ID);
                        setDeductSessions(1);
                        setDeductMask(0);
                      }}
                      disabled={!canMutate || actionStatus !== "completed"}
                      aria-pressed={completingWithoutCourse}
                    >
                      <div className="scm-package__top">
                        <div>
                          <div className="scm-package__title">บริการแบบครั้งเดียว</div>
                          <div className="scm-package__code">{oneOffCardCode}</div>
                        </div>
                        <div className="scm-package__meta">
                          <div>ไม่ตัดจำนวนครั้ง / Mask</div>
                        </div>
                      </div>
                    </button>
                  </div>
                ) : null}
              </>
            ) : hasResolvedOnce && packageChoices.length === 0 && !effectiveNoCourseCompletion ? (
              <div className="scm-state scm-state--row">
                <span>ไม่พบคอร์สที่ใช้งานได้</span>
                <button
                  type="button"
                  className="scm-inline-btn"
                  onClick={syncCourses}
                  disabled={packagesLoading}
                >
                  ซิงค์คอร์ส
                </button>
              </div>
            ) : (
              <>
                <div className="scm-packages" role="radiogroup" aria-label="Select package">
                  {effectiveNoCourseCompletion ? (
                    <button
                      type="button"
                      className={`scm-package${completingWithoutCourse ? " is-selected" : ""}`}
                      onClick={() => {
                        setSelectedPackageId(NO_COURSE_ID);
                        setDeductSessions(1);
                        setDeductMask(0);
                      }}
                      disabled={!canMutate || actionStatus !== "completed"}
                      aria-pressed={completingWithoutCourse}
                    >
                      <div className="scm-package__top">
                        <div>
                          <div className="scm-package__title">บริการแบบครั้งเดียว</div>
                          <div className="scm-package__code">{oneOffCardCode}</div>
                        </div>
                        <div className="scm-package__meta">
                          <div>ไม่ตัดจำนวนครั้ง / Mask</div>
                        </div>
                      </div>
                    </button>
                  ) : null}
                  {packageChoices.map((pkg) => {
                    const disabled = pkg._computed.sessionsRemaining <= 0;
                    const checked = selectedPackageId === pkg.customer_package_id;
                    return (
                      <button
                        key={pkg.customer_package_id}
                        type="button"
                        className={`scm-package${checked ? " is-selected" : ""}`}
                        onClick={() => setSelectedPackageId(pkg.customer_package_id)}
                        disabled={disabled || !canMutate || actionStatus !== "completed"}
                        aria-pressed={checked}
                      >
                        <div className="scm-package__top">
                          <div>
                            <div className="scm-package__title">
                              {pkg.package?.title || pkg.package?.code || "-"}
                            </div>
                            <div className="scm-package__code">{pkg.package?.code || "-"}</div>
                          </div>
                          <div className="scm-package__meta">
                            <div>
                              เหลือ {pkg._computed.sessionsRemaining}/{pkg._computed.sessionsTotal} ครั้ง
                            </div>
                            {pkg._computed.maskTotal > 0 ? (
                              <div>
                                Mask เหลือ {pkg._computed.maskRemaining}/{pkg._computed.maskTotal}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {hasResolvedOnce && packageChoices.length === 0 && effectiveNoCourseCompletion ? (
                  <div className="scm-state">บริการแบบครั้งเดียว: สามารถกด Confirm ได้โดยไม่ตัดคอร์ส</div>
                ) : null}
              </>
            )}
            {!canMutate && !isAdmin ? (
              <div className="scm-state">รายการนี้ถูกปิดแล้ว (แก้ไขได้เฉพาะแอดมิน)</div>
            ) : null}
          </section>

          <section className="scm-section">
            <div className="scm-section__title">3) ตัวเลือกการใช้บริการเสริม</div>
            {actionStatus !== "completed" ? (
              <div className="scm-state">เลือกสถานะ “completed” เพื่อเปิดตัวเลือกการตัดคอร์ส</div>
            ) : completingWithoutCourse ? (
              <div className="scm-state">บริการแบบครั้งเดียว: ไม่มีการตัดคอร์ส / Mask</div>
            ) : !selectedPkg ? (
              <div className="scm-state">เลือกคอร์ส 1 รายการเพื่อดูตัวเลือก</div>
            ) : (
              <>
                <div className="scm-deduct-grid">
                  <label className="scm-field">
                    <span className="scm-field__label">จำนวนครั้งที่จะตัด</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(selectedPkg._computed.sessionsRemaining, 1)}
                      value={deductSessions}
                      onChange={handleDeductSessionsChange}
                      disabled={submitting}
                    />
                    <span className="scm-field__hint">
                      คงเหลือ {selectedPkg._computed.sessionsRemaining} ครั้ง
                    </span>
                  </label>

                  {selectedPkg._computed.maskTotal > 0 ? (
                    <label className="scm-field">
                      <span className="scm-field__label">จำนวน Mask ที่จะตัด</span>
                      <input
                        type="number"
                        min={0}
                        max={maxMaskDeduction}
                        value={deductMask}
                        onChange={handleDeductMaskChange}
                        disabled={submitting || selectedPkg._computed.maskRemaining <= 0}
                      />
                      <span className="scm-field__hint">
                        คงเหลือ {selectedPkg._computed.maskRemaining} ครั้ง (สูงสุดรอบนี้{" "}
                        {maxMaskDeduction} ครั้ง)
                      </span>
                    </label>
                  ) : (
                    <div className="scm-state">คอร์สนี้ไม่มีสิทธิ์ Mask</div>
                  )}
                </div>
                <div className="scm-preview">
                  <div>
                    <div className="scm-label">Preview หลังยืนยัน</div>
                    <div className="scm-value">
                      จำนวนการให้บริการที่เหลือ: {preview?.nextSessions ?? "-"}
                    </div>
                    {selectedPkg._computed.maskTotal > 0 ? (
                      <div className="scm-value">
                        จำนวน Mask ที่เหลือ: {preview?.nextMask ?? "-"}
                      </div>
                    ) : null}
                  </div>
                </div>
                {!deductionValidation.valid ? (
                  <div className="scm-state scm-state--error">{deductionValidation.message}</div>
                ) : null}
              </>
            )}
          </section>

          <section className="scm-section">
            <div className="scm-section__title">4) สถานะการดำเนินการ</div>
            <div className="scm-status-grid" role="radiogroup" aria-label="Select status">
              <label className="scm-radio">
                <input type="radio" checked readOnly disabled />
                <span>{`สถานะปัจจุบัน: ${statusLabel(appointmentStatus)}`}</span>
              </label>
              <label className="scm-radio">
                <input
                  type="radio"
                  name="scm-status"
                  value="completed"
                  checked={actionStatus === "completed"}
                  onChange={() => setActionStatus("completed")}
                  disabled={!canMutate}
                />
                <span>เสร็จสิ้นการให้บริการ</span>
              </label>
              <label className="scm-radio">
                <input
                  type="radio"
                  name="scm-status"
                  value="cancelled"
                  checked={actionStatus === "cancelled"}
                  onChange={() => setActionStatus("cancelled")}
                  disabled={!canMutate}
                />
                <span>ยกเลิกการให้บริการ</span>
              </label>
              <label className="scm-radio">
                <input
                  type="radio"
                  name="scm-status"
                  value="no_show"
                  checked={actionStatus === "no_show"}
                  onChange={() => setActionStatus("no_show")}
                  disabled={!canMutate}
                />
                <span>ไม่มารับบริการ</span>
              </label>
            </div>

            {submitError ? (
              <div className="scm-state scm-state--error">{submitError}</div>
            ) : null}
            {submitSuccess ? (
              <div className="scm-state scm-state--success">{submitSuccess}</div>
            ) : null}

            <div className="scm-actions">
              {canRevert ? (
                <button
                  type="button"
                  className="scm-btn scm-btn--danger"
                  onClick={handleRevert}
                  disabled={submitting}
                >
                  ย้อนกลับเป็นสถานะจอง/ยืนยันแล้ว
                </button>
              ) : null}

              <button
                type="button"
                className="scm-btn scm-btn--primary"
                onClick={handleConfirm}
                disabled={isConfirmDisabled}
              >
                {submitting ? "Processing..." : "Confirm"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
