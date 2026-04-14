"""WebSocket-based Draw Guess bot simulator.

Draw Guess gameplay (guess submissions + drawing) is WS-driven, so this
simulator uses WS for round progression while still using REST for room setup.

Usage:
  python -m app.tests.draw_guess_ws_bot_simulator --base-url http://127.0.0.1:8000 --sessions 20 --players 6 --rounds 6 --workers 5
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import string
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

try:
    import websockets
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "The 'websockets' package is required for this simulator. "
        "Install dependencies and retry."
    ) from exc


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


def _to_ws_base(base_url: str) -> str:
    parsed = urlparse(base_url.rstrip("/"))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    netloc = parsed.netloc
    base_path = parsed.path.rstrip("/")
    return f"{scheme}://{netloc}{base_path}"


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


class SharedRoomState:
    def __init__(self) -> None:
        self._state: dict[str, Any] | None = None
        self._version = 0
        self._event = asyncio.Event()
        self._lock = asyncio.Lock()

    async def update(self, state: dict[str, Any]) -> None:
        async with self._lock:
            self._state = state
            self._version += 1
            self._event.set()

    async def get(self) -> tuple[int, dict[str, Any] | None]:
        async with self._lock:
            return self._version, self._state

    async def wait_newer_than(self, version: int, timeout: float = 5.0) -> tuple[int, dict[str, Any] | None]:
        start = time.time()
        while True:
            cur_version, cur_state = await self.get()
            if cur_version > version:
                return cur_version, cur_state
            remain = timeout - (time.time() - start)
            if remain <= 0:
                return cur_version, cur_state
            self._event.clear()
            try:
                await asyncio.wait_for(self._event.wait(), timeout=remain)
            except asyncio.TimeoutError:
                return await self.get()


class WSPlayerClient:
    def __init__(self, ws_url: str, player_id: str, shared_state: SharedRoomState) -> None:
        self.ws_url = ws_url
        self.player_id = player_id
        self.shared_state = shared_state
        self.ws: websockets.WebSocketClientProtocol | None = None
        self._recv_task: asyncio.Task[None] | None = None
        self._action_counter = 0
        self._pending: dict[str, asyncio.Future[None]] = {}

    def _next_action_id(self) -> str:
        self._action_counter += 1
        return f"draw-ws-{self.player_id[:6]}-{int(time.time() * 1000)}-{self._action_counter}"

    async def connect(self) -> None:
        self.ws = await websockets.connect(self.ws_url, max_size=2**20)
        self._recv_task = asyncio.create_task(self._recv_loop())
        await self.send_action("sync_request", {}, timeout=8.0)

    async def close(self) -> None:
        if self._recv_task:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
            self._recv_task = None
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
            self.ws = None

    async def _recv_loop(self) -> None:
        assert self.ws is not None
        try:
            async for raw in self.ws:
                try:
                    data = json.loads(raw)
                except Exception:
                    continue
                if not isinstance(data, dict):
                    continue

                msg_type = data.get("type")
                if msg_type == "state_sync" and isinstance(data.get("state"), dict):
                    await self.shared_state.update(data["state"])
                    continue

                action_id = data.get("action_id")
                if msg_type == "action_ack" and isinstance(action_id, str):
                    fut = self._pending.pop(action_id, None)
                    if fut and not fut.done():
                        fut.set_result(None)
                    continue

                if msg_type == "action_error" and isinstance(action_id, str):
                    fut = self._pending.pop(action_id, None)
                    if fut and not fut.done():
                        fut.set_exception(RuntimeError(str(data.get("detail") or "action_error")))
                    continue
        except Exception:
            pass
        except asyncio.CancelledError:
            pass

    async def send_action(self, action_type: str, extra: dict[str, Any], timeout: float = 8.0) -> None:
        if not self.ws:
            raise RuntimeError("ws not connected")
        action_id = self._next_action_id()
        message = {
            "type": action_type,
            "player_id": self.player_id,
            "action_id": action_id,
            **extra,
        }
        fut: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self._pending[action_id] = fut
        await self.ws.send(json.dumps(message))
        await asyncio.wait_for(fut, timeout=timeout)


@dataclass
class SessionResult:
    session_index: int
    ok: bool
    room_code: str | None
    elapsed_sec: float
    message: str


async def run_ws_session(
    base_url: str,
    session_index: int,
    players: int,
    rounds: int,
    max_steps: int,
    language: str,
    timer_seconds: int,
) -> SessionResult:
    started = time.time()
    room_code: str | None = None
    ws_clients: list[WSPlayerClient] = []

    try:
        status, cat_data = await asyncio.to_thread(_http_json, base_url, "GET", "/api/draw-guess/categories")
        if status != 200 or not isinstance(cat_data, dict):
            raise RuntimeError(f"load categories failed: status={status} data={cat_data}")
        categories = list(cat_data.get("categories") or [])
        if not categories:
            raise RuntimeError("no draw-guess categories returned")
        chosen_categories = categories[: min(4, len(categories))]

        host_name = f"draw_ws_host_{session_index}_{_rand_suffix(4)}"
        create_payload = {
            "host_name": host_name,
            "character_id": "char1",
            "max_player_count": players,
            "total_rounds": rounds,
            "categories": chosen_categories,
            "language": language,
            "round_timer_seconds": timer_seconds,
        }
        status, create_data = await asyncio.to_thread(
            _http_json, base_url, "POST", "/api/draw-guess/rooms", create_payload
        )
        room = _assert_ok_or_state(status, create_data, "create room")
        room_code = str(room["room_code"])
        host_id = str(room["host_id"])

        known_ids: set[str] = {host_id}
        player_ids: list[str] = [host_id]

        for i in range(2, players + 1):
            join_name = f"draw_ws_{session_index}_{i}_{_rand_suffix(3)}"
            payload = {"player_name": join_name, "character_id": "char1"}
            status, join_data = await asyncio.to_thread(
                _http_json, base_url, "POST", f"/api/draw-guess/rooms/{room_code}/join", payload
            )
            room = _assert_ok_or_state(status, join_data, "join")
            new_id = None
            for p in room.get("players") or []:
                pid = str(p.get("id"))
                if pid and pid not in known_ids:
                    new_id = pid
                    break
            if not new_id:
                raise RuntimeError("could not resolve joined player id")
            known_ids.add(new_id)
            player_ids.append(new_id)

        ws_base = _to_ws_base(base_url)
        shared_state = SharedRoomState()
        id_to_client: dict[str, WSPlayerClient] = {}

        for pid in player_ids:
            ws_url = f"{ws_base}/api/draw-guess/ws/{room_code}?player_id={pid}"
            client = WSPlayerClient(ws_url, pid, shared_state)
            await client.connect()
            ws_clients.append(client)
            id_to_client[pid] = client

        await id_to_client[host_id].send_action("start_game", {})

        last_seen_version = 0
        for step in range(max_steps):
            last_seen_version, state = await shared_state.wait_newer_than(last_seen_version, timeout=2.5)
            if not isinstance(state, dict):
                status, polled = await asyncio.to_thread(
                    _http_json, base_url, "GET", f"/api/draw-guess/rooms/{room_code}"
                )
                if status != 200 or not isinstance(polled, dict):
                    raise RuntimeError(f"state unavailable: status={status} data={polled}")
                state = polled

            if state.get("ended") or state.get("phase") == "game_over":
                elapsed = time.time() - started
                winners = state.get("winner_ids") or []
                return SessionResult(
                    session_index=session_index,
                    ok=True,
                    room_code=room_code,
                    elapsed_sec=elapsed,
                    message=f"completed in {step + 1} steps winners={len(winners)}",
                )

            phase = state.get("phase")

            if phase == "word_choice":
                drawer_id = str(state.get("current_drawer_id") or "")
                if drawer_id in id_to_client:
                    choices = state.get("current_word_choices") or []
                    if choices:
                        chosen = random.choice(choices)
                        chosen_word = str(chosen.get("word_en") or "")
                        if chosen_word:
                            await id_to_client[drawer_id].send_action(
                                "select_word",
                                {"chosen_word_en": chosen_word},
                            )
                continue

            if phase == "drawing":
                drawer_id = str(state.get("current_drawer_id") or "")
                word = str(state.get("current_word_en") or "")
                guessed = set(state.get("guessed_correctly_player_ids") or [])
                players_state = state.get("players") or []

                if drawer_id in id_to_client:
                    try:
                        x0 = random.uniform(20, 400)
                        y0 = random.uniform(20, 300)
                        x1 = x0 + random.uniform(-15, 15)
                        y1 = y0 + random.uniform(-15, 15)
                        await id_to_client[drawer_id].send_action(
                            "draw",
                            {
                                "x0": x0,
                                "y0": y0,
                                "x1": x1,
                                "y1": y1,
                                "color": "#000000",
                                "width": 3,
                            },
                            timeout=3.0,
                        )
                    except Exception:
                        pass

                for p in players_state:
                    pid = str(p.get("id"))
                    if not pid or pid == drawer_id or pid in guessed or pid not in id_to_client:
                        continue
                    guess_text = word if word else f"guess-{_rand_suffix(6)}"
                    try:
                        await id_to_client[pid].send_action(
                            "guess",
                            {"text": guess_text},
                            timeout=4.0,
                        )
                    except Exception:
                        pass
                continue

            if phase == "round_result":
                await id_to_client[host_id].send_action("advance_round", {})
                continue

            await asyncio.sleep(0.03)

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
        for client in ws_clients:
            await client.close()


async def run_all(args: argparse.Namespace) -> int:
    started = time.time()
    sem = asyncio.Semaphore(args.workers)
    results: list[SessionResult] = []

    async def one(idx: int) -> SessionResult:
        async with sem:
            return await run_ws_session(
                base_url=args.base_url,
                session_index=idx,
                players=args.players,
                rounds=args.rounds,
                max_steps=args.max_steps,
                language=args.language,
                timer_seconds=args.round_timer_seconds,
            )

    tasks = [asyncio.create_task(one(i + 1)) for i in range(args.sessions)]
    for coro in asyncio.as_completed(tasks):
        result = await coro
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
        f"players={args.players} rounds={args.rounds} workers={args.workers} elapsed={elapsed:.2f}s"
    )
    return 0 if fail_count == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Run WebSocket-based Draw Guess bot sessions.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="API base URL")
    parser.add_argument("--sessions", type=int, default=10, help="Number of sessions to run")
    parser.add_argument("--players", type=int, default=4, help="Players per session (2-10)")
    parser.add_argument("--rounds", type=int, default=4, help="Rounds per session (1-20)")
    parser.add_argument("--workers", type=int, default=4, help="Parallel sessions")
    parser.add_argument("--max-steps", type=int, default=500, help="Max phase loop steps per session")
    parser.add_argument("--language", choices=("en", "ar"), default="en", help="Game language")
    parser.add_argument("--round-timer-seconds", type=int, default=30, help="Round timer seconds (30-120)")
    args = parser.parse_args()

    if args.players < 2 or args.players > 10:
        raise SystemExit("--players must be between 2 and 10")
    if args.rounds < 1 or args.rounds > 20:
        raise SystemExit("--rounds must be between 1 and 20")
    if args.sessions < 1:
        raise SystemExit("--sessions must be >= 1")
    if args.workers < 1:
        raise SystemExit("--workers must be >= 1")
    if args.round_timer_seconds < 30 or args.round_timer_seconds > 120:
        raise SystemExit("--round-timer-seconds must be between 30 and 120")

    return asyncio.run(run_all(args))


if __name__ == "__main__":
    raise SystemExit(main())
