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
        if player_id:
            await self.register_player(room_code, player_id, websocket)
            return

        self.anonymous_rooms.setdefault(room_code, []).append(websocket)
        self.socket_index[id(websocket)] = (room_code, None)

    async def register_player(self, room_code: str, player_id: str, websocket: WebSocket):
        room_connections = self.rooms.setdefault(room_code, {})
        existing_socket = room_connections.get(player_id)

        if existing_socket is websocket:
            self.socket_index[id(websocket)] = (room_code, player_id)
            return

        self._remove_socket_reference(room_code, websocket)

        if existing_socket is not None:
            self._remove_socket_reference(room_code, existing_socket, expected_player_id=player_id)
            await self._close_socket(existing_socket)

        room_connections[player_id] = websocket
        self.socket_index[id(websocket)] = (room_code, player_id)

    def disconnect(self, room_code: str, websocket: WebSocket):
        tracked_room_code, player_id = self.socket_index.get(id(websocket), (room_code, None))
        self._remove_socket_reference(tracked_room_code, websocket, expected_player_id=player_id)

    async def broadcast(self, room_code: str, message: dict):
        registered_connections = list(self.rooms.get(room_code, {}).items())
        anonymous_connections = list(self.anonymous_rooms.get(room_code, []))
        dead_registered: list[tuple[str, WebSocket]] = []
        dead_anonymous: list[WebSocket] = []

        for player_id, websocket in registered_connections:
            try:
                await websocket.send_json(message)
            except (WebSocketDisconnect, RuntimeError):
                dead_registered.append((player_id, websocket))
            except Exception:
                logger.exception("Bluff WS broadcast send failed room=%s player=%s", room_code, player_id)
                dead_registered.append((player_id, websocket))

        for websocket in anonymous_connections:
            try:
                await websocket.send_json(message)
            except (WebSocketDisconnect, RuntimeError):
                dead_anonymous.append(websocket)
            except Exception:
                logger.exception("Bluff WS broadcast send failed room=%s player=anonymous", room_code)
                dead_anonymous.append(websocket)

        for player_id, websocket in dead_registered:
            self._remove_socket_reference(room_code, websocket, expected_player_id=player_id)

        for websocket in dead_anonymous:
            self._remove_socket_reference(room_code, websocket)

    async def send_to_player(self, room_code: str, player_id: str, message: dict):
        websocket = self.rooms.get(room_code, {}).get(player_id)
        if websocket is None:
            return

        try:
            await websocket.send_json(message)
        except (WebSocketDisconnect, RuntimeError):
            self._remove_socket_reference(room_code, websocket, expected_player_id=player_id)
        except Exception:
            logger.exception("Bluff WS private send failed room=%s player=%s", room_code, player_id)
            self._remove_socket_reference(room_code, websocket, expected_player_id=player_id)

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
            logger.exception("Bluff WS failed to close replaced socket")


manager = RoomConnectionManager()
