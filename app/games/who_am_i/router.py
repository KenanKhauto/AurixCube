"""API routes for the Who Am I game."""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.auth.dependencies import get_current_user_optional
from app.db.models.user import User
from app.games.who_am_i.constants import CATEGORIES
from app.games.who_am_i.schemas import (
    ConfirmRevealRequest,
    CreateRoomRequest,
    DeleteRoomRequest,
    JoinRoomRequest,
    LeaveRoomRequest,
    PlayerView,
    RemovePlayerRequest,
    RestartRoomRequest,
    RevealIdentityRequest,
    RoomStateResponse,
    SubmitGuessRequest,
    UpdateCategoriesRequest,
    UpdateCharacterRequest,
    RevealViewRequest,
    PlayerKnowledgeViewRequest,
)
from app.games.who_am_i.service import WhoAmIService
from app.games.who_am_i.websocket_manager import manager
from app.services.analytics import track_event_async

router = APIRouter()
service = WhoAmIService()
logger = logging.getLogger(__name__)


def build_room_response(room) -> RoomStateResponse:
    """Convert domain room to API response schema."""
    return RoomStateResponse(
        room_code=room.room_code,
        room_version=room.room_version,
        host_id=room.host_id,
        categories=room.categories,
        max_player_count=room.max_player_count,
        started=room.started,
        ended=room.ended,
        end_reason=room.end_reason,
        reveal_phase_active=room.reveal_phase_active,
        reveal_order=room.reveal_order,
        current_reveal_player_id=room.current_reveal_player_id,
        current_turn_player_id=room.current_turn_player_id,
        active_turn_order=room.active_turn_order,
        full_turn_order=room.full_turn_order,
        turn_number=room.turn_number,
        players=[
            PlayerView(
                id=player.id,
                name=player.name,
                username=player.username,
                has_guessed_correctly=player.has_guessed_correctly,
                guess_count=player.guess_count,
                latest_guess_text=player.latest_guess_text,
                solved_order=player.solved_order,
                character_id=player.character_id,
            )
            for player in room.players.values()
        ],
    )


@router.get("/categories")
def get_categories():
    """Return available categories."""
    return {"categories": CATEGORIES}


@router.post("/rooms", response_model=RoomStateResponse)
def create_room(
    payload: CreateRoomRequest,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Create a new room."""
    try:
        room = service.create_room(
            host_name=payload.host_name,
            auth_username=current_user.username if current_user else None,
            max_player_count=payload.max_player_count,
            categories=payload.categories,
            character_id=payload.character_id,
        )
        response = build_room_response(room)
        distinct_id = f"user:{current_user.id}" if current_user else f"room_host:{room.host_id}"
        track_event_async(
            distinct_id=distinct_id,
            event="room_created",
            properties={
                "room_code": room.room_code,
                "game_type": "who_am_i",
                "max_player_count": room.max_player_count,
            },
        )
        return response
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/join", response_model=RoomStateResponse)
async def join_room(
    room_code: str,
    payload: JoinRoomRequest,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Join an existing room."""
    try:
        room = service.join_room(
            room_code,
            payload.player_name,
            payload.character_id,
            current_user.username if current_user else None,
        )
        response = build_room_response(room)
        await manager.broadcast(
            room_code,
            {"type": "state_sync", "state": response.model_dump()},
        )
        return response
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/character", response_model=RoomStateResponse)
def update_character(room_code: str, payload: UpdateCharacterRequest):
    """Update player character while in lobby."""
    try:
        room = service.update_character(room_code, payload.player_id, payload.character_id)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/leave")
def leave_room(room_code: str, payload: LeaveRoomRequest):
    """Allow a non-host player to leave a room before the game starts."""
    try:
        room = service.leave_room(room_code, payload.player_id)
        if room is None:
            return {"message": "Room became empty and was deleted."}
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/remove-player", response_model=RoomStateResponse)
def remove_player(room_code: str, payload: RemovePlayerRequest):
    """Allow the host to remove a player from the room."""
    try:
        room = service.remove_player(room_code, payload.host_id, payload.player_id_to_remove)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/categories", response_model=RoomStateResponse)
def update_categories(room_code: str, payload: UpdateCategoriesRequest):
    """Allow the host to update categories before the game starts."""
    try:
        room = service.update_categories(room_code, payload.host_id, payload.categories)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/delete")
def delete_room(room_code: str, payload: DeleteRoomRequest):
    """Allow the host to delete a room."""
    try:
        service.delete_room(room_code, payload.player_id)
        return {"message": "Room deleted successfully."}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/heartbeat")
def heartbeat(room_code: str, payload: LeaveRoomRequest):
    """Update player's last seen timestamp."""
    try:
        service.heartbeat(room_code, payload.player_id)
        return {"message": "Heartbeat received."}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/start", response_model=RoomStateResponse)
def start_room(room_code: str):
    """Start the room."""
    try:
        room = service.start_game(room_code)
        response = build_room_response(room)
        track_event_async(
            distinct_id=f"room_host:{room.host_id}",
            event="game_started",
            properties={
                "room_code": room.room_code,
                "game_type": "who_am_i",
                "player_count": len(room.players),
            },
        )
        return response
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/rooms/{room_code}", response_model=RoomStateResponse)
def get_room(room_code: str):
    """Get current room state."""
    try:
        room = service.get_room_state(room_code)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/reveal-view")
def reveal_view(room_code: str, payload: RevealViewRequest):
    """Return the reveal-phase view for the requesting player."""
    try:
        return service.get_reveal_view(room_code, payload.player_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/confirm-reveal", response_model=RoomStateResponse)
def confirm_reveal(room_code: str, payload: ConfirmRevealRequest):
    """Confirm reveal and move to the next reveal player or gameplay."""
    try:
        room = service.confirm_reveal(room_code, payload.player_id)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/guess", response_model=RoomStateResponse)
def submit_guess(room_code: str, payload: SubmitGuessRequest):
    """Submit a guess for the current turn player."""
    try:
        room = service.submit_guess(room_code, payload.player_id, payload.guess_text)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.post("/rooms/{room_code}/player-knowledge")
def player_knowledge(room_code: str, payload: PlayerKnowledgeViewRequest):
    """Return the player list as seen by a specific viewer."""
    try:
        return {
            "players": service.get_player_knowledge_view(room_code, payload.player_id)
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/restart", response_model=RoomStateResponse)
def restart_room(room_code: str, payload: RestartRoomRequest):
    """Restart room with same players and a new category."""
    try:
        room = service.restart_game(room_code, payload.categories)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.websocket("/ws/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str):
    player_id = websocket.query_params.get("player_id")
    await manager.connect(room_code, websocket, player_id=player_id)

    async def send_action_ack(target_player_id: str | None, action_id: str | None):
        if not target_player_id or not action_id:
            return
        await manager.send_to_player(
            room_code=room_code,
            player_id=target_player_id,
            message={"type": "action_ack", "action_id": action_id},
        )

    async def send_action_error(target_player_id: str | None, action_id: str | None, detail: str):
        if not target_player_id:
            return
        await manager.send_to_player(
            room_code=room_code,
            player_id=target_player_id,
            message={"type": "action_error", "action_id": action_id, "detail": detail},
        )

    async def send_state_to_player(target_player_id: str | None):
        if not target_player_id:
            return
        room = service.get_room_state(room_code)
        await manager.send_to_player(
            room_code=room_code,
            player_id=target_player_id,
            message={"type": "state_sync", "state": build_room_response(room).model_dump()},
        )

    async def broadcast_state():
        room = service.get_room_state(room_code)
        await manager.broadcast(
            room_code,
            {"type": "state_sync", "state": build_room_response(room).model_dump()},
        )

    if player_id:
        try:
            await send_state_to_player(player_id)
        except Exception as exc:
            logger.warning("WhoAmI WS initial sync failed room=%s player=%s error=%s", room_code, player_id, exc)

    try:
        while True:
            try:
                raw_message = await websocket.receive_text()
            except WebSocketDisconnect:
                raise

            try:
                data = json.loads(raw_message)
            except json.JSONDecodeError:
                continue

            if not isinstance(data, dict):
                continue

            event_type = data.get("type")
            action_id = data.get("action_id")
            message_player_id = data.get("player_id")

            if message_player_id:
                player_id = str(message_player_id)
                await manager.register_player(room_code, player_id, websocket)

            if event_type == "sync_request":
                try:
                    await send_state_to_player(player_id)
                    await send_action_ack(player_id, action_id)
                except Exception as exc:
                    await send_action_error(player_id, action_id, str(exc))
                continue

            try:
                if event_type == "update_character":
                    service.update_character(room_code, str(data["player_id"]), str(data["character_id"]))
                elif event_type == "update_categories":
                    service.update_categories(room_code, str(data["player_id"]), list(data.get("categories", [])))
                elif event_type == "start_game":
                    service.start_game(room_code)
                elif event_type == "confirm_reveal":
                    service.confirm_reveal(room_code, str(data["player_id"]))
                elif event_type == "submit_guess":
                    service.submit_guess(room_code, str(data["player_id"]), str(data["guess_text"]))
                elif event_type == "restart_game":
                    service.restart_game(room_code, list(data.get("categories", [])))
                elif event_type == "remove_player":
                    service.remove_player(
                        room_code,
                        str(data["player_id"]),
                        str(data["player_id_to_remove"]),
                    )
                elif event_type == "leave":
                    room = service.leave_room(room_code, str(data["player_id"]))
                    if room is not None:
                        await broadcast_state()
                    await send_action_ack(player_id, action_id)
                    manager.disconnect(room_code, websocket)
                    break
                else:
                    continue

                await broadcast_state()
                await send_action_ack(player_id, action_id)
            except Exception as exc:
                await send_action_error(player_id, action_id, str(exc))

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(room_code, websocket)
