"""Automated Bluff bot simulator for multi-session testing.

Usage examples:
  python -m app.tests.bluff_bot_simulator --base-url http://127.0.0.1:8000 --sessions 20 --players 5 --workers 5
  python -m app.tests.bluff_bot_simulator --sessions 50 --players 8 --rounds 8 --workers 10
"""

from __future__ import annotations

import argparse
import json
import random
import string
import time
from http.client import HTTPConnection, HTTPSConnection
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _now_ms() -> int:
    return int(time.time() * 1000)


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
                # Reset and retry once with a fresh socket.
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


@dataclass
class SessionResult:
    session_index: int
    ok: bool
    room_code: str | None
    elapsed_sec: float
    message: str


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


def run_bluff_session(
    base_url: str,
    session_index: int,
    players: int,
    rounds: int,
    max_steps: int = 300,
) -> SessionResult:
    started = time.time()
    room_code: str | None = None

    client = PersistentApiClient(base_url=base_url, timeout=10.0)
    try:
        # 1) categories
        status, data = client.request_json("GET", "/api/bluff/categories")
        if status != 200 or not isinstance(data, dict):
            raise RuntimeError(f"load categories failed: status={status}, data={data}")
        categories = list(data.get("categories") or [])
        if not categories:
            raise RuntimeError("no bluff categories returned by backend")

        chosen_categories = categories[: min(4, len(categories))]
        if not chosen_categories:
            chosen_categories = [categories[0]]

        # 2) create room
        host_name = f"bot_host_{session_index}_{_rand_suffix(4)}"
        create_payload = {
            "host_name": host_name,
            "character_id": "char1",
            "max_player_count": players,
            "total_rounds": rounds,
            "categories": chosen_categories,
            "round_timer_seconds": 30,
        }
        status, data = client.request_json("POST", "/api/bluff/rooms", create_payload)
        room = _assert_ok_or_state(status, data, "create room")
        room_code = str(room["room_code"])
        host_id = str(room["host_id"])

        known_ids: set[str] = {host_id}
        player_order: list[str] = [host_id]

        # 3) join bots
        for i in range(2, players + 1):
            join_name = f"bot_{session_index}_{i}_{_rand_suffix(3)}"
            join_payload = {"player_name": join_name, "character_id": "char1"}
            status, data = client.request_json("POST", f"/api/bluff/rooms/{room_code}/join", join_payload)
            room = _assert_ok_or_state(status, data, f"join player {i}")
            players_state = room.get("players") or []
            new_id = None
            for p in players_state:
                pid = str(p.get("id"))
                if pid and pid not in known_ids:
                    new_id = pid
                    break
            if not new_id:
                # fallback: find by name
                for p in players_state:
                    if p.get("name") == join_name:
                        new_id = str(p.get("id"))
                        break
            if not new_id:
                raise RuntimeError(f"failed to identify joined player id for {join_name}")
            known_ids.add(new_id)
            player_order.append(new_id)

        # 4) start game
        status, data = client.request_json("POST", f"/api/bluff/rooms/{room_code}/start", {})
        room = _assert_ok_or_state(status, data, "start game")

        # 5) play loop
        for step in range(max_steps):
            status, data = client.request_json("GET", f"/api/bluff/rooms/{room_code}")
            if status != 200 or not isinstance(data, dict):
                raise RuntimeError(f"get room failed at step {step}: status={status} data={data}")
            room = data

            if room.get("ended") or room.get("phase") == "game_over":
                elapsed = time.time() - started
                winners = room.get("winner_ids") or []
                return SessionResult(
                    session_index=session_index,
                    ok=True,
                    room_code=room_code,
                    elapsed_sec=elapsed,
                    message=f"completed in {step + 1} steps winners={len(winners)}",
                )

            phase = room.get("phase")

            if phase == "category_pick":
                chooser_id = str(room.get("current_category_chooser_id") or "")
                allowed = room.get("categories") or chosen_categories
                category = random.choice(allowed)
                payload = {"player_id": chooser_id, "category": category}
                status, data = client.request_json("POST", f"/api/bluff/rooms/{room_code}/select-category", payload)
                _assert_ok_or_state(status, data, "select category")
                continue

            if phase == "submission":
                submitted = set(room.get("submitted_player_ids") or [])
                for pid in [str(p.get("id")) for p in (room.get("players") or [])]:
                    if pid in submitted:
                        continue
                    fake_answer = f"bot-answer-{_rand_suffix(8)}"
                    payload = {"player_id": pid, "answer_text": fake_answer}
                    status, data = client.request_json("POST", f"/api/bluff/rooms/{room_code}/submit-answer", payload)
                    # If one answer races into next phase, keep going.
                    if status not in (200, 201, 400, 409):
                        raise RuntimeError(f"submit answer failed: status={status} data={data}")
                continue

            if phase == "answer_pick":
                picks = set(room.get("picked_player_ids") or [])
                options = room.get("answer_options") or []
                for p in (room.get("players") or []):
                    pid = str(p.get("id"))
                    if pid in picks:
                        continue
                    valid_options = [o for o in options if pid not in set(o.get("author_ids") or [])]
                    if not valid_options:
                        continue
                    option = random.choice(valid_options)
                    payload = {"player_id": pid, "option_id": option.get("id")}
                    status, data = client.request_json("POST", f"/api/bluff/rooms/{room_code}/submit-pick", payload)
                    if status not in (200, 201, 400, 409):
                        raise RuntimeError(f"submit pick failed: status={status} data={data}")
                continue

            if phase == "round_result":
                payload = {"player_id": host_id}
                status, data = client.request_json("POST", f"/api/bluff/rooms/{room_code}/advance", payload)
                _assert_ok_or_state(status, data, "advance round")
                continue

            # Unknown/transition phase: short sleep and retry.
            time.sleep(0.05)

        raise RuntimeError(f"max steps reached ({max_steps}) without game_over")

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


def main() -> int:
    parser = argparse.ArgumentParser(description="Run automated Bluff bot sessions against the API.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="API base URL")
    parser.add_argument("--sessions", type=int, default=10, help="Number of game sessions to run")
    parser.add_argument("--players", type=int, default=4, help="Players per session (2-10)")
    parser.add_argument("--rounds", type=int, default=4, help="Rounds per session")
    parser.add_argument("--workers", type=int, default=4, help="Parallel sessions")
    parser.add_argument("--max-steps", type=int, default=300, help="Max state loop steps per session")
    args = parser.parse_args()

    if args.players < 2 or args.players > 10:
        raise SystemExit("--players must be between 2 and 10")
    if args.rounds < args.players:
        raise SystemExit("--rounds must be >= --players for Bluff")
    if args.sessions < 1:
        raise SystemExit("--sessions must be >= 1")
    if args.workers < 1:
        raise SystemExit("--workers must be >= 1")

    started = time.time()
    results: list[SessionResult] = []
    ok_count = 0

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [
            executor.submit(
                run_bluff_session,
                args.base_url,
                idx + 1,
                args.players,
                args.rounds,
                args.max_steps,
            )
            for idx in range(args.sessions)
        ]
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            tag = "OK" if result.ok else "FAIL"
            print(
                f"[{tag}] session={result.session_index} room={result.room_code or '-'} "
                f"time={result.elapsed_sec:.2f}s msg={result.message}"
            )
            if result.ok:
                ok_count += 1

    fail_count = len(results) - ok_count
    elapsed = time.time() - started
    print("-" * 80)
    print(
        f"Finished sessions={len(results)} ok={ok_count} fail={fail_count} "
        f"players={args.players} rounds={args.rounds} workers={args.workers} elapsed={elapsed:.2f}s"
    )

    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
