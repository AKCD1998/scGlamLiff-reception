export const TIME_CFG = {
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

export function buildFallbackTreatmentOptions() {
  return [
    {
      value: "fallback:smooth-1x",
      label: "Smooth 399 thb",
      treatmentId: "",
      treatmentItemText: "smooth 399 free",
    },
    {
      value: "fallback:renew",
      label: "Renew 599 thb",
      treatmentId: "",
      treatmentItemText: "renew 599",
    },
    {
      value: "fallback:acne-care",
      label: "Acne Care 899 thb",
      treatmentId: "",
      treatmentItemText: "acne care 899",
    },
    {
      value: "fallback:smooth-3x",
      label: "1/3 Smooth 999 thb 1 mask",
      treatmentId: "",
      treatmentItemText: "1/3 smooth 999 1 mask",
    },
    {
      value: "fallback:smooth-10x",
      label: "1/10 Smooth 2999 thb 3 mask",
      treatmentId: "",
      treatmentItemText: "1/10 smooth 2999 3 mask",
    },
  ];
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const LINE_ID_PATTERN = /^[a-zA-Z0-9._-]{1,50}$/;

export const SELECT_STYLES = {
  container: (base) => ({ ...base, width: "100%" }),
  control: (base, state) => ({
    ...base,
    backgroundColor: "var(--panel, #fff7f0)",
    borderColor: "var(--border, #2a1206)",
    boxShadow: state.isFocused
      ? "0 0 0 2px var(--booking-focus, rgba(42, 18, 6, 0.35))"
      : "none",
    minHeight: "42px",
    "&:hover": {
      borderColor: "var(--border, #2a1206)",
    },
  }),
  singleValue: (base) => ({ ...base, color: "var(--text-strong, #2a1206)" }),
  input: (base) => ({ ...base, color: "var(--text-strong, #2a1206)" }),
  placeholder: (base) => ({ ...base, color: "var(--text-muted, #7a5a43)" }),
  indicatorSeparator: (base) => ({
    ...base,
    backgroundColor: "var(--border, #2a1206)",
    opacity: 0.25,
  }),
  dropdownIndicator: (base) => ({
    ...base,
    color: "var(--text-muted, #7a5a43)",
    "&:hover": {
      color: "var(--text-strong, #2a1206)",
    },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: "var(--text-muted, #7a5a43)",
    "&:hover": {
      color: "var(--text-strong, #2a1206)",
    },
  }),
  option: (base, state) => ({
    ...base,
    color: "var(--text-strong, #2a1206)",
    backgroundColor: state.isSelected
      ? "var(--tab-bg, #efe1d2)"
      : state.isFocused
        ? "var(--tab-hover, #e0cbb7)"
        : "var(--panel, #fff7f0)",
    ":active": {
      ...base[":active"],
      backgroundColor: "var(--tab-bg, #efe1d2)",
    },
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  menu: (base) => ({
    ...base,
    zIndex: 9999,
    backgroundColor: "var(--panel, #fff7f0)",
    border: "1.5px solid var(--border, #2a1206)",
    boxShadow: "0 12px 22px rgba(20, 12, 6, 0.22)",
  }),
  menuList: (base) => ({ ...base, backgroundColor: "var(--panel, #fff7f0)" }),
};
