import { useState } from "react";

export function useHomePickerState() {
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const [displayMonth, setDisplayMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(displayMonth.getMonth());
  const [pickerYear, setPickerYear] = useState(displayMonth.getFullYear());

  return {
    selectedDate,
    setSelectedDate,
    displayMonth,
    setDisplayMonth,
    isPickerOpen,
    setIsPickerOpen,
    pickerMonth,
    setPickerMonth,
    pickerYear,
    setPickerYear,
  };
}
