import { formatTreatmentDisplay } from "../../../utils/treatmentDisplay";

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
  const smoothName = "Smooth";
  return [
    {
      value: "fallback:smooth-1x",
      label: formatTreatmentDisplay({
        treatmentName: smoothName,
        treatmentSessions: 1,
        treatmentMask: 0,
        treatmentPrice: 399,
      }),
      treatmentId: "",
      treatmentName: smoothName,
      treatmentSessions: 1,
      treatmentMask: 0,
      treatmentPrice: 399,
      treatmentItemText: formatTreatmentDisplay({
        treatmentName: smoothName,
        treatmentSessions: 1,
        treatmentMask: 0,
        treatmentPrice: 399,
      }),
      treatmentDisplay: formatTreatmentDisplay({
        treatmentName: smoothName,
        treatmentSessions: 1,
        treatmentMask: 0,
        treatmentPrice: 399,
      }),
    },
    {
      value: "fallback:smooth-3x",
      label: formatTreatmentDisplay({
        treatmentName: smoothName,
        treatmentSessions: 3,
        treatmentMask: 1,
        treatmentPrice: 999,
      }),
      treatmentId: "",
      treatmentName: smoothName,
      treatmentSessions: 3,
      treatmentMask: 1,
      treatmentPrice: 999,
      treatmentItemText: formatTreatmentDisplay({
        treatmentName: smoothName,
        treatmentSessions: 3,
        treatmentMask: 1,
        treatmentPrice: 999,
      }),
      treatmentDisplay: formatTreatmentDisplay({
        treatmentName: smoothName,
        treatmentSessions: 3,
        treatmentMask: 1,
        treatmentPrice: 999,
      }),
    },
    {
      value: "fallback:smooth-10x",
      label: formatTreatmentDisplay({
        treatmentName: smoothName,
        treatmentSessions: 10,
        treatmentMask: 3,
        treatmentPrice: 2999,
      }),
      treatmentId: "",
      treatmentName: smoothName,
      treatmentSessions: 10,
      treatmentMask: 3,
      treatmentPrice: 2999,
      treatmentItemText: formatTreatmentDisplay({
        treatmentName: smoothName,
        treatmentSessions: 10,
        treatmentMask: 3,
        treatmentPrice: 2999,
      }),
      treatmentDisplay: formatTreatmentDisplay({
        treatmentName: smoothName,
        treatmentSessions: 10,
        treatmentMask: 3,
        treatmentPrice: 2999,
      }),
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
