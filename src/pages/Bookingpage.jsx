import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "react-select";
import {
  buildOccupiedRanges,
  formatDateKey,
  getRecommendedSlotsWithAvailability,
  isTimeAvailable,
  normalizeBookingTime,
  normalizeDateString,
  parseTimeToMinutes,
  toDmyDate,
  toIsoDateFromDDMMYYYY,
} from "../utils/bookingTimeUtils";
import { appendAppointment, getAppointments } from "../utils/appointmentsApi";
import "./Bookingpage.css";

function normalizeRow(row = {}) {
  return {
    date: row.date ?? "",
    bookingTime: row.bookingTime ?? "",
    customerName: row.customerName ?? "",
    phone: row.phone ?? "",
    treatmentItem: row.treatmentItem ?? "",
    staffName: row.staffName ?? "",
    datetime: row.datetime ?? "",
  };
}

function getRowTimestamp(row) {
  const dateKey = normalizeDateString(row.date);
  if (dateKey) {
    const timeMinutes = parseTimeToMinutes(row.bookingTime);
    if (Number.isFinite(timeMinutes)) {
      const [yyyy, mm, dd] = dateKey.split("-").map((p) => Number(p));
      if (yyyy && mm && dd) {
        const base = new Date(yyyy, mm - 1, dd);
        base.setHours(Math.floor(timeMinutes / 60), timeMinutes % 60, 0, 0);
        return base.getTime();
      }
    }
    const fallback = Date.parse(dateKey);
    if (!Number.isNaN(fallback)) return fallback;
  }
  const dt = Date.parse(row.datetime || "");
  return Number.isNaN(dt) ? 0 : dt;
}

const TIME_CFG = {
  open: "08:00",
  close: "20:00",
  lastBooking: "19:00",
  intervalMin: 120,
  leadTimeMin: 60,
  serviceDurationMin: 30,
  bufferAfterMin: 15,
  slotBlockMin: 45,
  maxRecommend: 6,
};

function buildTreatmentOptions() {
  const options = [
    { value: "smooth 399 free", label: "Smooth 399 thb" },
    { value: "renew 599", label: "Renew 599 thb" },
    { value: "acne care 899", label: "Acne Care 899 thb" },
  ];

  for (let progress = 1; progress <= 3; progress += 1) {
    options.push({
      value: `${progress}/3 smooth 999 1 mask`,
      label: `${progress}/3 Smooth 999 thb 1 mask`,
    });
  }

  for (let session = 1; session <= 10; session += 1) {
    for (let mask = 1; mask <= 3; mask += 1) {
      options.push({
        value: `${session}/10 smooth 2999 ${mask}/3 mask`,
        label: `${session}/10 Smooth 2999 thb ${mask}/3 mask`,
      });
    }
  }

  return options;
}

const SELECT_STYLES = {
  container: (base) => ({ ...base, width: "100%" }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  menu: (base) => ({ ...base, zIndex: 9999 }),
};

export default function Bookingpage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterDate, setFilterDate] = useState(() => formatDateKey(new Date()));
  const [bookingTime, setBookingTime] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [lineId, setLineId] = useState("");
  const [treatmentItem, setTreatmentItem] = useState("smooth 399 free");
  const [staffName, setStaffName] = useState("ส้ม");
  const [timeError, setTimeError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const treatmentOptions = useMemo(() => buildTreatmentOptions(), []);

  const loadAppointments = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAppointments(200, signal);
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

  const filteredRows = useMemo(() => {
    const target = filterDate ? normalizeDateString(filterDate) : "";
    const list = target
      ? rows.filter((row) => normalizeDateString(row.date) === target)
      : rows;
    return [...list].sort((a, b) => getRowTimestamp(b) - getRowTimestamp(a));
  }, [rows, filterDate]);

  const selectedDateObj = useMemo(() => {
    const key = normalizeDateString(filterDate);
    if (!key) return null;
    return new Date(`${key}T00:00:00`);
  }, [filterDate]);

  const occupiedRanges = useMemo(() => {
    const key = normalizeDateString(filterDate);
    if (!key) return [];
    const rowsForDay = rows.filter((row) => normalizeDateString(row.date) === key);
    return buildOccupiedRanges(rowsForDay, TIME_CFG);
  }, [rows, filterDate]);

  const recommendedSlots = useMemo(() => {
    if (!selectedDateObj) return [];
    return getRecommendedSlotsWithAvailability({
      selectedDate: selectedDateObj,
      now: new Date(),
      rows,
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
    if (!filterDate) return false;
    const parts = normalizeDateString(filterDate).split("-");
    if (parts.length !== 3) return false;
    const [yyyy, mm, dd] = parts.map((p) => Number(p));
    if (!yyyy || !mm || !dd) return false;
    const selectedDay = new Date(yyyy, mm - 1, dd);
    selectedDay.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return selectedDay.getTime() < today.getTime();
  }, [filterDate]);

  const isPastBooking = useMemo(() => {
    if (isPastDate) return true;
    if (!filterDate || !bookingTime) return false;
    const dateKey = toIsoDateFromDDMMYYYY(filterDate);
    const timeKey = normalizeBookingTime(bookingTime);
    if (!dateKey || !timeKey) return false;
    const dateTime = new Date(`${dateKey}T${timeKey}:00`);
    if (Number.isNaN(dateTime.getTime())) return false;
    return dateTime.getTime() < Date.now();
  }, [filterDate, bookingTime, isPastDate]);

  const handleSaveBooking = async () => {
    if (saving) return;
    setSubmitError("");
    setSubmitSuccess("");

    const dateKey = toIsoDateFromDDMMYYYY(filterDate);
    const timeKey = normalizeBookingTime(bookingTime);
    const cleanName = customerName.trim();
    const cleanPhone = phone.trim();
    const cleanLine = lineId.trim();
    const cleanTreatment = treatmentItem.trim();
    const cleanStaff = staffName.trim();

    if (!dateKey || !timeKey || !cleanName || !cleanPhone || !cleanTreatment || !cleanStaff) {
      setSubmitError("กรุณากรอกข้อมูลที่จำเป็นให้ครบ");
      return;
    }

    if (isPastBooking) {
      setSubmitError("ไม่สามารถจองย้อนหลังได้");
      return;
    }

    if (timeError) {
      setSubmitError(timeError);
      return;
    }

    const candidateMin = parseTimeToMinutes(timeKey);
    if (!Number.isFinite(candidateMin)) {
      setSubmitError("รูปแบบเวลาไม่ถูกต้อง");
      return;
    }
    const lastBookingMin = parseTimeToMinutes(TIME_CFG.lastBooking);
    if (Number.isFinite(lastBookingMin) && candidateMin > lastBookingMin) {
      setSubmitError("เวลาสุดท้ายในการจองคือ 19:00");
      return;
    }

    const dayKey = normalizeDateString(dateKey);
    const rowsForDay = rows.filter((row) => normalizeDateString(row.date) === dayKey);
    const occupied = buildOccupiedRanges(rowsForDay, TIME_CFG);
    if (!isTimeAvailable(candidateMin, occupied, TIME_CFG)) {
      setSubmitError("ช่วงเวลานี้ชนกับคิวที่มีอยู่แล้ว กรุณาเลือกเวลาอื่น");
      return;
    }

    const payload = {
      date: toDmyDate(dateKey),
      bookingTime: timeKey,
      customerName: cleanName,
      phone: cleanPhone,
      lineId: cleanLine,
      treatmentItem: cleanTreatment,
      staffName: cleanStaff,
    };

    setSaving(true);
    try {
      await appendAppointment(payload);
      setSubmitSuccess("บันทึกแล้ว");
      setBookingTime("");
      setCustomerName("");
      setPhone("");
      setLineId("");
      await loadAppointments();
    } catch (err) {
      setSubmitError(err?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="booking-page">
      <div className="booking-grid">
        <section className="booking-panel">
          <div className="booking-panel-header">คิวให้บริการของวันนี้</div>
          <div className="booking-panel-body">
            <table className="booking-table">
              <thead>
                <tr>
                  <th>เวลาจอง</th>
                  <th>ชื่อ-นามสกุล ลูกค้า</th>
                  <th>โทรศัพท์</th>
                  <th>Treatment item</th>
                  <th>Staff Name</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5">กำลังโหลด...</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan="5">เกิดข้อผิดพลาด: {error}</td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan="5">ไม่มีข้อมูล</td>
                  </tr>
                ) : (
                  filteredRows.map((row, idx) => (
                    <tr key={`${row.bookingTime}-${row.customerName}-${idx}`}>
                      <td>{row.bookingTime}</td>
                      <td>{row.customerName}</td>
                      <td>{row.phone}</td>
                      <td>{row.treatmentItem}</td>
                      <td>{row.staffName}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
                      value={filterDate}
                      onChange={(event) => {
                        setFilterDate(event.target.value);
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
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                    />
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
                      onChange={(event) => setLineId(event.target.value)}
                    />
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
    </section>
  );
}
