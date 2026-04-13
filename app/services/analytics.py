"""PostHog analytics helper."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any

try:
    from posthog import Posthog
except Exception:  # pragma: no cover - optional dependency fallback
    Posthog = None  # type: ignore[assignment]

from app.config import settings


logger = logging.getLogger(__name__)

_posthog_client: Posthog | None = None


def _is_posthog_enabled() -> bool:
    key = (settings.posthog_api_key or "").strip()
    return bool(key) and key != "POSTHOG_API_KEY"


def _get_client() -> Posthog | None:
    global _posthog_client
    if _posthog_client is not None:
        return _posthog_client

    if Posthog is None:
        return None

    if not _is_posthog_enabled():
        return None

    try:
        _posthog_client = Posthog(
            project_api_key=settings.posthog_api_key,
            host=settings.posthog_host,
            disable_geoip=False,
        )
    except Exception:
        logger.exception("Failed to initialize PostHog client.")
        _posthog_client = None

    return _posthog_client


def track_event(distinct_id: str, event: str, properties: dict[str, Any] | None = None) -> None:
    """Send one analytics event to PostHog."""
    client = _get_client()
    if client is None:
        return

    payload = dict(properties or {})
    payload.setdefault("timestamp", datetime.now(timezone.utc).isoformat())

    try:
        client.capture(
            distinct_id=distinct_id,
            event=event,
            properties=payload,
        )
        if settings.debug:
            logger.info("Analytics event sent: %s", event)
    except Exception:
        logger.exception("Analytics capture failed for event=%s", event)


def track_event_async(distinct_id: str, event: str, properties: dict[str, Any] | None = None) -> None:
    """Send analytics event asynchronously so request flow is never blocked."""

    def _worker() -> None:
        track_event(distinct_id=distinct_id, event=event, properties=properties)

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
