import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./CustomerProfileModal.css";
import ProgressDots from "./ProgressDots";
import { formatTreatmentDisplay, resolveTreatmentDisplay } from "../utils/treatmentDisplay";

const SHOP_TZ = "Asia/Bangkok";

function formatAppointmentStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return "เรียบร้อย";
  if (s === "cancelled" || s === "canceled") return "ยกเลิก";
  if (s === "no_show") return "ไม่มาตามนัด";
  if (s === "rescheduled") return "เลื่อนนัด";
  return "จองไว้";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: SHOP_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: SHOP_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function CustomerProfileModal({
  open,
  onClose,
  customer,
  profileData,
  loading,
  error,
  onRetry,
}) {
  const closeButtonRef = useRef(null);
  const fetchCompletedRef = useRef(false);
  const sawLoadingRef = useRef(false);
  const [hasResolvedOnce, setHasResolvedOnce] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const currentCustomerKey = `${customer?.id || ""}:${customer?.fullName || ""}`;
  const hasProfilePayload = useMemo(() => {
    if (!profileData || typeof profileData !== "object") return false;

    const expectedId = customer?.id ? String(customer.id) : "";
    const payloadId = profileData?.customer?.id ? String(profileData.customer.id) : "";
    if (expectedId && payloadId && expectedId !== payloadId) return false;

    if (profileData.customer && typeof profileData.customer === "object") return true;
    if (Array.isArray(profileData.packages)) return true;
    if (Array.isArray(profileData.usage_history)) return true;
    if (Array.isArray(profileData.appointment_history)) return true;
    return Object.keys(profileData).length > 0;
  }, [customer?.id, profileData]);

  useEffect(() => {
    if (!open) {
      fetchCompletedRef.current = false;
      sawLoadingRef.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasResolvedOnce(false);
      return;
    }

    fetchCompletedRef.current = false;
    sawLoadingRef.current = false;
    setHasResolvedOnce(false);
  }, [currentCustomerKey, open]);

  useEffect(() => {
    if (!open) return;

    if (loading) {
      sawLoadingRef.current = true;
      return;
    }

    const canResolve = Boolean(error) || hasProfilePayload || sawLoadingRef.current;
    if (!canResolve) return;

    fetchCompletedRef.current = true;
    const raf = requestAnimationFrame(() => {
      setHasResolvedOnce(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [error, hasProfilePayload, loading, open]);

  const customerInfo = profileData?.customer || {};
  const displayName = customerInfo.full_name || customer?.fullName || "-";
  const displayId = customerInfo.id || customer?.id || "-";

  const packages = useMemo(() => profileData?.packages || [], [profileData]);
  const usageHistory = useMemo(
    () => profileData?.usage_history || [],
    [profileData]
  );
  const appointmentHistory = useMemo(
    () => profileData?.appointment_history || [],
    [profileData]
  );
  const orderedPackages = useMemo(() => {
    const list = [...packages];
    list.sort((a, b) => {
      const aTime = a?.purchased_at ? new Date(a.purchased_at).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b?.purchased_at ? new Date(b.purchased_at).getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });
    return list;
  }, [packages]);
  const carouselRef = useRef(null);

  const scrollCarousel = useCallback((direction) => {
    const el = carouselRef.current;
    if (!el) return;
    const cardWidth = el.querySelector(".cpm-course-card")?.offsetWidth || 0;
    const gap = 16;
    const delta = direction === "next" ? cardWidth + gap : -(cardWidth + gap);
    el.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  const isInitialLoading =
    open &&
    !hasResolvedOnce &&
    (loading || !hasResolvedOnce);

  if (!open) return null;

  return (
    <div
      className="booking-modal-overlay customer-profile-modal__overlay"
      onClick={onClose}
    >
      <div
        className="booking-modal-card customer-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-profile-title"
        aria-busy={isInitialLoading ? "true" : undefined}
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

        <div className="customer-profile-modal__header">
          <div className="customer-profile-modal__title" id="customer-profile-title">
            ข้อมูลผู้รับบริการ
          </div>
          <button
            type="button"
            className="booking-modal-close"
            aria-label="Close customer profile"
            onClick={onClose}
            ref={closeButtonRef}
          >
            ×
          </button>
        </div>

        <div className="customer-profile-modal__body">
          <section className="cpm-section cpm-profile">
            <div className="customer-profile-section__title">ข้อมูลผู้รับบริการ</div>
            <div className="customer-profile-info">
              <div>
                <div className="customer-profile-label">ชื่อ-นามสกุล</div>
                <div className="customer-profile-value">{displayName}</div>
              </div>
              <div>
                <div className="customer-profile-label">รหัสผู้รับบริการ</div>
                <div className="customer-profile-value">{displayId}</div>
              </div>
            </div>
          </section>

          <section className="cpm-section cpm-courses">
            <div className="cpm-courses-head">
              <h3>คอร์สที่ซื้อไว้</h3>
              <div className="cpm-carousel-controls">
                <button
                  type="button"
                  className="cpm-carousel-btn"
                  onClick={() => scrollCarousel("prev")}
                  disabled={orderedPackages.length <= 1}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="cpm-carousel-btn"
                  onClick={() => scrollCarousel("next")}
                  disabled={orderedPackages.length <= 1}
                >
                  →
                </button>
              </div>
            </div>
            {loading ? (
              <div className="customer-profile-state">กำลังโหลดข้อมูลคอร์ส...</div>
            ) : error ? (
              <div className="customer-profile-state customer-profile-state--error">
                โหลดข้อมูลไม่สำเร็จ: {error}
                {onRetry ? (
                  <button type="button" onClick={onRetry}>
                    ลองใหม่
                  </button>
                ) : null}
              </div>
            ) : !hasResolvedOnce ? (
              <div className="customer-profile-state">กำลังโหลดข้อมูล...</div>
            ) : orderedPackages.length === 0 ? (
              <div className="customer-profile-state">ยังไม่มีคอร์ส</div>
            ) : (
              <div
                className="cpm-carousel"
                role="region"
                aria-label="Customer courses carousel"
                ref={carouselRef}
              >
                <div className="cpm-carousel-track">
                  {orderedPackages.map((pkg) => {
                    const sessionsTotal = Number(pkg.package?.sessions_total) || 0;
                    const sessionsUsed = Number(pkg.usage?.sessions_used) || 0;
                    const sessionsRemaining = Number(pkg.usage?.sessions_remaining) || 0;
                    const maskTotal = Number(pkg.package?.mask_total) || 0;
                    const maskUsed = Number(pkg.usage?.mask_used) || 0;
                    const maskRemaining = Number(pkg.usage?.mask_remaining) || 0;
                    const packageDisplay =
                      pkg.treatment_display ||
                      pkg.package?.treatment_display ||
                      formatTreatmentDisplay({
                        treatmentName: pkg.package?.title || pkg.package?.code || "Treatment",
                        treatmentCode: pkg.package?.code || "",
                        treatmentSessions: sessionsTotal || 1,
                        treatmentMask: maskTotal,
                        treatmentPrice: Number(pkg.package?.price_thb) || null,
                      });

                    return (
                      <div key={pkg.customer_package_id} className="cpm-course-card">
                        <div className="cpm-course-header">
                          <div>
                            <div className="customer-profile-strong">
                              {packageDisplay || "-"}
                            </div>
                            <div className="customer-profile-muted">
                              {pkg.package?.code || "-"}
                            </div>
                          </div>
                          <div className="customer-profile-status">
                            {pkg.status || "-"}
                          </div>
                        </div>
                        <div className="customer-profile-course-meta">
                          <span>ซื้อ: {formatDate(pkg.purchased_at)}</span>
                          <span>หมดอายุ: {formatDate(pkg.expires_at)}</span>
                        </div>
                        <div className="customer-profile-progress">
                          <ProgressDots
                            total={sessionsTotal}
                            used={sessionsUsed}
                            size={sessionsTotal > 12 ? "sm" : "md"}
                            ariaLabel={`Sessions used ${sessionsUsed} of ${sessionsTotal}`}
                          />
                          <div className="customer-profile-progress-text">
                            <span className="customer-profile-strong">
                              {sessionsUsed}/{sessionsTotal}
                            </span>
                            <span className="customer-profile-muted">
                              เหลือ {sessionsRemaining} ครั้ง
                            </span>
                          </div>
                        </div>
                        {maskTotal > 0 ? (
                          <div className="customer-profile-mask">
                            <div className="customer-profile-mask-label">
                              มาสก์หน้า
                            </div>
                            <ProgressDots
                              total={maskTotal}
                              used={maskUsed}
                              size="sm"
                              ariaLabel={`Mask used ${maskUsed} of ${maskTotal}`}
                            />
                            <div className="customer-profile-muted">
                              {maskUsed}/{maskTotal} · เหลือ {maskRemaining} ครั้ง
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="cpm-section cpm-history">
            <h3>ประวัติการตัดคอร์ส</h3>
            <div className="customer-profile-muted">
              ประวัติการใช้บริการ (จำนวนครั้งของคอร์ส)
            </div>
            {loading ? (
              <div className="customer-profile-state">กำลังโหลดประวัติ...</div>
            ) : error ? (
              <div className="customer-profile-state customer-profile-state--error">
                โหลดข้อมูลไม่สำเร็จ: {error}
              </div>
            ) : !hasResolvedOnce ? (
              <div className="customer-profile-state">กำลังโหลดข้อมูล...</div>
            ) : usageHistory.length === 0 ? (
              <div className="customer-profile-state">ยังไม่มีประวัติการใช้</div>
            ) : (
              <div className="cpm-history-scroll">
                <table className="booking-table customer-profile-table">
                  <thead>
                    <tr>
                      <th className="cpm-col-date">วันที่ใช้</th>
                      <th className="cpm-col-course">คอร์ส</th>
                      <th className="cpm-col-session">ครั้งที่</th>
                      <th className="cpm-col-mask">มาสก์</th>
                      <th className="cpm-col-staff">พนักงาน</th>
                      <th className="cpm-col-appointment">การนัดหมาย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageHistory.map((item, idx) => (
                      <tr key={`${item.appointment_id || "usage"}-${idx}`}>
                        <td>{formatDateTime(item.used_at)}</td>
                        <td className="cpm-cell-wrap">
                          {(() => {
                            const usageDisplay =
                              item.treatment_display ||
                              formatTreatmentDisplay({
                                treatmentName: item.package_title || item.package_code || "Treatment",
                                treatmentCode: item.package_code || "",
                                treatmentSessions: Number(item.sessions_total) || 1,
                                treatmentMask: Number(item.mask_total) || 0,
                                treatmentPrice: Number(item.price_thb) || null,
                              });
                            return (
                              <>
                                <div className="customer-profile-strong">{usageDisplay}</div>
                                <div className="customer-profile-muted">
                                  {item.package_code || "-"}
                                </div>
                              </>
                            );
                          })()}
                        </td>
                        <td>{item.session_no ?? "-"}</td>
                        <td>{item.used_mask ? "Yes" : "No"}</td>
                        <td>{item.staff_display_name || "-"}</td>
                        <td>
                          <div className="customer-profile-strong">
                            {item.appointment_id || "-"}
                          </div>
                          <div className="customer-profile-muted">
                            {item.scheduled_at ? formatDateTime(item.scheduled_at) : "-"}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="cpm-section cpm-appointments">
            <h3>ประวัติการจอง/การมารับบริการ</h3>
            <div className="customer-profile-muted">
              ประวัติการจอง/การมารับบริการ (รวมการจองและการมาใช้บริการทั้งหมด รวมถึงบริการครั้งเดียว)
            </div>
            {loading ? (
              <div className="customer-profile-state">กำลังโหลดประวัติการจอง...</div>
            ) : error ? (
              <div className="customer-profile-state customer-profile-state--error">
                โหลดข้อมูลไม่สำเร็จ: {error}
              </div>
            ) : !hasResolvedOnce ? (
              <div className="customer-profile-state">กำลังโหลดข้อมูล...</div>
            ) : appointmentHistory.length === 0 ? (
              <div className="customer-profile-state">ยังไม่มีประวัติการจอง</div>
            ) : (
              <div className="cpm-history-scroll">
                <table className="booking-table customer-profile-table">
                  <thead>
                    <tr>
                      <th className="cpm-col-date">วันที่นัด</th>
                      <th className="cpm-col-treatment">บริการ</th>
                      <th className="cpm-col-status">สถานะ</th>
                      <th className="cpm-col-branch">สาขา</th>
                      <th className="cpm-col-id">รหัส</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointmentHistory.map((item, idx) => {
                      const resolvedTreatment = resolveTreatmentDisplay({
                        treatmentId: item.treatment_id || "",
                        treatmentName: item.treatment_name || "",
                        treatmentNameEn:
                          item.treatment_name_en ||
                          item.treatment_title_en ||
                          "",
                        treatmentNameTh:
                          item.treatment_name_th ||
                          item.treatment_title_th ||
                          "",
                        treatmentCode: item.treatment_code || "",
                        treatmentSessions: item.treatment_sessions ?? 1,
                        treatmentMask: item.treatment_mask ?? 0,
                        treatmentPrice: item.treatment_price ?? null,
                        legacyText: item.treatment_item_text || "",
                      });
                      const title =
                        item.treatment_display ||
                        resolvedTreatment.treatment_display ||
                        item.treatment_title_en ||
                        item.treatment_title_th ||
                        item.treatment_code ||
                        "-";
                      const idShort = item.id ? String(item.id).slice(0, 8) : "-";
                      return (
                        <tr key={`${item.id || "appt"}-${idx}`}>
                          <td>{formatDateTime(item.scheduled_at)}</td>
                          <td className="cpm-cell-wrap">
                            <div className="customer-profile-strong">{title}</div>
                            <div className="customer-profile-muted">{item.treatment_code || "-"}</div>
                          </td>
                          <td>{formatAppointmentStatus(item.status)}</td>
                          <td>{item.branch_id || "-"}</td>
                          <td>
                            <span className="customer-profile-muted" title={item.id || ""}>
                              {idShort}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
