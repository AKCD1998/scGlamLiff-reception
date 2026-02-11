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
  control: (base) => ({
    ...base,
    backgroundColor: "#fffaf6",
    borderColor: "var(--booking-border)",
    boxShadow: "none",
    minHeight: "42px",
    "&:hover": {
      borderColor: "var(--booking-border)",
    },
  }),
  singleValue: (base) => ({ ...base, color: "#000" }),
  input: (base) => ({ ...base, color: "#000" }),
  placeholder: (base) => ({ ...base, color: "#000" }),
  option: (base, state) => ({
    ...base,
    color: "#000",
    backgroundColor: state.isSelected
      ? "#f0e4d6"
      : state.isFocused
        ? "#f7efe6"
        : "#fff",
    ":active": {
      ...base[":active"],
      backgroundColor: "#f0e4d6",
    },
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  menu: (base) => ({ ...base, zIndex: 9999, backgroundColor: "#fff" }),
  menuList: (base) => ({ ...base, backgroundColor: "#fff" }),
};

