import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
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
import CustomerProfileModal from "../components/CustomerProfileModal";
import ServiceConfirmationModal from "../components/ServiceConfirmationModal";
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

export default function Bookingpage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState(null);
  const [customersLoaded, setCustomersLoaded] = useState(false);
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
  const [saving, setSaving] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusMode, setStatusMode] = useState("idle");
  const [activeTab, setActiveTab] = useState("queue");
  const treatmentOptionValues = useMemo(
    () => new Set(treatmentOptions.map((option) => option.value)),
    [treatmentOptions]
  );
  const [me, setMe] = useState(null);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [selectedBookingRow, setSelectedBookingRow] = useState(null);

  const resetStatus = useCallback(() => {
    setStatusOpen(false);
    setStatusMode("idle");
  }, []);

  const hardReloadToWorkbench = useCallback(() => {
    const target = "https://akcd1998.github.io/scGlamLiff-reception/#/workbench";
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
    try {
      const data = await getAppointmentsQueue({ limit: 200 }, signal);
      const normalized = (data.rows || []).map(normalizeRow);
      setRows(normalized);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError(err?.message || "Error loading appointments");
      setRows([]);
    } finally {
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
    try {
      const data = await getCustomers(signal);
      const normalized = (data.rows || []).map(normalizeCustomerRow);
      setCustomers(normalized);
      setCustomersLoaded(true);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setCustomersError(err?.message || "Error loading customers");
      setCustomers([]);
      setCustomersLoaded(true);
    } finally {
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
    setSelectedBookingRow(row);
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

  const handleSaveBooking = async () => {
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

    if (!dateKey || !timeKey || !cleanName || !rawPhone || !cleanTreatment || !cleanStaff) {
      setSubmitError("กรุณากรอกข้อมูลที่จำเป็นให้ครบ");
      resetStatus();
      return;
    }

    if (!cleanPhone) {
      const message = "เบอร์โทรไม่ถูกต้อง";
      setPhoneError(message);
      setSubmitError(message);
      resetStatus();
      return;
    }

    if (rawLine && !cleanLine) {
      const message = "Line ID/Email ไม่ถูกต้อง";
      setLineIdError(message);
      setSubmitError(message);
      resetStatus();
      return;
    }

    if (!treatmentOptionValues.has(treatmentItem) || !selectedTreatmentOption) {
      setSubmitError("กรุณาเลือกบริการจากรายการที่กำหนด");
      resetStatus();
      return;
    }

    if (isPastBooking) {
      setSubmitError("ไม่สามารถจองย้อนหลังได้");
      resetStatus();
      return;
    }

    if (timeError) {
      setSubmitError(timeError);
      resetStatus();
      return;
    }

    const candidateMin = parseTimeToMinutes(timeKey);
    if (!Number.isFinite(candidateMin)) {
      setSubmitError("รูปแบบเวลาไม่ถูกต้อง");
      resetStatus();
      return;
    }
    const lastBookingMin = parseTimeToMinutes(TIME_CFG.lastBooking);
    if (Number.isFinite(lastBookingMin) && candidateMin > lastBookingMin) {
      setSubmitError("เวลาสุดท้ายในการจองคือ 19:00");
      resetStatus();
      return;
    }

    const dayKey = normalizeDateString(dateKey);
    const rowsForDay = rows.filter((row) => normalizeDateString(row.date) === dayKey);
    const occupied = buildOccupiedRanges(rowsForDay, TIME_CFG);
    if (!isTimeAvailable(candidateMin, occupied, TIME_CFG)) {
      setSubmitError("ช่วงเวลานี้ชนกับคิวที่มีอยู่แล้ว กรุณาเลือกเวลาอื่น");
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
      await appendAppointment(payload);
      setSubmitSuccess("บันทึกแล้ว");
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

  return (
    <section className="booking-page">
      <div className="booking-grid">
        <section className="booking-panel">
          <div className="booking-panel-header booking-tab-header">
            <div className="booking-tabs" role="tablist" aria-label="Booking tabs">
              <button
                type="button"
                id="booking-tab-queue"
                role="tab"
                aria-selected={activeTab === "queue"}
                aria-controls="booking-panel-queue"
                className={`booking-tab ${activeTab === "queue" ? "active" : ""}`}
                onClick={() => setActiveTab("queue")}
              >
                คิวให้บริการ
              </button>
              <button
                type="button"
                id="booking-tab-customer"
                role="tab"
                aria-selected={activeTab === "customer"}
                aria-controls="booking-panel-customer"
                className={`booking-tab ${activeTab === "customer" ? "active" : ""}`}
                onClick={() => setActiveTab("customer")}
              >
                ข้อมูลลูกค้า
              </button>
            </div>
          </div>
          <div className="booking-panel-body">
            {activeTab === "queue" ? (
              <div
                id="booking-panel-queue"
                role="tabpanel"
                aria-labelledby="booking-tab-queue"
              >
                <div className="booking-queue-filter">
                  <div className="booking-field booking-queue-filter-field">
                    <label htmlFor="queue-filter-date">กรองตามวันที่</label>
                    <input
                      id="queue-filter-date"
                      type="date"
                      value={queueDateFilter}
                      onChange={(event) => setQueueDateFilter(event.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="booking-queue-filter-clear"
                    onClick={() => setQueueDateFilter("")}
                    disabled={!queueDateFilter}
                  >
                    แสดงทั้งหมด
                  </button>
                </div>
                <table className="booking-table">
                  <thead>
                    <tr>
                      <th className="booking-table-check" aria-label="เลือกคิว" />
                      <th>เวลาจอง</th>
                      <th>ชื่อ-นามสกุล ลูกค้า</th>
                      <th>โทรศัพท์</th>
                      <th>Treatment item</th>
                      <th>Staff Name</th>
                      <th>สถานะลูกค้า</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan="7">กำลังโหลด...</td>
                      </tr>
                    ) : error ? (
                      <tr>
                        <td colSpan="7">เกิดข้อผิดพลาด: {error}</td>
                      </tr>
                    ) : filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan="7">ไม่มีข้อมูล</td>
                      </tr>
                    ) : (
                      filteredRows.map((row, idx) => (
                        <tr key={`${row.bookingTime}-${row.customerName}-${idx}`}>
                          <td className="booking-table-check">
                            <label className="booking-check">
                              <input
                                type="checkbox"
                                className="booking-check-input"
                                checked={false}
                                readOnly
                                aria-label={`Confirm service for ${row.customerName || "customer"} ${row.bookingTime || ""}`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  handleOpenServiceModal(row);
                                }}
                              />
                              <span className="booking-check-box" aria-hidden="true" />
                            </label>
                          </td>
                          <td>{row.bookingTime}</td>
                          <td>{row.customerName}</td>
                          <td>{row.phone}</td>
                          <td>{row.treatmentItem}</td>
                          <td>{row.staffName}</td>
                          <td className="booking-table-status">
                            {formatAppointmentStatus(row.status)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div
                id="booking-panel-customer"
                role="tabpanel"
                aria-labelledby="booking-tab-customer"
              >
                <table className="booking-table">
                  <thead>
                    <tr>
                      <th>Customer ID</th>
                      <th>Full name</th>
                      <th>Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customersLoading ? (
                      <tr>
                        <td colSpan="3">กำลังโหลด...</td>
                      </tr>
                    ) : customersError ? (
                      <tr>
                        <td colSpan="3">เกิดข้อผิดพลาด: {customersError}</td>
                      </tr>
                    ) : customers.length === 0 ? (
                      <tr>
                        <td colSpan="3">ไม่มีข้อมูล</td>
                      </tr>
                    ) : (
                      customers.map((customer) => (
                        <tr key={customer.id || customer.fullName}>
                          <td title={customer.id}>{shortenId(customer.id)}</td>
                          <td>{customer.fullName}</td>
                          <td>
                            <button
                              type="button"
                              className="booking-edit-button"
                              aria-label="Edit customer"
                              onClick={() => handleOpenEditModal(customer)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                className="booking-edit-icon"
                              >
                                <path
                                  d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75L3 17.25z"
                                  fill="currentColor"
                                />
                                <path
                                  d="M20.71 6.04a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75 1.13-1.13z"
                                  fill="currentColor"
                                />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="booking-panel">
          <div className="booking-panel-header">+ เพิ่มบริการจองคิว</div>
          <div className="booking-panel-body">
            <form className="booking-form">
              <div className="booking-card">
                <div className="booking-row">
                  <div className="booking-field">
                    <label htmlFor="booking-date">
                      วันที่ <span className="booking-required">*</span>
                    </label>
                    <input
                      id="booking-date"
                      type="date"
                      value={bookingDate}
                      onChange={(event) => {
                        setBookingDate(event.target.value);
                        setSubmitError("");
                        setSubmitSuccess("");
                      }}
                    />
                  </div>
                  <div className="booking-field">
                    <label htmlFor="booking-name">
                      ชื่อ-นามสกุล <span className="booking-required">*</span>
                    </label>
                    <input
                      id="booking-name"
                      type="text"
                      placeholder="ชื่อผู้จอง"
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                    />
                  </div>
                </div>

                <div className="booking-row">
                  <div className="booking-time-card">
                    <label htmlFor="booking-time">
                      เวลา <span className="booking-required">*</span>
                    </label>
                    <div className="booking-time-input">
                      <input
                        id="booking-time"
                        type="time"
                        value={bookingTime}
                        onChange={(event) => setBookingTime(event.target.value)}
                      />
                      <span className="booking-time-icon" aria-hidden="true">▾</span>
                    </div>
                    {timeError && (
                      <div className="booking-time-error">{timeError}</div>
                    )}
                    <div className="booking-time-suggest">
                      <div className="booking-time-suggest-header">ช่วงเวลาที่แนะนำ</div>
                      {recommendedSlots.length === 0 ? (
                        <div className="booking-time-empty">
                          วันนี้/วันดังกล่าวไม่มีช่วงเวลาว่างตามเงื่อนไขแล้ว
                        </div>
                      ) : (
                        <div className="booking-time-slots">
                          {recommendedSlots.map((slot) => (
                            <button
                              key={slot}
                              type="button"
                              className="slot-chip"
                              onClick={() => setBookingTime(slot)}
                            >
                              {slot}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="booking-field">
                    <label htmlFor="booking-phone">
                      เบอร์โทร <span className="booking-required">*</span>
                    </label>
                    <input
                      id="booking-phone"
                      type="tel"
                      placeholder="08x-xxx-xxxx"
                      inputMode="numeric"
                      maxLength={11}
                      value={phone}
                      onChange={(event) => {
                        const digitsOnly = event.target.value.replace(/\D+/g, "").slice(0, 11);
                        setPhone(digitsOnly);
                        setPhoneError("");
                      }}
                    />
                    {phoneError && (
                      <div className="booking-time-error">{phoneError}</div>
                    )}
                  </div>
                </div>

                <hr className="booking-divider" />

                <div className="booking-row">
                  <div className="booking-field booking-spacer" aria-hidden="true" />
                  <div className="booking-field">
                    <label htmlFor="booking-line">ไลน์ไอดี</label>
                    <input
                      id="booking-line"
                      type="text"
                      placeholder="Line ID"
                      value={lineId}
                      onChange={(event) => {
                        setLineId(event.target.value);
                        setLineIdError("");
                      }}
                    />
                    {lineIdError && (
                      <div className="booking-time-error">{lineIdError}</div>
                    )}
                  </div>
                </div>

                <div className="booking-row">
                  <div className="booking-field">
                    <label htmlFor="booking-service">
                      บริการที่เลือกใช้ <span className="booking-required">*</span>
                    </label>
                    <Select
                      inputId="booking-service"
                      instanceId="booking-service"
                      isSearchable={true}
                      options={treatmentOptions}
                      value={
                        treatmentOptions.find(
                          (option) => option.value === treatmentItem
                        ) || null
                      }
                      onChange={(option) => setTreatmentItem(option?.value || "")}
                      placeholder="พิมพ์เพื่อค้นหา..."
                      menuPortalTarget={document.body}
                      menuPosition="fixed"
                      styles={SELECT_STYLES}
                    />
                    {treatmentOptionsError && (
                      <div className="booking-time-error">{treatmentOptionsError}</div>
                    )}
                  </div>
                  <div className="booking-field">
                    <label htmlFor="booking-provider">
                      ผู้ให้บริการ <span className="booking-required">*</span>
                    </label>
                    <select
                      id="booking-provider"
                      value={staffName}
                      onChange={(event) => setStaffName(event.target.value)}
                    >
                      <option>ส้ม</option>
                      <option>โบว์</option>
                      <option>เบนซ์</option>
                      <option>แพร</option>
                    </select>
                  </div>
                </div>

                <div className="booking-actions">
                  <button
                    type="button"
                    className="booking-save-btn"
                    onClick={handleSaveBooking}
                    disabled={saving || isPastBooking || Boolean(timeError)}
                  >
                    {saving ? "กำลังบันทึก..." : "บันทึกข้อมูลการจอง"}
                  </button>
                  {submitError && (
                    <div className="booking-submit-error">{submitError}</div>
                  )}
                  {submitSuccess && (
                    <div className="booking-submit-success">{submitSuccess}</div>
                  )}
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
      {statusOpen && (
        <div className="status-overlay" role="dialog" aria-modal="true">
          <div className="status-card">
            {statusMode === "loading" ? (
              <>
                <div className="status-spinner" aria-hidden="true" />
                <div className="status-message">กำลังส่งข้อมูล...</div>
              </>
            ) : (
              <>
                <div className={`status-icon ${statusMode === "success" ? "success" : "error"}`}>
                  {statusMode === "success" ? (
                    <svg className="status-svg" viewBox="0 0 52 52" aria-hidden="true">
                      <circle className="status-circle" cx="26" cy="26" r="24" fill="none" />
                      <path
                        className="status-check"
                        fill="none"
                        d="M14 27l7 7 17-17"
                      />
                    </svg>
                  ) : (
                    <svg className="status-svg" viewBox="0 0 52 52" aria-hidden="true">
                      <circle className="status-circle" cx="26" cy="26" r="24" fill="none" />
                      <path
                        className="status-cross"
                        fill="none"
                        d="M17 17l18 18M35 17L17 35"
                      />
                    </svg>
                  )}
                </div>
                <div className="status-message">
                  {statusMode === "success" ? (
                    <>
                      บันทึกการจองเรียบร้อย
                      <br />
                      ระบบกำลังพากลับไปหน้า Workbench
                    </>
                  ) : (
                    <>บันทึกไม่สำเร็จ กรุณาลองใหม่</>
                  )}
                </div>
                <button className="status-button" type="button" onClick={handleCloseStatus}>
                  ปิด
                </button>
              </>
            )}
          </div>
        </div>
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
