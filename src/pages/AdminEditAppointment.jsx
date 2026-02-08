import { useMemo, useState } from "react";
import {
  getAdminAppointmentById,
  patchAdminAppointment,
} from "../utils/appointmentsApi";
import "./AdminEditAppointment.css";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINE_ID_PATTERN = /^[a-zA-Z0-9._-]{1,50}$/;
const ALLOWED_STATUSES = new Set([
  "booked",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isUuid(value) {
  return UUID_PATTERN.test(String(value || "").trim());
}

function normalizeStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "canceled") return "cancelled";
  return normalized;
}

function formatStatus(status) {
  const value = normalizeStatus(status);
  if (value === "booked") return "booked";
  if (value === "completed") return "completed";
  if (value === "cancelled") return "cancelled";
  if (value === "no_show") return "no_show";
  if (value === "rescheduled") return "rescheduled";
  return value || "-";
}

function toBangkokLocalValue(iso) {
  const raw = String(iso || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const bangkokDate = new Date(date.getTime() + bangkokOffsetMs);
  return `${bangkokDate.getUTCFullYear()}-${pad2(bangkokDate.getUTCMonth() + 1)}-${pad2(
    bangkokDate.getUTCDate()
  )}T${pad2(bangkokDate.getUTCHours())}:${pad2(bangkokDate.getUTCMinutes())}`;
}

function toBangkokIso(datetimeLocal) {
  const raw = String(datetimeLocal || "").trim();
  if (!raw) return "";
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) return raw;
  if (raw.length === 16) return `${raw}:00+07:00`;
  if (raw.length === 19) return `${raw}+07:00`;
  return `${raw}+07:00`;
}

function normalizeThaiPhone(input) {
  const digits = String(input || "").replace(/\D+/g, "");
  if (!digits) return "";

  if (digits.startsWith("66") && digits.length === 11) {
    return `0${digits.slice(-9)}`;
  }
  if (digits.length === 9 && digits.startsWith("02")) {
    return digits;
  }
  if (digits.length === 9 && !digits.startsWith("0")) {
    return `0${digits}`;
  }
  if (digits.length === 10 && digits.startsWith("0")) {
    return digits;
  }
  return "";
}

function sanitizeEmailOrLine(value) {
  const text = String(value || "").trim();
  if (!text) return { ok: true, value: "" };

  if (text.includes("@")) {
    if (!EMAIL_PATTERN.test(text)) {
      return { ok: false, error: "รูปแบบ Email ไม่ถูกต้อง" };
    }
    return { ok: true, value: text };
  }

  if (!LINE_ID_PATTERN.test(text)) {
    return { ok: false, error: "รูปแบบ Line ID ไม่ถูกต้อง" };
  }
  return { ok: true, value: text };
}

function isAdminRole(roleName) {
  const role = String(roleName || "").trim().toLowerCase();
  return role === "admin" || role === "owner";
}

function buildDiffRow(field, beforeValue, afterValue) {
  return {
    field,
    before: beforeValue === "" || beforeValue === null || beforeValue === undefined ? "-" : String(beforeValue),
    after: afterValue === "" || afterValue === null || afterValue === undefined ? "-" : String(afterValue),
  };
}

export default function AdminEditAppointment({ currentUser }) {
  const isAdmin = useMemo(() => isAdminRole(currentUser?.role_name), [currentUser]);

  const [appointmentIdInput, setAppointmentIdInput] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [appointment, setAppointment] = useState(null);
  const [activePackages, setActivePackages] = useState([]);

  const [scheduledAtLocal, setScheduledAtLocal] = useState("");
  const [branchId, setBranchId] = useState("");
  const [treatmentId, setTreatmentId] = useState("");
  const [status, setStatus] = useState("booked");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [emailOrLineid, setEmailOrLineid] = useState("");
  const [reason, setReason] = useState("");
  const [rawSheetUuid, setRawSheetUuid] = useState("");

  const [createPackageUsage, setCreatePackageUsage] = useState(false);
  const [customerPackageId, setCustomerPackageId] = useState("");
  const [usedMask, setUsedMask] = useState(false);

  const [enableRawSheetDanger, setEnableRawSheetDanger] = useState(false);
  const [confirmRawSheetChange, setConfirmRawSheetChange] = useState(false);
  const [confirmRawSheetAck, setConfirmRawSheetAck] = useState(false);
  const [confirmCancelledToCompleted, setConfirmCancelledToCompleted] = useState(false);

  const [submitError, setSubmitError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState(null);
  const [diffRows, setDiffRows] = useState([]);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusMode, setStatusMode] = useState("idle");
  const [result, setResult] = useState(null);

  const currentStatusNormalized = normalizeStatus(appointment?.status);
  const selectedStatusNormalized = normalizeStatus(status);
  const requiresCancelledToCompletedConfirm =
    currentStatusNormalized === "cancelled" && selectedStatusNormalized === "completed";

  const applyLoadedData = (data) => {
    const appt = data?.appointment || null;
    const packages = Array.isArray(data?.active_packages) ? data.active_packages : [];
    setAppointment(appt);
    setActivePackages(packages);

    setScheduledAtLocal(toBangkokLocalValue(appt?.scheduled_at));
    setBranchId(String(appt?.branch_id || ""));
    setTreatmentId(String(appt?.treatment_id || ""));
    setStatus(normalizeStatus(appt?.status) || "booked");
    setCustomerName(String(appt?.customer_full_name || ""));
    setPhone(String(appt?.phone || ""));
    setEmailOrLineid(String(appt?.email_or_lineid || ""));
    setRawSheetUuid(String(appt?.raw_sheet_uuid || ""));
    setReason("");
    setCreatePackageUsage(false);
    setCustomerPackageId(String(packages[0]?.customer_package_id || ""));
    setUsedMask(false);
    setEnableRawSheetDanger(false);
    setConfirmRawSheetChange(false);
    setConfirmRawSheetAck(false);
    setConfirmCancelledToCompleted(false);
    setSubmitError("");
    setLookupError("");
  };

  const loadAppointment = async () => {
    setLookupError("");
    setSubmitError("");
    const id = String(appointmentIdInput || "").trim();
    if (!isUuid(id)) {
      setLookupError("appointment_id ไม่ถูกต้อง");
      return;
    }

    try {
      setLoadingDetail(true);
      const data = await getAdminAppointmentById(id);
      applyLoadedData(data);
    } catch (err) {
      setLookupError(err?.message || "โหลดข้อมูลนัดหมายไม่สำเร็จ");
      setAppointment(null);
      setActivePackages([]);
    } finally {
      setLoadingDetail(false);
    }
  };

  const buildPatchPayload = () => {
    if (!appointment) return { error: "ยังไม่ได้โหลด appointment" };

    const payload = {};
    const diffs = [];
    const cleanReason = String(reason || "").trim();

    if (!cleanReason || cleanReason.length < 5) {
      return { error: "กรุณากรอก reason อย่างน้อย 5 ตัวอักษร" };
    }
    payload.reason = cleanReason;

    const nextScheduledAt = toBangkokIso(scheduledAtLocal);
    const nextScheduledDate = new Date(nextScheduledAt);
    const currentScheduledDate = new Date(appointment.scheduled_at || "");
    if (!nextScheduledAt || Number.isNaN(nextScheduledDate.getTime())) {
      return { error: "scheduled_at ไม่ถูกต้อง" };
    }
    if (
      Number.isNaN(currentScheduledDate.getTime()) ||
      nextScheduledDate.getTime() !== currentScheduledDate.getTime()
    ) {
      payload.scheduled_at = nextScheduledAt;
      diffs.push(buildDiffRow("scheduled_at", appointment.scheduled_at, nextScheduledAt));
    }

    const cleanBranch = String(branchId || "").trim();
    if (!cleanBranch) return { error: "branch_id ห้ามว่าง" };
    if (cleanBranch !== String(appointment.branch_id || "").trim()) {
      payload.branch_id = cleanBranch;
      diffs.push(buildDiffRow("branch_id", appointment.branch_id, cleanBranch));
    }

    const cleanTreatment = String(treatmentId || "").trim();
    if (!cleanTreatment || !isUuid(cleanTreatment)) {
      return { error: "treatment_id ต้องเป็น UUID" };
    }
    if (cleanTreatment !== String(appointment.treatment_id || "").trim()) {
      payload.treatment_id = cleanTreatment;
      diffs.push(buildDiffRow("treatment_id", appointment.treatment_id, cleanTreatment));
    }

    const cleanStatus = normalizeStatus(status);
    if (!ALLOWED_STATUSES.has(cleanStatus)) {
      return { error: "status ไม่ถูกต้อง" };
    }
    if (cleanStatus !== normalizeStatus(appointment.status)) {
      payload.status = cleanStatus;
      diffs.push(buildDiffRow("status", formatStatus(appointment.status), formatStatus(cleanStatus)));
    }

    if (requiresCancelledToCompletedConfirm) {
      if (!confirmCancelledToCompleted) {
        return { error: "กรุณายืนยันการเปลี่ยนสถานะ cancelled -> completed" };
      }
      payload.confirm_cancelled_to_completed = true;
    }

    const cleanCustomerName = String(customerName || "").trim();
    if (!cleanCustomerName) return { error: "customer_full_name ห้ามว่าง" };
    if (cleanCustomerName !== String(appointment.customer_full_name || "").trim()) {
      payload.customer_full_name = cleanCustomerName;
      diffs.push(
        buildDiffRow("customer_full_name", appointment.customer_full_name, cleanCustomerName)
      );
    }

    const originalPhone = String(appointment.phone || "").trim();
    const enteredPhone = String(phone || "").trim();
    if (enteredPhone !== originalPhone) {
      const normalizedPhone = normalizeThaiPhone(enteredPhone);
      if (!normalizedPhone) return { error: "เบอร์โทรไม่ถูกต้อง" };
      payload.phone = normalizedPhone;
      diffs.push(buildDiffRow("phone", originalPhone, normalizedPhone));
    }

    const originalEmailOrLine = String(appointment.email_or_lineid || "").trim();
    const enteredEmailOrLine = String(emailOrLineid || "").trim();
    if (enteredEmailOrLine !== originalEmailOrLine) {
      const normalizedEmailOrLine = sanitizeEmailOrLine(enteredEmailOrLine);
      if (!normalizedEmailOrLine.ok) return { error: normalizedEmailOrLine.error };
      payload.email_or_lineid = normalizedEmailOrLine.value;
      diffs.push(
        buildDiffRow(
          "email_or_lineid",
          originalEmailOrLine,
          normalizedEmailOrLine.value
        )
      );
    }

    const originalRawSheetUuid = String(appointment.raw_sheet_uuid || "").trim();
    const nextRawSheetUuid = String(rawSheetUuid || "").trim();
    if (enableRawSheetDanger && nextRawSheetUuid !== originalRawSheetUuid) {
      if (nextRawSheetUuid && !isUuid(nextRawSheetUuid)) {
        return { error: "raw_sheet_uuid ต้องเป็น UUID หรือเว้นว่าง" };
      }
      if (!confirmRawSheetChange || !confirmRawSheetAck) {
        return { error: "กรุณายืนยัน Danger Zone ให้ครบก่อนแก้ raw_sheet_uuid" };
      }
      payload.raw_sheet_uuid = nextRawSheetUuid;
      payload.confirm_raw_sheet_uuid_change = true;
      payload.confirm_raw_sheet_uuid_change_ack = true;
      diffs.push(buildDiffRow("raw_sheet_uuid", originalRawSheetUuid, nextRawSheetUuid));
    }

    const targetStatus = normalizeStatus(payload.status || appointment.status);
    if (createPackageUsage) {
      if (targetStatus !== "completed") {
        return { error: "สร้าง package usage ได้เฉพาะสถานะ completed" };
      }
      const selectedPackage = String(customerPackageId || "").trim();
      if (!isUuid(selectedPackage)) {
        return { error: "กรุณาเลือก customer package ที่ต้องการตัดคอร์ส" };
      }
      payload.create_package_usage = true;
      payload.customer_package_id = selectedPackage;
      payload.used_mask = Boolean(usedMask);
      const selectedPackageTitle =
        activePackages.find((pkg) => pkg.customer_package_id === selectedPackage)?.package_title ||
        selectedPackage;
      diffs.push(
        buildDiffRow(
          "package_usage",
          "-",
          `${selectedPackageTitle} | used_mask=${Boolean(usedMask)}`
        )
      );
    }

    const changedFieldKeys = Object.keys(payload).filter((key) => key !== "reason");
    if (changedFieldKeys.length === 0) {
      return { error: "ไม่มีข้อมูลที่เปลี่ยนแปลง" };
    }

    return { payload, diffs };
  };

  const handleOpenConfirm = (event) => {
    event.preventDefault();
    setSubmitError("");
    const built = buildPatchPayload();
    if (built.error) {
      setSubmitError(built.error);
      return;
    }
    setPendingPayload(built.payload);
    setDiffRows(built.diffs);
    setConfirmOpen(true);
  };

  const handleConfirmSubmit = async () => {
    if (!appointment?.id || !pendingPayload) return;
    setSubmitError("");
    setConfirmOpen(false);

    try {
      setStatusOpen(true);
      setStatusMode("loading");
      const data = await patchAdminAppointment(appointment.id, pendingPayload);
      setResult(data);
      setStatusMode("success");

      const refreshed = await getAdminAppointmentById(appointment.id);
      applyLoadedData(refreshed);
    } catch (err) {
      setSubmitError(err?.message || "บันทึกการแก้ไขไม่สำเร็จ");
      setStatusMode("error");
    } finally {
      setPendingPayload(null);
      setDiffRows([]);
    }
  };

  const handleCloseStatus = () => {
    setStatusOpen(false);
    setStatusMode("idle");
  };

  return (
    <section className="workbench-body">
      <div className="panel aed-panel" style={{ gridColumn: "1 / -1" }}>
        <div className="panel-title">
          <span>Edit Appointment</span>
          <strong>Admin only</strong>
        </div>

        {!isAdmin && (
          <div className="aed-warning">
            บัญชีนี้ไม่ใช่ Admin/Owner — หน้านี้แก้ไข appointment ไม่ได้
          </div>
        )}

        <div className="aed-lookup">
          <div className="aed-field">
            <label htmlFor="aed-appointment-id">appointment_id</label>
            <input
              id="aed-appointment-id"
              type="text"
              value={appointmentIdInput}
              onChange={(event) => setAppointmentIdInput(event.target.value)}
              placeholder="uuid ของ appointments.id"
            />
          </div>
          <button
            type="button"
            className="aed-load-btn"
            onClick={loadAppointment}
            disabled={!isAdmin || loadingDetail}
          >
            {loadingDetail ? "กำลังโหลด..." : "โหลดข้อมูล"}
          </button>
        </div>

        {lookupError && <div className="aed-error">{lookupError}</div>}

        {appointment ? (
          <form className="aed-form" onSubmit={handleOpenConfirm}>
            <div className="aed-grid">
              <div className="aed-field">
                <label htmlFor="aed-scheduled">scheduled_at (Bangkok)</label>
                <input
                  id="aed-scheduled"
                  type="datetime-local"
                  value={scheduledAtLocal}
                  onChange={(event) => setScheduledAtLocal(event.target.value)}
                />
              </div>

              <div className="aed-field">
                <label htmlFor="aed-branch">branch_id</label>
                <input
                  id="aed-branch"
                  type="text"
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                />
              </div>

              <div className="aed-field">
                <label htmlFor="aed-treatment">treatment_id</label>
                <input
                  id="aed-treatment"
                  type="text"
                  value={treatmentId}
                  onChange={(event) => setTreatmentId(event.target.value)}
                />
              </div>

              <div className="aed-field">
                <label htmlFor="aed-status">status</label>
                <select
                  id="aed-status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="booked">booked</option>
                  <option value="completed">completed</option>
                  <option value="cancelled">cancelled</option>
                  <option value="no_show">no_show</option>
                  <option value="rescheduled">rescheduled</option>
                </select>
              </div>

              <div className="aed-field">
                <label htmlFor="aed-customer-name">customer_full_name</label>
                <input
                  id="aed-customer-name"
                  type="text"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                />
              </div>

              <div className="aed-field">
                <label htmlFor="aed-phone">phone</label>
                <input
                  id="aed-phone"
                  type="text"
                  inputMode="numeric"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="08xxxxxxxx หรือ 02xxxxxxx"
                />
              </div>

              <div className="aed-field aed-span-2">
                <label htmlFor="aed-email-line">email_or_lineid</label>
                <input
                  id="aed-email-line"
                  type="text"
                  value={emailOrLineid}
                  onChange={(event) => setEmailOrLineid(event.target.value)}
                />
              </div>

              {requiresCancelledToCompletedConfirm && (
                <label className="aed-check aed-span-2">
                  <input
                    type="checkbox"
                    checked={confirmCancelledToCompleted}
                    onChange={(event) =>
                      setConfirmCancelledToCompleted(event.target.checked)
                    }
                  />
                  <span>ยืนยันการเปลี่ยนสถานะจาก cancelled เป็น completed</span>
                </label>
              )}

              {selectedStatusNormalized === "completed" && (
                <>
                  <label className="aed-check aed-span-2">
                    <input
                      type="checkbox"
                      checked={createPackageUsage}
                      onChange={(event) => setCreatePackageUsage(event.target.checked)}
                    />
                    <span>Create package usage (deduct session)</span>
                  </label>

                  {createPackageUsage && (
                    <>
                      <div className="aed-field">
                        <label htmlFor="aed-package">customer_package_id</label>
                        <select
                          id="aed-package"
                          value={customerPackageId}
                          onChange={(event) => setCustomerPackageId(event.target.value)}
                        >
                          <option value="">-- เลือก package --</option>
                          {activePackages.map((pkg) => (
                            <option key={pkg.customer_package_id} value={pkg.customer_package_id}>
                              {pkg.package_title} | เหลือ {pkg.sessions_remaining}/{pkg.sessions_total}
                            </option>
                          ))}
                        </select>
                      </div>
                      <label className="aed-check">
                        <input
                          type="checkbox"
                          checked={usedMask}
                          onChange={(event) => setUsedMask(event.target.checked)}
                        />
                        <span>ใช้สิทธิ์ mask ในครั้งนี้</span>
                      </label>
                    </>
                  )}
                </>
              )}

              <div className="aed-field aed-span-2 aed-danger">
                <div className="aed-danger-title">Danger Zone: raw_sheet_uuid</div>
                <label className="aed-check">
                  <input
                    type="checkbox"
                    checked={enableRawSheetDanger}
                    onChange={(event) => setEnableRawSheetDanger(event.target.checked)}
                  />
                  <span>เปิดโหมดแก้ raw_sheet_uuid</span>
                </label>

                {enableRawSheetDanger && (
                  <>
                    <input
                      id="aed-raw-sheet"
                      type="text"
                      value={rawSheetUuid}
                      onChange={(event) => setRawSheetUuid(event.target.value)}
                      placeholder="uuid หรือเว้นว่างเพื่อล้างค่า"
                    />
                    <label className="aed-check">
                      <input
                        type="checkbox"
                        checked={confirmRawSheetChange}
                        onChange={(event) => setConfirmRawSheetChange(event.target.checked)}
                      />
                      <span>ยืนยันว่าเข้าใจผลกระทบของการเปลี่ยน linkage กับ Sheet</span>
                    </label>
                    <label className="aed-check">
                      <input
                        type="checkbox"
                        checked={confirmRawSheetAck}
                        onChange={(event) => setConfirmRawSheetAck(event.target.checked)}
                      />
                      <span>ยืนยันซ้ำอีกครั้งว่าเปลี่ยนค่าดังกล่าวจริง</span>
                    </label>
                  </>
                )}
              </div>

              <div className="aed-field aed-span-2">
                <label htmlFor="aed-reason">reason (required)</label>
                <textarea
                  id="aed-reason"
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="เหตุผลการแก้ไขอย่างน้อย 5 ตัวอักษร"
                />
              </div>
            </div>

            <div className="aed-actions">
              <button
                className="aed-submit"
                type="submit"
                disabled={!isAdmin || statusMode === "loading"}
              >
                ตรวจสอบก่อนบันทึก
              </button>
              {submitError && <div className="aed-error">{submitError}</div>}
            </div>
          </form>
        ) : (
          <div className="aed-empty">กรอก appointment_id แล้วกด “โหลดข้อมูล” เพื่อเริ่มแก้ไข</div>
        )}
      </div>

      {confirmOpen && (
        <div className="aed-overlay" role="dialog" aria-modal="true">
          <div className="aed-confirm-card">
            <div className="aed-confirm-title">ยืนยันการแก้ไข appointment</div>
            <div className="aed-confirm-sub">กรุณาตรวจสอบรายการเปลี่ยนแปลงก่อนบันทึก</div>
            <div className="aed-diff-list">
              {diffRows.map((row, index) => (
                <div key={`${row.field}-${index}`} className="aed-diff-row">
                  <div className="aed-diff-field">{row.field}</div>
                  <div className="aed-diff-before">{row.before}</div>
                  <div className="aed-diff-arrow">→</div>
                  <div className="aed-diff-after">{row.after}</div>
                </div>
              ))}
            </div>
            <div className="aed-confirm-actions">
              <button
                type="button"
                className="aed-btn-secondary"
                onClick={() => setConfirmOpen(false)}
              >
                ยกเลิก
              </button>
              <button type="button" className="aed-btn-primary" onClick={handleConfirmSubmit}>
                ยืนยันบันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {statusOpen && (
        <div className="aed-overlay" role="dialog" aria-modal="true">
          <div className="aed-status-card">
            {statusMode === "loading" ? (
              <>
                <div className="aed-spinner" aria-hidden="true" />
                <div className="aed-status-message">กำลังบันทึกข้อมูล...</div>
              </>
            ) : (
              <>
                <div
                  className={`aed-status-badge ${
                    statusMode === "success" ? "is-success" : "is-error"
                  }`}
                >
                  {statusMode === "success" ? "สำเร็จ" : "ผิดพลาด"}
                </div>
                <div className="aed-status-message">
                  {statusMode === "success" ? (
                    <>
                      แก้ไข appointment เรียบร้อย
                      {result?.appointment_id ? (
                        <div className="aed-status-sub">
                          appointment_id: <code>{result.appointment_id}</code>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>บันทึกไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่</>
                  )}
                </div>
                <button className="aed-close" type="button" onClick={handleCloseStatus}>
                  ปิด
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
