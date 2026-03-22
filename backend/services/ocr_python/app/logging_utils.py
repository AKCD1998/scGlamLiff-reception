from __future__ import annotations

import json
import logging
import traceback
from typing import Any


def _serialize_field(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    if isinstance(value, dict):
        return {str(key): _serialize_field(item) for key, item in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [_serialize_field(item) for item in value]

    return str(value)


def log_event(logger: logging.Logger, level: int, event: str, **fields: Any) -> None:
    payload = {"event": event}
    payload.update({key: _serialize_field(value) for key, value in fields.items()})
    logger.log(level, json.dumps(payload, ensure_ascii=False, default=str))


def log_info(logger: logging.Logger, event: str, **fields: Any) -> None:
    log_event(logger, logging.INFO, event, **fields)


def log_exception(logger: logging.Logger, event: str, **fields: Any) -> None:
    payload = {
        "event": event,
        "traceback": traceback.format_exc(),
    }
    payload.update({key: _serialize_field(value) for key, value in fields.items()})
    logger.error(json.dumps(payload, ensure_ascii=False, default=str))
