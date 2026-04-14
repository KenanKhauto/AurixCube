"""API routes for the Bluff game."""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.auth.dependencies import get_current_user_optional
from app.db.models.user import User
from app.games.bluff.constants import BLUFF_CATEGORIES
from app.games.bluff.schemas import (
    BluffAdvanceRoundRequest,
    BluffAnswerOptionView,
    BluffCreateRoomRequest,
    BluffDeleteRoomRequest,
    BluffJoinRoomRequest,
    BluffLeaveRoomRequest,
    BluffPlayerView,
    BluffRemovePlayerRequest,
    BluffRestartGameRequest,
    BluffRoomStateResponse,
    BluffSelectCategoryRequest,
    BluffSubmitAnswerRequest,
    BluffSubmitPickRequest,
    BluffUpdateCharacterRequest,
    BluffUpdateCategoriesRequest,
)
from app.games.bluff.service import BluffGameService
from app.games.bluff.websocket_manager import manager
from app.services.analytics import track_event_async

router = APIRouter()
service = BluffGameService()
logger = logging.getLogger(__name__)


def build_room_response(room) -> BluffRoomStateResponse:
    """Convert domain room to API response schema."""
    return BluffRoomStateResponse(
        room_code=room.room_code,
        room_version=room.room_version,
        host_id=room.host_id,
        categories=room.categories,
        max_player_count=room.max_player_count,
        total_rounds=room.total_rounds,
        started=room.started,
        ended=room.ended,
        end_reason=room.end_reason,
        winner_ids=room.winner_ids,
        current_round=room.current_round,
        phase=room.phase,
        current_category_chooser_id=room.current_category_chooser_id,
        current_round_category=room.current_round_category,
        current_question=room.current_question,
        phase_deadline_at=room.phase_deadline_at,
        submissions_count=len(room.submissions),
        picks_count=len(room.picks),
        submitted_player_ids=list(room.submissions.keys()),
        picked_player_ids=list(room.picks.keys()),
        last_round_message=room.last_round_message,
        last_round_correct_option_id=room.last_round_correct_option_id,
        last_round_score_changes=room.last_round_score_changes,
        round_timer_seconds=room.round_timer_seconds,
        players=[
            BluffPlayerView(
                id=player.id,
                name=player.name,
                username=player.username,
                character_id=player.character_id,
                score=room.scores.get(player.id, 0),
            )
            for player in room.players.values()
        ],
        answer_options=[
            BluffAnswerOptionView(
                id=option.id,
                text=option.text,
                is_correct=option.is_correct,
                author_ids=option.author_ids,
                votes_received=option.votes_received,
                is_bot_generated=option.is_bot_generated,
            )
            for option in room.answer_options
        ],
        picks=room.picks,
    )


@router.get("/categories")
def get_categories():
    """Return available Bluff categories."""
    return {"categories": list(BLUFF_CATEGORIES.keys())}


@router.post("/rooms", response_model=BluffRoomStateResponse)
def create_room(
    payload: BluffCreateRoomRequest,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Create a new Bluff room."""
    try:
        room = service.create_room(
            host_name=payload.host_name,
            auth_username=current_user.username if current_user else None,
            max_player_count=payload.max_player_count,
            total_rounds=payload.total_rounds,
            categories=payload.categories,
            character_id=payload.character_id,
            round_timer_seconds=payload.round_timer_seconds,
        )
        response = build_room_response(room)
        distinct_id = f"user:{current_user.id}" if current_user else f"room_host:{room.host_id}"
        track_event_async(
            distinct_id=distinct_id,
            event="room_created",
            properties={
                "room_code": room.room_code,
                "game_type": "bluff",
                "max_player_count": room.max_player_count,
                "total_rounds": room.total_rounds,
            },
        )
        return response
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/join", response_model=BluffRoomStateResponse)
async def join_room(
    room_code: str,
    payload: BluffJoinRoomRequest,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Join an existing Bluff room."""
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
        logger.warning(
            "Bluff join failed room=%s player_name=%s auth_user=%s error=%s",
            room_code,
            payload.player_name,
            current_user.username if current_user else None,
            exc,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/character", response_model=BluffRoomStateResponse)
def update_character(room_code: str, payload: BluffUpdateCharacterRequest):
    """Update player character while in lobby."""
    try:
        room = service.update_character(room_code, payload.player_id, payload.character_id)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/start", response_model=BluffRoomStateResponse)
def start_room(room_code: str):
    """Start the Bluff game."""
    try:
        room = service.start_game(room_code)
        response = build_room_response(room)
        track_event_async(
            distinct_id=f"room_host:{room.host_id}",
            event="game_started",
            properties={
                "room_code": room.room_code,
                "game_type": "bluff",
                "player_count": len(room.players),
                "round_timer_seconds": room.round_timer_seconds,
            },
        )
        return response
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/rooms/{room_code}", response_model=BluffRoomStateResponse)
def get_room(room_code: str):
    """Get current Bluff room state."""
    try:
        room = service.get_room_state(room_code)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/categories", response_model=BluffRoomStateResponse)
def update_categories(room_code: str, payload: BluffUpdateCategoriesRequest):
    """Update the room's allowed categories before the game starts."""
    try:
        room = service.update_categories(room_code, payload.host_id, payload.categories)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/select-category", response_model=BluffRoomStateResponse)
def select_category(room_code: str, payload: BluffSelectCategoryRequest):
    """Chooser selects the round category."""
    try:
        room = service.select_category(room_code, payload.player_id, payload.category)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/submit-answer", response_model=BluffRoomStateResponse)
def submit_answer(room_code: str, payload: BluffSubmitAnswerRequest):
    """Submit a bluff answer."""
    try:
        room = service.submit_answer(room_code, payload.player_id, payload.answer_text)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/submit-pick", response_model=BluffRoomStateResponse)
def submit_pick(room_code: str, payload: BluffSubmitPickRequest):
    """Submit or replace a picked answer."""
    try:
        room = service.submit_pick(room_code, payload.player_id, payload.option_id)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/advance", response_model=BluffRoomStateResponse)
def advance_round(room_code: str, payload: BluffAdvanceRoundRequest):
    """Advance to the next round."""
    try:
        room = service.advance_round(room_code, payload.player_id)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/restart", response_model=BluffRoomStateResponse)
def restart_room(room_code: str, payload: BluffRestartGameRequest):
    """Restart room with same players and new settings."""
    try:
        room = service.restart_game(room_code, payload.categories, payload.total_rounds, payload.round_timer_seconds,)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/remove-player", response_model=BluffRoomStateResponse)
def remove_player(room_code: str, payload: BluffRemovePlayerRequest):
    """Allow the host to remove a player from the room."""
    try:
        room = service.remove_player(room_code, payload.host_id, payload.player_id_to_remove)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/leave")
def leave_room(room_code: str, payload: BluffLeaveRoomRequest):
    """Allow a non-host player to leave a room before the game starts."""
    try:
        room = service.leave_room(room_code, payload.player_id)
        if room is None:
            return {"message": "Room became empty and was deleted."}
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/delete")
def delete_room(room_code: str, payload: BluffDeleteRoomRequest):
    """Allow the host to delete a room."""
    try:
        service.delete_room(room_code, payload.player_id)
        return {"message": "Room deleted successfully."}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/heartbeat")
def heartbeat(room_code: str, payload: BluffLeaveRoomRequest):  # reuse the schema for player_id
    """Update player's last seen timestamp."""
    try:
        service.heartbeat(room_code, payload.player_id)
        return {"message": "Heartbeat received."}
    except Exception as exc:
        logger.warning(
            "Bluff heartbeat failed room=%s player=%s error=%s",
            room_code,
            payload.player_id,
            exc,
        )
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
            logger.warning("Bluff WS initial sync failed room=%s player=%s error=%s", room_code, player_id, exc)

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
                elif event_type == "select_category":
                    service.select_category(room_code, str(data["player_id"]), str(data["category"]))
                elif event_type == "submit_answer":
                    service.submit_answer(room_code, str(data["player_id"]), str(data["answer_text"]))
                elif event_type == "submit_pick":
                    service.submit_pick(room_code, str(data["player_id"]), str(data["option_id"]))
                elif event_type == "advance_round":
                    service.advance_round(room_code, str(data["player_id"]))
                elif event_type == "restart_game":
                    service.restart_game(
                        room_code,
                        list(data.get("categories", [])),
                        int(data.get("total_rounds", 1)),
                        int(data.get("round_timer_seconds", 30)),
                    )
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
