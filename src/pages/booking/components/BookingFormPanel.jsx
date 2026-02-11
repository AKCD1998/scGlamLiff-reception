import Select from "react-select";

export default function BookingFormPanel({
  bookingDate,
  onBookingDateChange,
  customerName,
  onCustomerNameChange,
  bookingTime,
  onBookingTimeChange,
  recommendedSlots,
  onPickRecommendedSlot,
  timeError,
  phone,
  onPhoneChange,
  phoneError,
  lineId,
  onLineIdChange,
  lineIdError,
  treatmentOptions,
  treatmentItem,
  onTreatmentChange,
  treatmentOptionsError,
  staffName,
  onStaffChange,
  saving,
  isPastBooking,
  submitError,
  submitSuccess,
  onSave,
  SELECT_STYLES,
}) {
  return (
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
                  onChange={(event) => onBookingDateChange(event.target.value)}
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
                  onChange={(event) => onCustomerNameChange(event.target.value)}
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
                    onChange={(event) => onBookingTimeChange(event.target.value)}
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
                          onClick={() => onPickRecommendedSlot(slot)}
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
                  onChange={(event) => onPhoneChange(event.target.value)}
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
                  onChange={(event) => onLineIdChange(event.target.value)}
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
                  onChange={(option) => onTreatmentChange(option?.value || "")}
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
                  onChange={(event) => onStaffChange(event.target.value)}
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
                onClick={onSave}
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
  );
}

