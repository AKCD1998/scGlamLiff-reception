from __future__ import annotations

import cv2
import numpy as np


def _decode_receipt_image(image_bytes: bytes) -> np.ndarray:
    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    decoded_image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

    if decoded_image is None:
        raise ValueError("receipt image could not be decoded")

    return decoded_image


def _resize_for_ocr(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]

    if width == 0 or height == 0:
        raise ValueError("receipt image dimensions are invalid")

    target_min_width = 1400
    target_max_width = 2200

    if width < target_min_width:
        scale = target_min_width / width
    elif width > target_max_width:
        scale = target_max_width / width
    else:
        scale = 1.0

    if scale == 1.0:
        return image

    resized_width = max(1, int(width * scale))
    resized_height = max(1, int(height * scale))

    return cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_CUBIC)


def _to_bgr(gray_image: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(gray_image, cv2.COLOR_GRAY2BGR)


def _find_receipt_crop_bounds(grayscale_image: np.ndarray) -> tuple[int, int, int, int] | None:
    _, paper_mask = cv2.threshold(grayscale_image, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    paper_mask = cv2.morphologyEx(
        paper_mask,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15)),
        iterations=2,
    )

    contours, _ = cv2.findContours(paper_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    image_height, image_width = grayscale_image.shape[:2]
    image_area = image_height * image_width
    best_rect = None
    best_area = 0

    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = width * height

        if area < image_area * 0.18:
            continue

        aspect_ratio = height / max(width, 1)
        if aspect_ratio < 1.2:
            continue

        if area > best_area:
            best_rect = (x, y, width, height)
            best_area = area

    return best_rect


def _crop_with_padding(image: np.ndarray, bounds: tuple[int, int, int, int]) -> np.ndarray:
    x, y, width, height = bounds
    image_height, image_width = image.shape[:2]
    padding_x = int(width * 0.04)
    padding_y = int(height * 0.03)

    left = max(0, x - padding_x)
    top = max(0, y - padding_y)
    right = min(image_width, x + width + padding_x)
    bottom = min(image_height, y + height + padding_y)

    return image[top:bottom, left:right]


def preprocess_receipt_image(
    image_bytes: bytes,
    *,
    filename: str = "",
    content_type: str = "",
) -> dict:
    # First-pass preprocessing tuned for mobile receipt captures:
    # 1. decode and resize for OCR-friendly text scale
    # 2. grayscale cleanup
    # 3. local contrast enhancement
    # 4. denoise
    # 5. thresholded variant for faint print
    _ = filename, content_type

    original_image = _decode_receipt_image(image_bytes)
    resized_image = _resize_for_ocr(original_image)

    grayscale_image = cv2.cvtColor(resized_image, cv2.COLOR_BGR2GRAY)
    contrast_image = cv2.createCLAHE(clipLimit=2.4, tileGridSize=(8, 8)).apply(grayscale_image)
    denoised_image = cv2.fastNlMeansDenoising(contrast_image, None, h=11, templateWindowSize=7, searchWindowSize=21)
    sharpened_image = cv2.addWeighted(contrast_image, 1.45, cv2.GaussianBlur(contrast_image, (0, 0), 3), -0.45, 0)
    threshold_image = cv2.adaptiveThreshold(
        denoised_image,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        15,
    )
    receipt_crop_bounds = _find_receipt_crop_bounds(grayscale_image)

    variants = [
        {"name": "original", "image": resized_image},
        {"name": "contrast", "image": _to_bgr(contrast_image)},
        {"name": "sharpened", "image": _to_bgr(sharpened_image)},
        {"name": "threshold", "image": _to_bgr(threshold_image)},
    ]

    if receipt_crop_bounds:
        cropped_color = _crop_with_padding(resized_image, receipt_crop_bounds)
        cropped_gray = cv2.cvtColor(cropped_color, cv2.COLOR_BGR2GRAY)
        cropped_contrast = cv2.createCLAHE(clipLimit=2.4, tileGridSize=(8, 8)).apply(cropped_gray)
        cropped_denoised = cv2.fastNlMeansDenoising(cropped_contrast, None, h=11, templateWindowSize=7, searchWindowSize=21)
        cropped_threshold = cv2.adaptiveThreshold(
            cropped_denoised,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            15,
        )

        variants.extend(
            [
                {"name": "cropped-original", "image": cropped_color},
                {"name": "cropped-contrast", "image": _to_bgr(cropped_contrast)},
                {"name": "cropped-threshold", "image": _to_bgr(cropped_threshold)},
            ]
        )

    return {
        "width": int(resized_image.shape[1]),
        "height": int(resized_image.shape[0]),
        "variants": variants,
        "cropFound": bool(receipt_crop_bounds),
    }
