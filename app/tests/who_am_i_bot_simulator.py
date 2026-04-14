"""Automated Who Am I bot simulator for multi-session testing.

Usage examples:
  python -m app.tests.who_am_i_bot_simulator --base-url http://127.0.0.1:8000 --sessions 20 --players 6 --workers 5
  python -m app.tests.who_am_i_bot_simulator --sessions 50 --players 10 --workers 10 --max-steps 500
"""

from __future__ import annotations

import argparse
import json
import random
import string
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from http.client import HTTPConnection, HTTPSConnection
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def _rand_suffix(size: int = 6) -> str:
    return "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(size))


def _http_json(
    base_url: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    timeout: float = 10.0,
) -> tuple[int, Any]:
    url = f"{base_url.rstrip('/')}{path}"
    data_bytes = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data_bytes = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url=url, data=data_bytes, headers=headers, method=method.upper())
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {"detail": raw}
        except json.JSONDecodeError:
            parsed = {"detail": raw}
        return exc.code, parsed
    except URLError as exc:
        return 0, {"detail": f"Network error: {exc}"}


class PersistentApiClient:
    """Simple persistent HTTP client (one connection reused per bot session)."""

    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        parsed = urlparse(base_url.rstrip("/"))
        if not parsed.scheme or not parsed.netloc:
            raise ValueError(f"Invalid base URL: {base_url}")

        self.scheme = parsed.scheme.lower()
        self.host = parsed.hostname or "127.0.0.1"
        self.port = parsed.port or (443 if self.scheme == "https" else 80)
        self.base_path = parsed.path.rstrip("/")
        self.timeout = timeout
        self._conn: HTTPConnection | HTTPSConnection | None = None

    def _new_connection(self) -> HTTPConnection | HTTPSConnection:
        if self.scheme == "https":
            return HTTPSConnection(self.host, self.port, timeout=self.timeout)
        return HTTPConnection(self.host, self.port, timeout=self.timeout)

    def _ensure_connection(self) -> HTTPConnection | HTTPSConnection:
        if self._conn is None:
            self._conn = self._new_connection()
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    def request_json(self, method: str, path: str, payload: dict[str, Any] | None = None) -> tuple[int, Any]:
        method = method.upper()
        final_path = f"{self.base_path}{path}"
        headers = {"Accept": "application/json"}
        body: str | None = None
        if payload is not None:
            body = json.dumps(payload)
            headers["Content-Type"] = "application/json"

        for attempt in range(2):
            conn = self._ensure_connection()
            try:
                conn.request(method, final_path, body=body, headers=headers)
                response = conn.getresponse()
                status = int(response.status)
                raw = response.read().decode("utf-8", errors="replace")
                try:
                    data = json.loads(raw) if raw else {}
                except json.JSONDecodeError:
                    data = {"detail": raw}
                return status, data
            except Exception as exc:
                self.close()
                if attempt == 0:
                    continue
                return 0, {"detail": f"Network error: {exc}"}

        return 0, {"detail": "Network error: unknown"}


def _extract_state_from_error(data: Any) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        return None
    detail = data.get("detail")
    if isinstance(detail, dict):
        state = detail.get("state")
        if isinstance(state, dict):
            return state
    return None


def _assert_ok_or_state(status_code: int, data: Any, action: str) -> dict[str, Any]:
    if status_code in (200, 201):
        if isinstance(data, dict):
            return data
        raise RuntimeError(f"{action} returned non-object JSON.")
    if status_code == 409:
        state = _extract_state_from_error(data)
        if state is not None:
            return state
    raise RuntimeError(f"{action} failed: status={status_code} detail={data}")


@dataclass
class SessionResult:
    session_index: int
    ok: bool
    room_code: str | None
    elapsed_sec: float
    message: str


def _resolve_identity_guess(
    client: PersistentApiClient,
    room_code: str,
    room_state: dict[str, Any],
    target_player_id: str,
    host_id: str,
) -> str:
    players = room_state.get("players") or []
    if not players:
        return f"guess-{_rand_suffix(8)}"

    viewer_candidates = [str(p.get("id")) for p in players if str(p.get("id")) != target_player_id]
    if host_id in viewer_candidates:
        viewer_candidates = [host_id] + [pid for pid in viewer_candidates if pid != host_id]

    for viewer_id in viewer_candidates:
        status, data = client.request_json(
            "POST",
            f"/api/who-am-i/rooms/{room_code}/player-knowledge",
            {"player_id": viewer_id},
        )
        if status != 200 or not isinstance(data, dict):
            continue
        visible_players = data.get("players") or []
        for p in visible_players:
            if str(p.get("id")) == target_player_id:
                identity = p.get("visible_identity")
                if identity and isinstance(identity, str):
                    return identity

    return f"guess-{_rand_suffix(8)}"


def run_who_am_i_session(
    base_url: str,
    session_index: int,
    players: int,
    max_steps: int = 400,
) -> SessionResult:
    started = time.time()
    room_code: str | None = None

    client = PersistentApiClient(base_url=base_url, timeout=10.0)
    try:
        status, data = client.request_json("GET", "/api/who-am-i/categories")
        if status != 200 or not isinstance(data, dict):
            raise RuntimeError(f"load categories failed: status={status}, data={data}")

        categories_map = data.get("categories") or {}
        if not isinstance(categories_map, dict) or not categories_map:
            raise RuntimeError("no who-am-i categories returned by backend")
        category_names = list(categories_map.keys())
        chosen_categories = category_names[: min(4, len(category_names))]

        host_name = f"who_host_{session_index}_{_rand_suffix(4)}"
        create_payload = {
            "host_name": host_name,
            "character_id": "char1",
            "max_player_count": players,
            "categories": chosen_categories,
        }
        status, data = client.request_json("POST", "/api/who-am-i/rooms", create_payload)
        room = _assert_ok_or_state(status, data, "create room")
        room_code = str(room["room_code"])
        host_id = str(room["host_id"])

        known_ids: set[str] = {host_id}
        for i in range(2, players + 1):
            join_name = f"who_{session_index}_{i}_{_rand_suffix(3)}"
            join_payload = {"player_name": join_name, "character_id": "char1"}
            status, data = client.request_json("POST", f"/api/who-am-i/rooms/{room_code}/join", join_payload)
            room = _assert_ok_or_state(status, data, f"join player {i}")
            players_state = room.get("players") or []
            new_id = None
            for p in players_state:
                pid = str(p.get("id"))
                if pid and pid not in known_ids:
                    new_id = pid
                    break
            if not new_id:
                for p in players_state:
                    if p.get("name") == join_name:
                        new_id = str(p.get("id"))
                        break
            if not new_id:
                raise RuntimeError(f"failed to identify joined player id for {join_name}")
            known_ids.add(new_id)

        status, data = client.request_json("POST", f"/api/who-am-i/rooms/{room_code}/start", {})
        _assert_ok_or_state(status, data, "start game")

        for step in range(max_steps):
            status, room = client.request_json("GET", f"/api/who-am-i/rooms/{room_code}")
            if status != 200 or not isinstance(room, dict):
                raise RuntimeError(f"get room failed at step {step}: status={status} data={room}")

            if room.get("ended"):
                elapsed = time.time() - started
                solved = sum(1 for p in (room.get("players") or []) if p.get("has_guessed_correctly"))
                return SessionResult(
                    session_index=session_index,
                    ok=True,
                    room_code=room_code,
                    elapsed_sec=elapsed,
                    message=f"completed in {step + 1} steps solved={solved}",
                )

            if room.get("reveal_phase_active"):
                current_reveal_player_id = str(room.get("current_reveal_player_id") or "")
                if current_reveal_player_id:
                    client.request_json(
                        "POST",
                        f"/api/who-am-i/rooms/{room_code}/reveal-view",
                        {"player_id": current_reveal_player_id},
                    )
                status, data = client.request_json(
                    "POST",
                    f"/api/who-am-i/rooms/{room_code}/confirm-reveal",
                    {"player_id": host_id},
                )
                _assert_ok_or_state(status, data, "confirm reveal")
                continue

            turn_player_id = str(room.get("current_turn_player_id") or "")
            if not turn_player_id:
                time.sleep(0.02)
                continue

            guess_text = _resolve_identity_guess(client, room_code, room, turn_player_id, host_id)
            status, data = client.request_json(
                "POST",
                f"/api/who-am-i/rooms/{room_code}/guess",
                {"player_id": turn_player_id, "guess_text": guess_text},
            )
            _assert_ok_or_state(status, data, "submit guess")

        raise RuntimeError(f"max steps reached ({max_steps}) without game end")
    except Exception as exc:
        elapsed = time.time() - started
        return SessionResult(
            session_index=session_index,
            ok=False,
            room_code=room_code,
            elapsed_sec=elapsed,
            message=str(exc),
        )
    finally:
        client.close()


def run_all_sessions(
    base_url: str,
    sessions: int,
    players: int,
    workers: int,
    max_steps: int,
) -> int:
    started = time.time()
    results: list[SessionResult] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                run_who_am_i_session,
                base_url,
                idx + 1,
                players,
                max_steps,
            ): idx + 1
            for idx in range(sessions)
        }
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            tag = "OK" if result.ok else "FAIL"
            print(
                f"[{tag}] session={result.session_index} room={result.room_code or '-'} "
                f"time={result.elapsed_sec:.2f}s msg={result.message}"
            )

    ok_count = sum(1 for r in results if r.ok)
    fail_count = len(results) - ok_count
    elapsed = time.time() - started
    print("-" * 80)
    print(
        f"Finished sessions={len(results)} ok={ok_count} fail={fail_count} "
        f"players={players} workers={workers} elapsed={elapsed:.2f}s"
    )
    return 0 if fail_count == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Run automated Who Am I bot sessions.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="API base URL")
    parser.add_argument("--sessions", type=int, default=10, help="Number of sessions to run")
    parser.add_argument("--players", type=int, default=4, help="Players per session (2-12)")
    parser.add_argument("--workers", type=int, default=4, help="Parallel sessions")
    parser.add_argument("--max-steps", type=int, default=400, help="Max loop steps per session")
    args = parser.parse_args()

    if args.players < 2 or args.players > 12:
        raise SystemExit("--players must be between 2 and 12")
    if args.sessions < 1:
        raise SystemExit("--sessions must be >= 1")
    if args.workers < 1:
        raise SystemExit("--workers must be >= 1")

    return run_all_sessions(
        base_url=args.base_url,
        sessions=args.sessions,
        players=args.players,
        workers=args.workers,
        max_steps=args.max_steps,
    )


if __name__ == "__main__":
    raise SystemExit(main())
