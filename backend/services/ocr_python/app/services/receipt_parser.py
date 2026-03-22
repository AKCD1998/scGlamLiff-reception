import re

RECEIPT_LINE_PATTERN = re.compile(
    r"(?P<date>\d{2}[/-]\d{2}[/-]\d{4})\s*(?P<time>\d{2}:\d{2})\s*(?:BN[O0]|BNO)\s*[:;.]?\s*(?P<bno>[A-Z0-9\-:/ ]+)",
    re.IGNORECASE,
)


def _normalize_line(line: str) -> str:
    normalized = re.sub(r"\s+", " ", str(line or "")).strip()
    normalized = re.sub(r"\bBN[O0]\s*[:;.]?\s*", "BNO:", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bID\s*:\s*", "", normalized, flags=re.IGNORECASE)
    return normalized


def _normalize_ocr_lines(ocr_lines: list[dict] | None) -> list[dict]:
    normalized_lines = []

    for line in ocr_lines or []:
        text = _normalize_line(line.get("text", ""))
        if not text:
            continue

        x1 = float(line.get("x1", 0))
        y1 = float(line.get("y1", 0))
        x2 = float(line.get("x2", 0))
        y2 = float(line.get("y2", 0))

        normalized_lines.append(
            {
                "text": text,
                "score": float(line.get("score", 0) or 0),
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "xCenter": float(line.get("xCenter", (x1 + x2) / 2)),
                "yCenter": float(line.get("yCenter", (y1 + y2) / 2)),
                "lineHeight": max(1.0, y2 - y1),
            }
        )

    return normalized_lines


def _split_receipt_lines(text: str) -> list[str]:
    return [_normalize_line(line) for line in str(text or "").splitlines() if _normalize_line(line)]


def _normalize_amount_candidate(value: str) -> dict | None:
    cleaned = re.sub(r"[^\d., ]", "", str(value or "")).strip()
    if not cleaned:
        return None

    spaced_match = re.fullmatch(r"(\d[\d,]*)\s(\d{2})", cleaned)
    if spaced_match:
        normalized = f"{spaced_match.group(1).replace(',', '')}.{spaced_match.group(2)}"
    elif re.fullmatch(r"\d[\d,]*[.,]\d{2}", cleaned):
        normalized = cleaned.replace(",", "")
    elif re.fullmatch(r"\d[\d,]*", cleaned):
        normalized = f"{cleaned.replace(',', '')}.00"
    else:
        return None

    try:
        numeric_value = float(normalized)
    except ValueError:
        return None

    return {"numericValue": numeric_value, "display": f"{numeric_value:.2f}"}


def _collect_amounts_from_line(line: str) -> list[dict]:
    matches = {
        *re.findall(r"\d[\d,]*\s\d{2}\b", line),
        *re.findall(r"\d[\d,]*[.,]\d{2}\b", line),
    }
    return [candidate for item in matches if (candidate := _normalize_amount_candidate(item))]


def _canonicalize_receipt_line(value: str) -> str:
    normalized = _normalize_line(value).upper()
    match = RECEIPT_LINE_PATTERN.search(normalized)

    if not match:
        return normalized

    date = match.group("date").replace("-", "/")
    time = match.group("time")
    bno = re.sub(r"\s+", "", match.group("bno").upper())
    bno = bno.rstrip(":-")
    return f"{date} {time} BNO:{bno}"


def _format_total_amount(value: str) -> str:
    return f"{value} THB" if value else ""


def _parse_total_amount_value(value: str) -> float | None:
    if not value:
        return None

    try:
        return float(value)
    except ValueError:
        return None


def _extract_receipt_line_parts(receipt_line: str) -> tuple[str, str]:
    match = RECEIPT_LINE_PATTERN.search(str(receipt_line or ""))

    if not match:
        return "", ""

    day, month, year = match.group("date").replace("-", "/").split("/")
    receipt_date = f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    receipt_time = match.group("time")

    return receipt_date, receipt_time


def _is_receipt_meta_line(line: str) -> bool:
    return bool(
        re.search(r"\bBN[O0][:;\s]?[A-Z0-9\-:/]+\b", line, re.IGNORECASE)
        or re.search(r"\b\d{2}[/-]\d{2}[/-]\d{4}\b.*\b\d{2}:\d{2}\b", line)
    )


def _build_receipt_line_candidates(lines: list[str]) -> list[str]:
    candidates = list(lines)

    for index in range(len(lines) - 1):
        candidates.append(f"{lines[index]} {lines[index + 1]}")

    return candidates


def _find_receipt_line_from_text(lines: list[str]) -> str:
    candidates = _build_receipt_line_candidates(lines)

    for candidate in candidates:
        if RECEIPT_LINE_PATTERN.search(candidate):
            return _canonicalize_receipt_line(candidate)

    return ""


def _find_receipt_line_from_ocr_lines(ocr_lines: list[dict]) -> str:
    direct_match = _find_receipt_line_from_text([line["text"] for line in ocr_lines])
    if direct_match:
        return direct_match

    for index, line in enumerate(ocr_lines[:-1]):
        current_text = line["text"]
        next_text = ocr_lines[index + 1]["text"]
        if re.search(r"\d{2}[/-]\d{2}[/-]\d{4}", current_text) and re.search(r"BN[O0]|BNO", next_text, re.IGNORECASE):
            candidate = _canonicalize_receipt_line(f"{current_text} {next_text}")
            if RECEIPT_LINE_PATTERN.search(candidate):
                return candidate

    return ""


def _group_ocr_lines_into_rows(ocr_lines: list[dict]) -> list[dict]:
    if not ocr_lines:
        return []

    sorted_lines = sorted(ocr_lines, key=lambda item: (item["yCenter"], item["xCenter"]))
    average_height = sum(line["lineHeight"] for line in sorted_lines) / len(sorted_lines)
    row_tolerance = max(18.0, average_height * 0.8)

    rows: list[dict] = []
    for line in sorted_lines:
        if not rows or abs(line["yCenter"] - rows[-1]["yCenter"]) > row_tolerance:
            rows.append({"yCenter": line["yCenter"], "lines": [line]})
            continue

        rows[-1]["lines"].append(line)
        rows[-1]["yCenter"] = sum(item["yCenter"] for item in rows[-1]["lines"]) / len(rows[-1]["lines"])

    normalized_rows = []
    for row in rows:
        row_lines = sorted(row["lines"], key=lambda item: item["xCenter"])
        row_text = " ".join(line["text"] for line in row_lines)
        amount_candidates = []
        for line in row_lines:
            for amount in _collect_amounts_from_line(line["text"]):
                amount_candidates.append(
                    {
                        "amount": amount,
                        "text": line["text"],
                        "xCenter": line["xCenter"],
                    }
                )

        normalized_rows.append(
            {
                "text": row_text,
                "yCenter": row["yCenter"],
                "lines": row_lines,
                "amounts": amount_candidates,
            }
        )

    return normalized_rows


def _find_total_amount_from_text(lines: list[str]) -> str:
    anchor_indexes = [
        index for index, line in enumerate(lines) if re.search(r"\b(total|amount|items|cash|change)\b", line, re.IGNORECASE)
    ]
    anchored_lines = []
    for index in anchor_indexes:
        anchored_lines.extend(lines[max(0, index - 1) : index + 3])

    fallback_lines = lines[-6:]
    scored_candidates = []

    for candidate_index, line in enumerate([*anchored_lines, *fallback_lines]):
        if _is_receipt_meta_line(line):
            continue

        lower_line = line.lower()
        for amount in _collect_amounts_from_line(line):
            score = amount["numericValue"]
            if "total" in lower_line:
                score += 8
            if "cash" in lower_line:
                score += 3
            if "change" in lower_line:
                score -= 18
            if "items" in lower_line:
                score -= 14
            if " x " in lower_line or "x " in lower_line:
                score -= 18
            if re.fullmatch(r"[\d., ]+", line.strip()):
                score += 8

            scored_candidates.append((score, amount["display"]))

    if not scored_candidates:
        return ""

    best_candidate = max(scored_candidates, key=lambda item: item[0])[1]
    return best_candidate


def _find_total_amount_from_ocr_lines(ocr_lines: list[dict]) -> str:
    if not ocr_lines:
        return ""

    rows = _group_ocr_lines_into_rows(ocr_lines)
    if not rows:
        return ""

    page_width = max((line["x2"] for line in ocr_lines), default=0)
    total_row_index = next(
        (
            index
            for index, row in enumerate(rows)
            if re.search(r"\btotal\b", row["text"], re.IGNORECASE)
        ),
        None,
    )

    if total_row_index is not None:
        preferred_rows = rows[total_row_index : min(len(rows), total_row_index + 3)]
        row_candidates = []

        for row_offset, row in enumerate(preferred_rows):
            row_text_lower = row["text"].lower()
            for item in row["amounts"]:
                amount = item["amount"]
                if amount["numericValue"] < 10:
                    continue

                score = 0.0
                if row_offset == 0:
                    score += 28
                elif row_offset == 1:
                    score += 18
                else:
                    score += 8

                if page_width and item["xCenter"] >= page_width * 0.65:
                    score += 16
                if page_width and item["xCenter"] >= page_width * 0.78:
                    score += 8
                if re.fullmatch(r"[\d., ]+", item["text"].strip()):
                    score += 12
                if "total" in row_text_lower:
                    score += 10
                if "items" in row_text_lower:
                    score -= 12
                if "cash" in row_text_lower:
                    score -= 10
                if "change" in row_text_lower:
                    score -= 24
                if " x " in row_text_lower or "x " in row_text_lower:
                    score -= 18
                if amount["numericValue"] >= 50:
                    score += 2

                row_candidates.append((score, amount["display"]))

        if row_candidates:
            return max(row_candidates, key=lambda item: item[0])[1]

    fallback_candidates = []
    for row in rows:
        row_text_lower = row["text"].lower()
        for item in row["amounts"]:
            amount = item["amount"]
            if amount["numericValue"] < 10:
                continue

            score = 0.0
            if page_width and item["xCenter"] >= page_width * 0.7:
                score += 10
            if re.fullmatch(r"[\d., ]+", item["text"].strip()):
                score += 6
            if "cash" in row_text_lower:
                score -= 4
            if "change" in row_text_lower:
                score -= 18
            if "items" in row_text_lower:
                score -= 12
            if " x " in row_text_lower or "x " in row_text_lower:
                score -= 16
            score += min(amount["numericValue"] / 50, 6)

            fallback_candidates.append((score, amount["display"]))

    if not fallback_candidates:
        return ""

    return max(fallback_candidates, key=lambda item: item[0])[1]


def _find_merchant_name_from_text(lines: list[str]) -> str:
    for line in lines:
        normalized_line = line.strip()
        if not normalized_line:
            continue
        if _LINE_HAS_RECEIPT_LINE_PATTERN.search(normalized_line):
            continue
        if not re.search(r"[A-Za-zก-๙]", normalized_line):
            continue
        if re.search(r"\b(total|amount|items|cash|change)\b", normalized_line, re.IGNORECASE):
            continue
        return normalized_line

    return ""


def parse_receipt_text(raw_text: str, ocr_lines: list[dict] | None = None) -> dict:
    lines = _split_receipt_lines(raw_text)
    normalized_ocr_lines = _normalize_ocr_lines(ocr_lines)

    receipt_line = _find_receipt_line_from_ocr_lines(normalized_ocr_lines) or _find_receipt_line_from_text(lines)
    total_amount = _find_total_amount_from_ocr_lines(normalized_ocr_lines) or _find_total_amount_from_text(lines)
    receipt_date, receipt_time = _extract_receipt_line_parts(receipt_line)
    total_amount_value = _parse_total_amount_value(total_amount)
    merchant_name = _find_merchant_name_from_text(lines)

    return {
        "receiptLine": receipt_line,
        "receiptLines": lines,
        "totalAmount": _format_total_amount(total_amount),
        "totalAmountValue": total_amount_value,
        "receiptDate": receipt_date,
        "receiptTime": receipt_time,
        "merchant": merchant_name,
        "merchantName": merchant_name,
    }
