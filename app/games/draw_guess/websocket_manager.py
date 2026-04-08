from typing import Dict, List
from fastapi import WebSocket


class RoomConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, List[WebSocket]] = {}
        self.player_websockets: Dict[str, WebSocket] = {}  # player_id -> websocket

    async def connect(self, room_code: str, websocket: WebSocket):
        await websocket.accept()
        self.rooms.setdefault(room_code, []).append(websocket)

    def disconnect(self, room_code: str, websocket: WebSocket, service):
        if room_code in self.rooms:
            self.rooms[room_code].remove(websocket)

        # Find player_id
        player_id = None
        for pid, ws in self.player_websockets.items():
            if ws == websocket:
                player_id = pid
                break

        if player_id:
            del self.player_websockets[player_id]
            # Remove player from room
            try:
                service.leave_room(room_code, player_id)
            except Exception:
                # Player already left or not found, ignore
                pass

    async def broadcast(self, room_code: str, message: dict):
        for ws in self.rooms.get(room_code, []):
            await ws.send_json(message)


manager = RoomConnectionManager()