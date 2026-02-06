import { useMemo, useState } from "react";
import { adminBackdate } from "../utils/appointmentsApi";
import "./AdminBackdate.css";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toDatetimeLocalValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
}

function toBangkokIso(datetimeLocal) {
  const raw = String(datetimeLocal || "").trim();
  if (!raw) return "";
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) return raw;
  if (raw.length === 16) return `${raw}:00+07:00`;
  if (raw.length === 19) return `${raw}+07:00`;
  return `${raw}+07:00`;
}

function isAdminRole(roleName) {
  const role = String(roleName || "").trim().toLowerCase();
  return role === "admin" || role === "owner";
}

export default function AdminBackdate({ currentUser }) {
  const isAdmin = useMemo(() => isAdminRole(currentUser?.role_name), [currentUser]);
  const defaultScheduledAt = useMemo(() => {
    const date = new Date();
    date.setMinutes(date.getMinutes() - 10);
    return toDatetimeLocalValue(date);
  }, []);

  const [scheduledAtLocal, setScheduledAtLocal] = useState(defaultScheduledAt);
  const [branchId, setBranchId] = useState("mk1");
  const [treatmentId, setTreatmentId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [emailOrLineid, setEmailOrLineid] = useState("");
  const [staffName, setStaffName] = useState("ส้ม");
  const [treatmentItemText, setTreatmentItemText] = useState("");
  const [reason, setReason] = useState("");
  const [rawSheetUuid, setRawSheetUuid] = useState("");
  const [status, setStatus] = useState("completed");

  const [submitError, setSubmitError] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusMode, setStatusMode] = useState("idle"); // idle | loading | success | error
  const [result, setResult] = useState(null);

  const handleCloseStatus = () => {
    setStatusOpen(false);
    setStatusMode("idle");
  };

  const validate = () => {
    const scheduledAtIso = toBangkokIso(scheduledAtLocal);
    if (!scheduledAtIso) return "กรุณาเลือกวันที่/เวลา";
    const scheduledAtDate = new Date(scheduledAtIso);
    if (Number.isNaN(scheduledAtDate.getTime())) return "รูปแบบ scheduled_at ไม่ถูกต้อง";
    if (scheduledAtDate.getTime() >= Date.now()) return "scheduled_at ต้องอยู่ในอดีต";
    if (!branchId.trim()) return "กรุณากรอก branch_id";
    if (!treatmentId.trim()) return "กรุณากรอก treatment_id";
    if (!customerName.trim()) return "กรุณากรอกชื่อลูกค้า";
    if (!phone.trim()) return "กรุณากรอกเบอร์โทร";
    if (!staffName.trim()) return "กรุณากรอกชื่อพนักงาน";
    if (!treatmentItemText.trim()) return "กรุณากรอก treatment item";
    if (!reason.trim() || reason.trim().length < 5) return "กรุณากรอกเหตุผลอย่างน้อย 5 ตัวอักษร";
    return "";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError("");
    setResult(null);

    if (!isAdmin) {
      setSubmitError("บัญชีนี้ไม่มีสิทธิ์ Admin");
      return;
    }

    const validationError = validate();
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    const payload = {
      scheduled_at: toBangkokIso(scheduledAtLocal),
      branch_id: branchId.trim(),
      treatment_id: treatmentId.trim(),
      customer_full_name: customerName.trim(),
      phone: phone.trim(),
      email_or_lineid: emailOrLineid.trim(),
      staff_name: staffName.trim(),
      treatment_item_text: treatmentItemText.trim(),
      reason: reason.trim(),
      raw_sheet_uuid: rawSheetUuid.trim() || undefined,
      status: status.trim(),
    };

    try {
      setStatusOpen(true);
      setStatusMode("loading");
      const data = await adminBackdate(payload);
      setResult(data);
      setStatusMode("success");
    } catch (err) {
      setSubmitError(err?.message || "Backdate ไม่สำเร็จ");
      setStatusMode("error");
    }
  };

  return (
    <section className="workbench-body">
      <div className="panel abd-panel" style={{ gridColumn: "1 / -1" }}>
        <div className="panel-title">
          <span>Backdate Appointment</span>
          <strong>Admin only</strong>
        </div>

        {!isAdmin && (
          <div className="abd-warning">
            บัญชีนี้ไม่ใช่ Admin/Owner — หน้านี้สร้างจองย้อนหลังไม่ได้
          </div>
        )}

        <form className="abd-form" onSubmit={handleSubmit}>
          <div className="abd-grid">
            <div className="abd-field">
              <label htmlFor="abd-scheduled">scheduled_at (Bangkok)</label>
              <input
                id="abd-scheduled"
                type="datetime-local"
                value={scheduledAtLocal}
                onChange={(e) => setScheduledAtLocal(e.target.value)}
              />
            </div>

            <div className="abd-field">
              <label htmlFor="abd-branch">branch_id</label>
              <input
                id="abd-branch"
                type="text"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                placeholder="เช่น mk1"
              />
            </div>

            <div className="abd-field">
              <label htmlFor="abd-treatment">treatment_id</label>
              <input
                id="abd-treatment"
                type="text"
                value={treatmentId}
                onChange={(e) => setTreatmentId(e.target.value)}
                placeholder="uuid ของ treatments.id"
              />
            </div>

            <div className="abd-field">
              <label htmlFor="abd-status">status</label>
              <select
                id="abd-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="completed">completed</option>
                <option value="booked">booked</option>
              </select>
            </div>

            <div className="abd-field">
              <label htmlFor="abd-customer">customer_full_name</label>
              <input
                id="abd-customer"
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="ชื่อลูกค้า"
              />
            </div>

            <div className="abd-field">
              <label htmlFor="abd-phone">phone</label>
              <input
                id="abd-phone"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="094-xxx-xxxx"
              />
            </div>

            <div className="abd-field">
              <label htmlFor="abd-email-line">email_or_lineid (optional)</label>
              <input
                id="abd-email-line"
                type="text"
                value={emailOrLineid}
                onChange={(e) => setEmailOrLineid(e.target.value)}
              />
            </div>

            <div className="abd-field">
              <label htmlFor="abd-staff">staff_name (for audit)</label>
              <input
                id="abd-staff"
                type="text"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
              />
            </div>

            <div className="abd-field abd-span-2">
              <label htmlFor="abd-treatment-item">treatment_item_text (for audit)</label>
              <input
                id="abd-treatment-item"
                type="text"
                value={treatmentItemText}
                onChange={(e) => setTreatmentItemText(e.target.value)}
                placeholder='เช่น "1/3 smooth 999 1 mask"'
              />
            </div>

            <div className="abd-field abd-span-2">
              <label htmlFor="abd-reason">reason</label>
              <textarea
                id="abd-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เหตุผลการบันทึกย้อนหลัง (ขั้นต่ำ 5 ตัวอักษร)"
                rows={3}
              />
            </div>

            <div className="abd-field abd-span-2">
              <label htmlFor="abd-sheet">raw_sheet_uuid (optional)</label>
              <input
                id="abd-sheet"
                type="text"
                value={rawSheetUuid}
                onChange={(e) => setRawSheetUuid(e.target.value)}
                placeholder="uuid ของ sheet_visits_raw.sheet_uuid (ถ้ามี)"
              />
            </div>
          </div>

          <div className="abd-actions">
            <button className="abd-submit" type="submit" disabled={!isAdmin || statusMode === "loading"}>
              {statusMode === "loading" ? "กำลังบันทึก..." : "สร้างจองย้อนหลัง"}
            </button>
            {submitError && <div className="abd-error">{submitError}</div>}
          </div>
        </form>
      </div>

      {statusOpen && (
        <div className="abd-overlay" role="dialog" aria-modal="true">
          <div className="abd-status-card">
            {statusMode === "loading" ? (
              <>
                <div className="abd-spinner" aria-hidden="true" />
                <div className="abd-status-message">กำลังส่งข้อมูล...</div>
              </>
            ) : (
              <>
                <div className={`abd-status-badge ${statusMode === "success" ? "is-success" : "is-error"}`}>
                  {statusMode === "success" ? "สำเร็จ" : "ผิดพลาด"}
                </div>
                <div className="abd-status-message">
                  {statusMode === "success" ? (
                    <>
                      สร้างจองย้อนหลังเรียบร้อย
                      {result?.appointment_id ? (
                        <div className="abd-status-sub">
                          appointment_id: <code>{result.appointment_id}</code>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>สร้างไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่</>
                  )}
                </div>
                <button className="abd-close" type="button" onClick={handleCloseStatus}>
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

