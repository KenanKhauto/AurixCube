import logging
from typing import Dict, List, Optional

from fastapi import WebSocket, WebSocketDisconnect


logger = logging.getLogger(__name__)


class RoomConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Dict[str, WebSocket]] = {}
        self.anonymous_rooms: Dict[str, List[WebSocket]] = {}
        self.socket_index: Dict[int, tuple[str, Optional[str]]] = {}

    async def connect(self, room_code: str, websocket: WebSocket, player_id: str | None = None):
        await websocket.accept()
        logger.info("Draw WS connect accepted room=%s player=%s", room_code, player_id or "anonymous")

        if player_id:
            await self.register_player(room_code, player_id, websocket)
            return

        self.anonymous_rooms.setdefault(room_code, []).append(websocket)
        self.socket_index[id(websocket)] = (room_code, None)
        logger.info(
            "Draw WS anonymous socket registered room=%s connections=%s",
            room_code,
            self.room_connection_count(room_code),
        )

    async def register_player(self, room_code: str, player_id: str, websocket: WebSocket):
        room_connections = self.rooms.setdefault(room_code, {})
        existing_socket = room_connections.get(player_id)

        if existing_socket is websocket:
            self.socket_index[id(websocket)] = (room_code, player_id)
            return

        self._remove_socket_reference(room_code, websocket)

        if existing_socket is not None:
            logger.info("Draw WS replacing socket room=%s player=%s", room_code, player_id)
            self._remove_socket_reference(room_code, existing_socket, expected_player_id=player_id)
            await self._close_socket(existing_socket)

        room_connections[player_id] = websocket
        self.socket_index[id(websocket)] = (room_code, player_id)
        logger.info(
            "Draw WS player registered room=%s player=%s connections=%s",
            room_code,
            player_id,
            self.room_connection_count(room_code),
        )

    def disconnect(self, room_code: str, websocket: WebSocket):
        tracked_room_code, player_id = self.socket_index.get(id(websocket), (room_code, None))
        removed_player_id = self._remove_socket_reference(tracked_room_code, websocket, expected_player_id=player_id)
        logger.info(
            "Draw WS disconnect room=%s player=%s connections=%s",
            tracked_room_code,
            removed_player_id or player_id or "anonymous",
            self.room_connection_count(tracked_room_code),
        )

    async def broadcast(self, room_code: str, message: dict):
        registered_connections = list(self.rooms.get(room_code, {}).items())
        anonymous_connections = list(self.anonymous_rooms.get(room_code, []))
        dead_registered: list[tuple[str, WebSocket]] = []
        dead_anonymous: list[WebSocket] = []

        for player_id, websocket in registered_connections:
            try:
                await websocket.send_json(message)
            except WebSocketDisconnect:
                logger.warning("Draw WS broadcast disconnect room=%s player=%s", room_code, player_id)
                dead_registered.append((player_id, websocket))
            except RuntimeError as exc:
                logger.warning(
                    "Draw WS broadcast runtime failure room=%s player=%s error=%s",
                    room_code,
                    player_id,
                    exc,
                )
                dead_registered.append((player_id, websocket))
            except Exception as exc:
                logger.exception(
                    "Draw WS broadcast send failed room=%s player=%s error=%s",
                    room_code,
                    player_id,
                    exc,
                )
                dead_registered.append((player_id, websocket))

        for websocket in anonymous_connections:
            try:
                await websocket.send_json(message)
            except WebSocketDisconnect:
                logger.warning("Draw WS broadcast disconnect room=%s player=anonymous", room_code)
                dead_anonymous.append(websocket)
            except RuntimeError as exc:
                logger.warning(
                    "Draw WS broadcast runtime failure room=%s player=anonymous error=%s",
                    room_code,
                    exc,
                )
                dead_anonymous.append(websocket)
            except Exception as exc:
                logger.exception(
                    "Draw WS broadcast send failed room=%s player=anonymous error=%s",
                    room_code,
                    exc,
                )
                dead_anonymous.append(websocket)

        for player_id, websocket in dead_registered:
            self._remove_socket_reference(room_code, websocket, expected_player_id=player_id)
            logger.info(
                "Draw WS stale socket removed room=%s player=%s connections=%s",
                room_code,
                player_id,
                self.room_connection_count(room_code),
            )

        for websocket in dead_anonymous:
            self._remove_socket_reference(room_code, websocket)
            logger.info(
                "Draw WS stale anonymous socket removed room=%s connections=%s",
                room_code,
                self.room_connection_count(room_code),
            )

    async def send_to_player(self, room_code: str, player_id: str, message: dict):
        websocket = self.rooms.get(room_code, {}).get(player_id)
        if websocket is None:
            return

        try:
            await websocket.send_json(message)
        except WebSocketDisconnect:
            logger.warning("Draw WS private send disconnect room=%s player=%s", room_code, player_id)
            self._remove_socket_reference(room_code, websocket, expected_player_id=player_id)
        except RuntimeError as exc:
            logger.warning(
                "Draw WS private send runtime failure room=%s player=%s error=%s",
                room_code,
                player_id,
                exc,
            )
            self._remove_socket_reference(room_code, websocket, expected_player_id=player_id)
        except Exception as exc:
            logger.exception(
                "Draw WS private send failed room=%s player=%s error=%s",
                room_code,
                player_id,
                exc,
            )
            self._remove_socket_reference(room_code, websocket, expected_player_id=player_id)

    def room_connection_count(self, room_code: str) -> int:
        return len(self.rooms.get(room_code, {})) + len(self.anonymous_rooms.get(room_code, []))

    def _remove_socket_reference(
        self,
        room_code: str,
        websocket: WebSocket,
        expected_player_id: str | None = None,
    ) -> str | None:
        removed_player_id = None

        room_connections = self.rooms.get(room_code)
        if room_connections:
            if expected_player_id:
                mapped_socket = room_connections.get(expected_player_id)
                if mapped_socket is websocket:
                    room_connections.pop(expected_player_id, None)
                    removed_player_id = expected_player_id
            else:
                for player_id, mapped_socket in list(room_connections.items()):
                    if mapped_socket is websocket:
                        room_connections.pop(player_id, None)
                        removed_player_id = player_id
                        break

            if not room_connections:
                self.rooms.pop(room_code, None)

        anonymous_connections = self.anonymous_rooms.get(room_code)
        if anonymous_connections:
            updated_connections = [connection for connection in anonymous_connections if connection is not websocket]
            if updated_connections:
                self.anonymous_rooms[room_code] = updated_connections
            else:
                self.anonymous_rooms.pop(room_code, None)

        self.socket_index.pop(id(websocket), None)
        return removed_player_id

    async def _close_socket(self, websocket: WebSocket):
        try:
            await websocket.close()
        except RuntimeError:
            pass
        except Exception:
            logger.exception("Draw WS failed to close replaced socket")


manager = RoomConnectionManager()
