import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildOccupiedRanges,
  formatDateKey,
  getRecommendedSlotsWithAvailability,
  isTimeAvailable,
  normalizeBookingTime,
  normalizeDateString,
  parseTimeToMinutes,
  toIsoDateFromDDMMYYYY,
} from "../utils/bookingTimeUtils";
import {
  appendAppointment,
  getBookingTreatmentOptions,
  getAppointmentsQueue,
  getCustomerProfile,
  getCustomers,
} from "../utils/appointmentsApi";
import { getMe } from "../utils/authClient";
import AdminOverrideModal from "../components/AdminOverrideModal";
import CustomerProfileModal from "../components/CustomerProfileModal";
import ServiceConfirmationModal from "../components/ServiceConfirmationModal";
import BookingTabs from "./booking/components/BookingTabs";
import BookingFormPanel from "./booking/components/BookingFormPanel";
import CustomerPanel from "./booking/components/CustomerPanel";
import QueuePanel from "./booking/components/QueuePanel";
import StatusOverlay from "./booking/components/StatusOverlay";
import LoadingOverlay from "../components/LoadingOverlay";
import {
  formatAppointmentStatus,
  getRowTimestamp,
  normalizeCustomerRow,
  normalizeRow,
  normalizeTreatmentOptionRow,
  shortenId,
} from "./booking/utils/bookingPageFormatters";
import {
  buildFallbackTreatmentOptions,
  SELECT_STYLES,
  TIME_CFG,
} from "./booking/utils/constants";
import { sanitizeEmailOrLine, sanitizeThaiPhone } from "./booking/utils/validators";
import "./Bookingpage.css";

function isAdminRole(roleName) {
  const role = String(roleName || "").trim().toLowerCase();
  return role === "admin" || role === "owner";
}

export default function Bookingpage() {
  // Data source contract (Bookingpage queue + create):
  // - Queue endpoint: GET /api/appointments/queue?date=&branch_id=&limit=
  // - Create endpoint: POST /api/appointments
  // - Identifier used by UI/mutations: appointment_id (appointments.id UUID), never raw_sheet_uuid.
  // - Queue backend joins:
  //   appointments a
  //   LEFT JOIN customers c ON a.customer_id = c.id
  //   LEFT JOIN treatments t ON a.treatment_id = t.id
  //   + APPOINTMENT_IDENTITY_JOINS_SQL (customer_identities + appointment_events on ae.appointment_id = a.id).
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState(null);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [queueHasLoadedOnce, setQueueHasLoadedOnce] = useState(false);
  const [customersHasLoadedOnce, setCustomersHasLoadedOnce] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerProfile, setCustomerProfile] = useState(null);
  const [customerProfileLoading, setCustomerProfileLoading] = useState(false);
  const [customerProfileError, setCustomerProfileError] = useState(null);
  const profileCacheRef = useRef(new Map());
  const [queueDateFilter, setQueueDateFilter] = useState("");
  const [bookingDate, setBookingDate] = useState(() => formatDateKey(new Date()));
  const [bookingTime, setBookingTime] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [lineId, setLineId] = useState("");
  const [treatmentOptions, setTreatmentOptions] = useState(() =>
    buildFallbackTreatmentOptions()
  );
  const [treatmentItem, setTreatmentItem] = useState(() => {
    const fallback = buildFallbackTreatmentOptions();
    return fallback[0]?.value || "";
  });
  const [treatmentOptionsError, setTreatmentOptionsError] = useState("");
  const [staffName, setStaffName] = useState("ส้ม");
  const [timeError, setTimeError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [lineIdError, setLineIdError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [guideSpotlight, setGuideSpotlight] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusMode, setStatusMode] = useState("idle");
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideViolations, setOverrideViolations] = useState([]);
  const [overridePassword, setOverridePassword] = useState("");
  const [activeTab, setActiveTab] = useState("queue");
  const treatmentOptionValues = useMemo(
    () => new Set(treatmentOptions.map((option) => option.value)),
    [treatmentOptions]
  );
  const [me, setMe] = useState(null);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [selectedBookingRow, setSelectedBookingRow] = useState(null);
  const isAdmin = useMemo(() => isAdminRole(me?.role_name), [me?.role_name]);

  const focusGuideField = useCallback((fieldKey) => {
    const fieldToId = {
      date: "booking-date",
      customer: "booking-name",
      time: "booking-time",
      phone: "booking-phone",
      line: "booking-line",
      service: "booking-service",
      staff: "booking-provider",
    };

    const targetId = fieldToId[fieldKey];
    if (!targetId) return;

    const byId = document.getElementById(targetId);
    const serviceInput =
      targetId === "booking-service"
        ? document.querySelector('input[id^="react-select-booking-service-"][id$="-input"]')
        : null;
    const target = byId || serviceInput;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof target.focus === "function") {
      target.focus();
    }
  }, []);

  const openGuideSpotlight = useCallback(
    (fieldKey, title, detail) => {
      setGuideSpotlight({
        fieldKey: String(fieldKey || "").trim(),
        title: String(title || "").trim(),
        detail: String(detail || "").trim(),
      });
      window.requestAnimationFrame(() => {
        focusGuideField(fieldKey);
      });
    },
    [focusGuideField]
  );

  const clearGuideSpotlight = useCallback(() => {
    setGuideSpotlight(null);
  }, []);

  const clearGuideIfField = useCallback((fieldKey) => {
    setGuideSpotlight((prev) => {
      if (!prev) return prev;
      return prev.fieldKey === fieldKey ? null : prev;
    });
  }, []);

  const resetStatus = useCallback(() => {
    setStatusOpen(false);
    setStatusMode("idle");
  }, []);

  const hardReloadToWorkbench = useCallback(() => {
    const basePath = window.location.pathname
      .replace(/\/index\.html$/, "")
      .replace(/\/$/, "");
    const target = `${window.location.origin}${basePath}/#/workbench`;
    window.location.replace(target);
    window.location.reload();
  }, []);

  const handleCloseStatus = useCallback(() => {
    if (statusMode === "success") {
      hardReloadToWorkbench();
      return;
    }
    resetStatus();
  }, [hardReloadToWorkbench, resetStatus, statusMode]);

  useEffect(() => {
    if (statusOpen && statusMode === "success") {
      const timer = setTimeout(() => {
        hardReloadToWorkbench();
      }, 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [hardReloadToWorkbench, statusOpen, statusMode]);

  const loadAppointments = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    let completed = false;
    try {
      // Endpoint: GET /api/appointments/queue?limit=200
      // Query params used here: limit only (date/branch filters are not sent in this call).
      const data = await getAppointmentsQueue({ limit: 200 }, signal);
      const normalized = (data.rows || []).map(normalizeRow);
      setRows(normalized);
      completed = true;
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError(err?.message || "Error loading appointments");
      setRows([]);
      completed = true;
    } finally {
      if (completed) {
        setQueueHasLoadedOnce(true);
      }
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadAppointments(controller.signal);
    return () => controller.abort();
  }, [loadAppointments]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const result = await getMe();
      if (!alive) return;
      if (result.ok) {
        setMe(result.data);
      }
    };
    run();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    const loadTreatmentOptions = async () => {
      try {
        setTreatmentOptionsError("");
        const data = await getBookingTreatmentOptions(controller.signal);
        if (!alive) return;

        const normalized = (data.options || [])
          .map(normalizeTreatmentOptionRow)
          .filter(Boolean);

        if (
          import.meta.env.DEV &&
          String(import.meta.env.VITE_DEBUG_TREATMENT_CATALOG || "").toLowerCase() === "true"
        ) {
          console.log("[Bookingpage] treatment catalog preview");
          console.table(
            normalized.map((option) => ({
              treatment_id: option.treatmentId || "",
              name_en: option.treatmentNameEn || option.treatment_name_en || "",
              name_th: option.treatmentNameTh || option.treatment_name_th || "",
              treatment_display: option.treatmentDisplay || option.label || "",
            }))
          );
        }

        if (normalized.length === 0) {
          const fallback = buildFallbackTreatmentOptions();
          setTreatmentOptions(fallback);
          setTreatmentItem((prev) =>
            fallback.some((option) => option.value === prev)
              ? prev
              : fallback[0]?.value || ""
          );
          setTreatmentOptionsError("โหลดรายการบริการไม่สำเร็จ ใช้รายการสำรอง");
          return;
        }

        setTreatmentOptions(normalized);
        setTreatmentItem((prev) =>
          normalized.some((option) => option.value === prev)
            ? prev
            : normalized[0]?.value || ""
        );
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (!alive) return;
        const fallback = buildFallbackTreatmentOptions();
        setTreatmentOptions(fallback);
        setTreatmentItem((prev) =>
          fallback.some((option) => option.value === prev)
            ? prev
            : fallback[0]?.value || ""
        );
        setTreatmentOptionsError("โหลดรายการบริการไม่สำเร็จ ใช้รายการสำรอง");
      }
    };

    loadTreatmentOptions();

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const loadCustomers = useCallback(async (signal) => {
    setCustomersLoading(true);
    setCustomersError(null);
    let completed = false;
    try {
      const data = await getCustomers(signal);
      const normalized = (data.rows || []).map(normalizeCustomerRow);
      setCustomers(normalized);
      completed = true;
    } catch (err) {
      if (err?.name === "AbortError") return;
      setCustomersError(err?.message || "Error loading customers");
      setCustomers([]);
      completed = true;
    } finally {
      if (completed) {
        setCustomersLoaded(true);
        setCustomersHasLoadedOnce(true);
      }
      setCustomersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "customer" || customersLoaded) return;
    const controller = new AbortController();
    loadCustomers(controller.signal);
    return () => controller.abort();
  }, [activeTab, customersLoaded, loadCustomers]);

  const handleOpenEditModal = useCallback((customer) => {
    setSelectedCustomer(customer);
    const cached = profileCacheRef.current.get(customer?.id);
    if (cached) {
      setCustomerProfile(cached);
      setCustomerProfileError(null);
      setCustomerProfileLoading(false);
    } else {
      setCustomerProfile(null);
      setCustomerProfileError(null);
    }
    setIsEditModalOpen(true);
  }, []);

  const handleCloseEditModal = useCallback(() => {
    setIsEditModalOpen(false);
    setSelectedCustomer(null);
  }, []);

  const handleOpenServiceModal = useCallback((row) => {
    const appointmentId = String(row?.appointmentId || row?.appointment_id || "").trim();
    if (!appointmentId) {
      setSubmitError("ไม่พบ appointment_id ของรายการนี้");
      return;
    }
    setSelectedBookingRow({
      ...(row || {}),
      appointmentId,
      appointment_id: appointmentId,
      id: appointmentId,
    });
    setServiceModalOpen(true);
  }, []);

  const handleCloseServiceModal = useCallback(() => {
    setServiceModalOpen(false);
    setSelectedBookingRow(null);
  }, []);

  const loadCustomerProfile = useCallback(async (customerId, signal, options = {}) => {
    if (!customerId) return;
    const useCache = options.useCache !== false;
    const cached = useCache ? profileCacheRef.current.get(customerId) : null;
    if (cached) {
      setCustomerProfile(cached);
      setCustomerProfileError(null);
      setCustomerProfileLoading(false);
      return;
    }
    setCustomerProfileLoading(true);
    setCustomerProfileError(null);
    try {
      const data = await getCustomerProfile(customerId, signal);
      profileCacheRef.current.set(customerId, data);
      setCustomerProfile(data);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setCustomerProfileError(err?.message || "Error loading customer profile");
      setCustomerProfile(null);
    } finally {
      setCustomerProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isEditModalOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        handleCloseEditModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCloseEditModal, isEditModalOpen]);

  useEffect(() => {
    if (!isEditModalOpen || !selectedCustomer?.id) return undefined;
    const controller = new AbortController();
    loadCustomerProfile(selectedCustomer.id, controller.signal, { useCache: true });
    return () => controller.abort();
  }, [isEditModalOpen, loadCustomerProfile, selectedCustomer?.id]);

  useEffect(() => {
    if (!isEditModalOpen) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isEditModalOpen]);

  const filteredRows = useMemo(() => {
    const target = queueDateFilter ? normalizeDateString(queueDateFilter) : "";
    const list = target
      ? rows.filter((row) => normalizeDateString(row.date) === target)
      : rows;
    return [...list].sort((a, b) => getRowTimestamp(b) - getRowTimestamp(a));
  }, [rows, queueDateFilter]);

  const selectedDateObj = useMemo(() => {
    const key = normalizeDateString(bookingDate);
    if (!key) return null;
    return new Date(`${key}T00:00:00`);
  }, [bookingDate]);

  const occupiedRanges = useMemo(() => {
    const key = normalizeDateString(bookingDate);
    if (!key) return [];
    const rowsForDay = rows.filter((row) =>
      normalizeDateString(row.date) === key &&
      ["booked", "rescheduled"].includes(String(row.status || "booked").toLowerCase())
    );
    return buildOccupiedRanges(rowsForDay, TIME_CFG);
  }, [rows, bookingDate]);

  const recommendedSlots = useMemo(() => {
    if (!selectedDateObj) return [];
    const rowsForRecommend = rows.filter((row) =>
      ["booked", "rescheduled"].includes(String(row.status || "booked").toLowerCase())
    );
    return getRecommendedSlotsWithAvailability({
      selectedDate: selectedDateObj,
      now: new Date(),
      rows: rowsForRecommend,
      cfg: TIME_CFG,
    });
  }, [selectedDateObj, rows]);

  useEffect(() => {
    if (!bookingTime) {
      setTimeError("");
      return;
    }
    const candidateMin = parseTimeToMinutes(bookingTime);
    if (!Number.isFinite(candidateMin)) {
      setTimeError("");
      return;
    }
    const lastBookingMin = parseTimeToMinutes(TIME_CFG.lastBooking);
    if (Number.isFinite(lastBookingMin) && candidateMin > lastBookingMin) {
      setTimeError("เวลาสุดท้ายในการจองคือ 19:00");
      return;
    }
    const ok = isTimeAvailable(candidateMin, occupiedRanges, TIME_CFG);
    setTimeError(ok ? "" : "ช่วงเวลานี้ชนกับคิวที่มีอยู่แล้ว กรุณาเลือกเวลาอื่น");
  }, [bookingTime, occupiedRanges]);

  const isPastDate = useMemo(() => {
    if (!bookingDate) return false;
    const parts = normalizeDateString(bookingDate).split("-");
    if (parts.length !== 3) return false;
    const [yyyy, mm, dd] = parts.map((p) => Number(p));
    if (!yyyy || !mm || !dd) return false;
    const selectedDay = new Date(yyyy, mm - 1, dd);
    selectedDay.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return selectedDay.getTime() < today.getTime();
  }, [bookingDate]);

  const isPastBooking = useMemo(() => {
    if (isPastDate) return true;
    if (!bookingDate || !bookingTime) return false;
    const dateKey = toIsoDateFromDDMMYYYY(bookingDate);
    const timeKey = normalizeBookingTime(bookingTime);
    if (!dateKey || !timeKey) return false;
    const dateTime = new Date(`${dateKey}T${timeKey}:00`);
    if (Number.isNaN(dateTime.getTime())) return false;
    return dateTime.getTime() < Date.now();
  }, [bookingDate, bookingTime, isPastDate]);

  const collectTimeConstraintViolations = useCallback(() => {
    const violations = [];

    if (isPastBooking) {
      violations.push({
        key: "PAST_BOOKING",
        titleTh: "การจองย้อนหลัง",
        detailTh: "วันเวลาที่เลือกอยู่ก่อนเวลาปัจจุบัน",
      });
    }

    const candidateMin = parseTimeToMinutes(bookingTime);
    const lastBookingMin = parseTimeToMinutes(TIME_CFG.lastBooking);
    if (Number.isFinite(candidateMin) && Number.isFinite(lastBookingMin) && candidateMin > lastBookingMin) {
      violations.push({
        key: "CUTOFF_19",
        titleTh: "เกินเวลาปิดรับจอง",
        detailTh: "เวลาสุดท้ายในการจองคือ 19:00",
      });
    }

    if (Number.isFinite(candidateMin) && !isTimeAvailable(candidateMin, occupiedRanges, TIME_CFG)) {
      violations.push({
        key: "OVERLAP",
        titleTh: "เวลาชนกับคิวที่มีอยู่แล้ว",
        detailTh: "ช่วงเวลานี้ชนกับคิวที่มีอยู่แล้ว กรุณาเลือกเวลาอื่น",
      });
    }

    return violations;
  }, [bookingTime, isPastBooking, occupiedRanges]);

  const handleSaveBooking = async (options = {}) => {
    const overrideMeta = options.override;
    const allowTimeOverride = Boolean(overrideMeta?.is_override);

    if (saving) return;
    setSubmitError("");
    setSubmitSuccess("");
    setPhoneError("");
    setLineIdError("");
    setStatusOpen(true);
    setStatusMode("loading");

    const dateKey = toIsoDateFromDDMMYYYY(bookingDate);
    const timeKey = normalizeBookingTime(bookingTime);
    const cleanName = customerName.trim();
    const rawPhone = phone.trim();
    const rawLine = lineId.trim();
    const cleanPhone = sanitizeThaiPhone(rawPhone);
    const cleanLine = sanitizeEmailOrLine(rawLine);
    const selectedTreatmentOption =
      treatmentOptions.find((option) => option.value === treatmentItem) || null;
    const cleanTreatment = selectedTreatmentOption?.treatmentItemText?.trim() || "";
    const cleanTreatmentId = selectedTreatmentOption?.treatmentId?.trim() || "";
    const cleanPackageId = selectedTreatmentOption?.packageId?.trim() || "";
    const cleanStaff = staffName.trim();
    const selectedSessions = Number(
      selectedTreatmentOption?.treatmentSessions ?? selectedTreatmentOption?.sessionsTotal ?? 0
    );
    const selectedMask = Number(
      selectedTreatmentOption?.treatmentMask ?? selectedTreatmentOption?.maskTotal ?? 0
    );
    const isPackageStyleSelection =
      String(selectedTreatmentOption?.source || "").trim().toLowerCase() === "package" ||
      selectedSessions > 1 ||
      selectedMask > 0;

    if (!dateKey) {
      setSubmitError("กรุณาเลือกวันที่นัด");
      openGuideSpotlight("date", "ยังเลือกวันที่ไม่ครบ", "โปรดเลือกวันที่ก่อนบันทึก");
      resetStatus();
      return;
    }

    if (!cleanName) {
      setSubmitError("กรุณากรอกชื่อลูกค้า");
      openGuideSpotlight("customer", "ยังกรอกชื่อไม่ครบ", "ใส่ชื่อ-นามสกุลลูกค้าก่อนบันทึก");
      resetStatus();
      return;
    }

    if (!timeKey) {
      setSubmitError("กรุณาเลือกเวลานัด");
      openGuideSpotlight("time", "ยังเลือกเวลาไม่ครบ", "เลือกเวลาจองให้เรียบร้อยก่อนบันทึก");
      resetStatus();
      return;
    }

    if (!rawPhone) {
      setSubmitError("กรุณากรอกเบอร์โทร");
      openGuideSpotlight("phone", "ยังกรอกเบอร์โทรไม่ครบ", "ใส่เบอร์โทรลูกค้าก่อนบันทึก");
      resetStatus();
      return;
    }

    if (!treatmentOptionValues.has(treatmentItem) || !selectedTreatmentOption) {
      setSubmitError("กรุณาเลือกบริการจากรายการที่กำหนด");
      openGuideSpotlight("service", "ยังเลือกบริการไม่ครบ", "เลือกบริการจากรายการก่อนบันทึก");
      resetStatus();
      return;
    }

    if (!cleanTreatment) {
      setSubmitError("ยังไม่พบข้อความบริการ กรุณาเลือกบริการใหม่");
      openGuideSpotlight("service", "ข้อมูลบริการยังไม่ครบ", "เลือกบริการใหม่อีกครั้งเพื่อเติมข้อมูลให้ครบ");
      resetStatus();
      return;
    }

    if (isPackageStyleSelection && !cleanPackageId) {
      setSubmitError("บริการแบบคอร์สต้องมี package_id กรุณาเลือกบริการจากรายการอีกครั้ง");
      openGuideSpotlight(
        "service",
        "บริการคอร์สยังไม่ครบ",
        "รายการนี้ไม่มี package_id กรุณาเลือกบริการใหม่จากลิสต์"
      );
      resetStatus();
      return;
    }

    if (!cleanStaff) {
      setSubmitError("กรุณาเลือกผู้ให้บริการ");
      openGuideSpotlight("staff", "ยังเลือกผู้ให้บริการไม่ครบ", "เลือกผู้ให้บริการก่อนบันทึก");
      resetStatus();
      return;
    }

    if (!cleanPhone) {
      const message = "เบอร์โทรไม่ถูกต้อง";
      setPhoneError(message);
      setSubmitError(message);
      openGuideSpotlight("phone", "รูปแบบเบอร์โทรไม่ถูกต้อง", "กรอกเบอร์ 9-10 หลักที่ใช้งานได้");
      resetStatus();
      return;
    }

    if (rawLine && !cleanLine) {
      const message = "Line ID/Email ไม่ถูกต้อง";
      setLineIdError(message);
      setSubmitError(message);
      openGuideSpotlight("line", "Line ID / Email ไม่ถูกต้อง", "แก้รูปแบบ Line ID หรือ Email ให้ถูกต้อง");
      resetStatus();
      return;
    }

    if (timeError && !allowTimeOverride) {
      setSubmitError(timeError);
      openGuideSpotlight("time", "เวลานัดยังมีปัญหา", timeError);
      resetStatus();
      return;
    }

    const candidateMin = parseTimeToMinutes(timeKey);
    if (!Number.isFinite(candidateMin)) {
      setSubmitError("รูปแบบเวลาไม่ถูกต้อง");
      openGuideSpotlight("time", "รูปแบบเวลาไม่ถูกต้อง", "เลือกเวลาจากตัวเลือกหรือกรอก HH:MM");
      resetStatus();
      return;
    }
    const lastBookingMin = parseTimeToMinutes(TIME_CFG.lastBooking);
    if (!allowTimeOverride && Number.isFinite(lastBookingMin) && candidateMin > lastBookingMin) {
      setSubmitError("เวลาสุดท้ายในการจองคือ 19:00");
      openGuideSpotlight("time", "เลยเวลาปิดรับจอง", "กรุณาเลือกเวลาไม่เกิน 19:00");
      resetStatus();
      return;
    }

    const dayKey = normalizeDateString(dateKey);
    const rowsForDay = rows.filter((row) => normalizeDateString(row.date) === dayKey);
    const occupied = buildOccupiedRanges(rowsForDay, TIME_CFG);
    if (!allowTimeOverride && !isTimeAvailable(candidateMin, occupied, TIME_CFG)) {
      setSubmitError("ช่วงเวลานี้ชนกับคิวที่มีอยู่แล้ว กรุณาเลือกเวลาอื่น");
      openGuideSpotlight("time", "เวลานัดชนกับคิวอื่น", "เลือกช่วงเวลาอื่นที่ยังว่างอยู่");
      resetStatus();
      return;
    }

    const payload = {
      visit_date: dateKey,
      visit_time_text: timeKey,
      customer_full_name: cleanName,
      phone_raw: cleanPhone,
      email_or_lineid: cleanLine,
      treatment_item_text: cleanTreatment,
      staff_name: cleanStaff,
    };
    if (cleanTreatmentId) {
      payload.treatment_id = cleanTreatmentId;
    }
    if (cleanPackageId) {
      payload.package_id = cleanPackageId;
    }

    setSaving(true);
    try {
      // Endpoint: POST /api/appointments
      // Identifier flow: backend returns appointment_id; subsequent queue reads return the same id as row.appointment_id.
      await appendAppointment(payload, overrideMeta ? { override: overrideMeta } : undefined);
      setSubmitSuccess("บันทึกแล้ว");
      setGuideSpotlight(null);
      setBookingTime("");
      setCustomerName("");
      setPhone("");
      setLineId("");
      setStatusMode("success");
      await loadAppointments();
    } catch (err) {
      setSubmitError(err?.message || "บันทึกไม่สำเร็จ");
      setStatusMode("error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClick = useCallback(() => {
    if (!isAdmin) {
      handleSaveBooking();
      return;
    }

    const violations = collectTimeConstraintViolations();
    if (violations.length === 0) {
      handleSaveBooking();
      return;
    }

    setOverrideViolations(violations);
    setOverridePassword("");
    setOverrideModalOpen(true);
  }, [collectTimeConstraintViolations, handleSaveBooking, isAdmin]);

  const handleCancelOverride = useCallback(() => {
    setOverrideModalOpen(false);
    setOverridePassword("");
    setOverrideViolations([]);
  }, []);

  const handleConfirmOverride = useCallback(() => {
    if (overridePassword !== "123123") return;

    const overrideMeta = {
      is_override: true,
      reason: "ADMIN_OVERRIDE",
      violations: overrideViolations.map((item) => item.key),
      confirmed_at: new Date().toISOString(),
    };

    setOverrideModalOpen(false);
    setOverridePassword("");
    setOverrideViolations([]);
    handleSaveBooking({ override: overrideMeta });
  }, [handleSaveBooking, overridePassword, overrideViolations]);

  const handleBookingDateChange = useCallback((value) => {
    setBookingDate(value);
    setSubmitError("");
    setSubmitSuccess("");
    clearGuideIfField("date");
  }, [clearGuideIfField]);

  const handleCustomerNameChange = useCallback((value) => {
    setCustomerName(value);
    clearGuideIfField("customer");
  }, [clearGuideIfField]);

  const handleBookingTimeChange = useCallback((value) => {
    setBookingTime(value);
    clearGuideIfField("time");
  }, [clearGuideIfField]);

  const handlePickRecommendedSlot = useCallback((slot) => {
    setBookingTime(slot);
    clearGuideIfField("time");
  }, [clearGuideIfField]);

  const handlePhoneChange = useCallback((rawValue) => {
    const digitsOnly = rawValue.replace(/\D+/g, "").slice(0, 11);
    setPhone(digitsOnly);
    setPhoneError("");
    clearGuideIfField("phone");
  }, [clearGuideIfField]);

  const handleLineIdChange = useCallback((value) => {
    setLineId(value);
    setLineIdError("");
    clearGuideIfField("line");
  }, [clearGuideIfField]);

  const handleTreatmentChange = useCallback((value) => {
    setTreatmentItem(value);
    clearGuideIfField("service");
  }, [clearGuideIfField]);

  const handleStaffChange = useCallback((value) => {
    setStaffName(value);
    clearGuideIfField("staff");
  }, [clearGuideIfField]);

  const isQueueTab = activeTab === "queue";
  const isQueueInitialLoading = isQueueTab && !queueHasLoadedOnce;
  const isCustomersInitialLoading = !isQueueTab && !customersHasLoadedOnce;
  const isPageOverlayOpen = isQueueInitialLoading || isCustomersInitialLoading;
  const queuePanelLoading = loading || !queueHasLoadedOnce;
  const customerPanelLoading = customersLoading || !customersHasLoadedOnce;

  return (
    <section className="booking-page">
      <div className="booking-grid" aria-busy={isPageOverlayOpen ? "true" : undefined}>
        <section className="booking-panel">
          <BookingTabs activeTab={activeTab} onSelectTab={setActiveTab} />
          <div className="booking-panel-body">
            {activeTab === "queue" ? (
              <QueuePanel
                queueDateFilter={queueDateFilter}
                onChangeQueueDateFilter={setQueueDateFilter}
                onClearQueueDateFilter={() => setQueueDateFilter("")}
                loading={queuePanelLoading}
                error={error}
                rows={filteredRows}
                onOpenServiceModal={handleOpenServiceModal}
                formatAppointmentStatus={formatAppointmentStatus}
                canManageTestRecords={isAdmin}
              />
            ) : (
              <CustomerPanel
                customersLoading={customerPanelLoading}
                customersError={customersError}
                customers={customers}
                shortenId={shortenId}
                onOpenEditModal={handleOpenEditModal}
                canManageTestRecords={isAdmin}
              />
            )}
          </div>
        </section>

        <BookingFormPanel
          bookingDate={bookingDate}
          onBookingDateChange={handleBookingDateChange}
          customerName={customerName}
          onCustomerNameChange={handleCustomerNameChange}
          bookingTime={bookingTime}
          onBookingTimeChange={handleBookingTimeChange}
          recommendedSlots={recommendedSlots}
          onPickRecommendedSlot={handlePickRecommendedSlot}
          timeError={timeError}
          phone={phone}
          onPhoneChange={handlePhoneChange}
          phoneError={phoneError}
          lineId={lineId}
          onLineIdChange={handleLineIdChange}
          lineIdError={lineIdError}
          treatmentOptions={treatmentOptions}
          treatmentItem={treatmentItem}
          onTreatmentChange={handleTreatmentChange}
          treatmentOptionsError={treatmentOptionsError}
          staffName={staffName}
          onStaffChange={handleStaffChange}
          saving={saving}
          allowTimeOverride={isAdmin}
          submitError={submitError}
          submitSuccess={submitSuccess}
          onSave={handleSaveClick}
          guideSpotlight={guideSpotlight}
          onDismissGuide={clearGuideSpotlight}
          onFocusGuideField={focusGuideField}
          SELECT_STYLES={SELECT_STYLES}
        />
        <LoadingOverlay
          open={isPageOverlayOpen}
          label="กำลังโหลดข้อมูล..."
          subtext="โปรดรอสักครู่"
        />
      </div>
      <AdminOverrideModal
        open={overrideModalOpen}
        violations={overrideViolations}
        password={overridePassword}
        onPasswordChange={setOverridePassword}
        onCancel={handleCancelOverride}
        onConfirm={handleConfirmOverride}
      />
      {statusOpen && (
        <StatusOverlay open={statusOpen} mode={statusMode} onClose={handleCloseStatus} />
      )}
      <CustomerProfileModal
        open={isEditModalOpen}
        onClose={handleCloseEditModal}
        customer={selectedCustomer}
        profileData={customerProfile}
        loading={customerProfileLoading}
        error={customerProfileError}
        onRetry={() =>
          loadCustomerProfile(selectedCustomer?.id, undefined, { useCache: false })
        }
      />

      <ServiceConfirmationModal
        open={serviceModalOpen}
        onClose={handleCloseServiceModal}
        booking={selectedBookingRow}
        currentUser={me}
        onAfterAction={loadAppointments}
      />
    </section>
  );
}
