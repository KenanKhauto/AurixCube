"""API routes for the Arabic letters category game."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.auth.dependencies import get_current_user_optional
from app.core.exceptions import StaleRoomVersionError
from app.db.models.user import User
from app.games.letters.router_builders import build_room_response
from app.games.letters.schemas import (
    LettersChooseLetterRequest,
    LettersCreateRoomRequest,
    LettersDeleteRoomRequest,
    LettersDoneRequest,
    LettersJoinRoomRequest,
    LettersLeaveRoomRequest,
    LettersNextPhaseRequest,
    LettersPresetCategoryView,
    LettersRemovePlayerRequest,
    LettersRestartGameRequest,
    LettersRoomStateResponse,
    LettersStartGameRequest,
    LettersSubmitAnswersRequest,
    LettersUpdateCharacterRequest,
    LettersUpdateSettingsRequest,
    LettersVoteRequest,
)
from app.games.letters.service import LettersGameService
from app.games.letters.websocket_manager import manager
from app.services.analytics import track_event_async

router = APIRouter()
service = LettersGameService()
logger = logging.getLogger(__name__)


def _stale_room_http(room_code: str, exc: Exception) -> HTTPException:
    state = None
    try:
        state = build_room_response(service.get_room_state(room_code)).model_dump()
    except Exception:
        state = None
    return HTTPException(
        status_code=409,
        detail={"code": "stale_room_version", "message": str(exc), "state": state},
    )


@router.get("/categories")
def get_categories():
    return {
        "categories": [
            LettersPresetCategoryView(id=item["id"], label=item["label"]).model_dump()
            for item in service.list_preset_categories()
        ]
    }


@router.post("/rooms", response_model=LettersRoomStateResponse)
def create_room(
    payload: LettersCreateRoomRequest,
    current_user: User | None = Depends(get_current_user_optional),
):
    try:
        room = service.create_room(
            host_name=payload.host_name,
            character_id=payload.character_id,
            auth_username=current_user.username if current_user else None,
            max_player_count=payload.max_player_count,
            total_rounds=payload.total_rounds,
            answer_timer_seconds=payload.answer_timer_seconds,
            no_timer=payload.no_timer,
            min_done_seconds=payload.min_done_seconds,
            preset_category_ids=payload.preset_category_ids,
            custom_categories=payload.custom_categories,
        )
        response = build_room_response(room, viewer_player_id=room.host_id)
        distinct_id = f"user:{current_user.id}" if current_user else f"room_host:{room.host_id}"
        track_event_async(
            distinct_id=distinct_id,
            event="room_created",
            properties={
                "room_code": room.room_code,
                "game_type": "letters",
                "max_player_count": room.max_player_count,
                "total_rounds": room.total_rounds,
            },
        )
        return response
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            stale_room_code = room.room_code if "room" in locals() else "unknown"
            raise _stale_room_http(stale_room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/join", response_model=LettersRoomStateResponse)
async def join_room(
    room_code: str,
    payload: LettersJoinRoomRequest,
    current_user: User | None = Depends(get_current_user_optional),
):
    try:
        room = service.join_room(
            room_code=room_code,
            player_name=payload.player_name,
            character_id=payload.character_id,
            auth_username=current_user.username if current_user else None,
        )
        response = build_room_response(room)
        await manager.broadcast(room_code, {"type": "state_sync", "state": response.model_dump()})
        return build_room_response(room)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/character", response_model=LettersRoomStateResponse)
def update_character(room_code: str, payload: LettersUpdateCharacterRequest):
    try:
        room = service.update_character(room_code, payload.player_id, payload.character_id)
        return build_room_response(room, viewer_player_id=payload.player_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/settings", response_model=LettersRoomStateResponse)
def update_settings(room_code: str, payload: LettersUpdateSettingsRequest):
    try:
        room = service.update_settings(
            room_code=room_code,
            host_id=payload.host_id,
            max_player_count=payload.max_player_count,
            total_rounds=payload.total_rounds,
            answer_timer_seconds=payload.answer_timer_seconds,
            no_timer=payload.no_timer,
            min_done_seconds=payload.min_done_seconds,
            preset_category_ids=payload.preset_category_ids,
            custom_categories=payload.custom_categories,
        )
        return build_room_response(room, viewer_player_id=payload.host_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/start", response_model=LettersRoomStateResponse)
def start_room(room_code: str, payload: LettersStartGameRequest):
    try:
        room = service.start_game(room_code, payload.host_id)
        response = build_room_response(room)
        track_event_async(
            distinct_id=f"room_host:{room.host_id}",
            event="game_started",
            properties={
                "room_code": room.room_code,
                "game_type": "letters",
                "player_count": len(room.players),
                "total_rounds": room.total_rounds,
            },
        )
        return response
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/next-phase", response_model=LettersRoomStateResponse)
def next_phase(room_code: str, payload: LettersNextPhaseRequest):
    try:
        room = service.advance_phase(room_code, payload.host_id)
        return build_room_response(room, viewer_player_id=payload.host_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/rooms/{room_code}", response_model=LettersRoomStateResponse)
def get_room(room_code: str, player_id: str | None = None):
    try:
        room = service.get_room_state(room_code)
        return build_room_response(room, viewer_player_id=player_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/choose-letter", response_model=LettersRoomStateResponse)
def choose_letter(room_code: str, payload: LettersChooseLetterRequest):
    try:
        room = service.choose_letter(room_code, payload.player_id, payload.letter)
        return build_room_response(room, viewer_player_id=payload.player_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/answers", response_model=LettersRoomStateResponse)
def submit_answers(room_code: str, payload: LettersSubmitAnswersRequest):
    try:
        room = service.submit_answers(room_code, payload.player_id, payload.answers)
        return build_room_response(room, viewer_player_id=payload.player_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/done", response_model=LettersRoomStateResponse)
def press_done(room_code: str, payload: LettersDoneRequest):
    try:
        room = service.press_done(room_code, payload.player_id, payload.answers)
        return build_room_response(room, viewer_player_id=payload.player_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/vote", response_model=LettersRoomStateResponse)
def submit_vote(room_code: str, payload: LettersVoteRequest):
    try:
        room = service.submit_vote(room_code, payload.player_id, payload.answer_id, payload.verdict)
        return build_room_response(room, viewer_player_id=payload.player_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/restart", response_model=LettersRoomStateResponse)
def restart_room(room_code: str, payload: LettersRestartGameRequest):
    try:
        room = service.restart_game(
            room_code=room_code,
            host_id=payload.host_id,
            max_player_count=payload.max_player_count,
            total_rounds=payload.total_rounds,
            answer_timer_seconds=payload.answer_timer_seconds,
            no_timer=payload.no_timer,
            min_done_seconds=payload.min_done_seconds,
            preset_category_ids=payload.preset_category_ids,
            custom_categories=payload.custom_categories,
        )
        return build_room_response(room, viewer_player_id=payload.host_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/leave")
def leave_room(room_code: str, payload: LettersLeaveRoomRequest):
    try:
        room = service.leave_room(room_code, payload.player_id)
        if room is None:
            return {"message": "Room became empty and was deleted."}
        return build_room_response(room, viewer_player_id=payload.player_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/remove-player", response_model=LettersRoomStateResponse)
def remove_player(room_code: str, payload: LettersRemovePlayerRequest):
    try:
        room = service.remove_player(room_code, payload.host_id, payload.player_id_to_remove)
        return build_room_response(room, viewer_player_id=payload.host_id)
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/delete")
def delete_room(room_code: str, payload: LettersDeleteRoomRequest):
    try:
        service.delete_room(room_code, payload.player_id)
        return {"message": "Room deleted successfully."}
    except Exception as exc:
        if isinstance(exc, StaleRoomVersionError):
            raise _stale_room_http(room_code, exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/heartbeat")
def heartbeat(room_code: str, payload: LettersLeaveRoomRequest):
    try:
        service.heartbeat(room_code, payload.player_id)
        return {"message": "Heartbeat received."}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.websocket("/ws/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str):
    player_id = websocket.query_params.get("player_id")
    await manager.connect(room_code, websocket, player_id=player_id)

    async def send_action_ack(target_player_id: str | None, action_id: str | None):
        if not target_player_id or not action_id:
            return
        await manager.send_to_player(room_code=room_code, player_id=target_player_id, message={"type": "action_ack", "action_id": action_id})

    async def send_action_error(target_player_id: str | None, action_id: str | None, detail: str):
        if not target_player_id:
            return
        await manager.send_to_player(room_code=room_code, player_id=target_player_id, message={"type": "action_error", "action_id": action_id, "detail": detail})

    async def send_state_to_player(target_player_id: str | None):
        if not target_player_id:
            return
        room = service.get_room_state(room_code)
        await manager.send_to_player(
            room_code=room_code,
            player_id=target_player_id,
            message={"type": "state_sync", "state": build_room_response(room, viewer_player_id=target_player_id).model_dump()},
        )

    async def broadcast_state():
        room = service.get_room_state(room_code)
        for target_player_id in list(room.players.keys()):
            await manager.send_to_player(
                room_code=room_code,
                player_id=target_player_id,
                message={"type": "state_sync", "state": build_room_response(room, viewer_player_id=target_player_id).model_dump()},
            )

    if player_id:
        try:
            await send_state_to_player(player_id)
        except Exception as exc:
            logger.warning("Letters WS initial sync failed room=%s player=%s error=%s", room_code, player_id, exc)

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
                elif event_type == "update_settings":
                    service.update_settings(
                        room_code=room_code,
                        host_id=str(data["player_id"]),
                        max_player_count=int(data["max_player_count"]),
                        total_rounds=int(data["total_rounds"]),
                        answer_timer_seconds=int(data["answer_timer_seconds"]),
                        no_timer=bool(data.get("no_timer", False)),
                        min_done_seconds=int(data["min_done_seconds"]),
                        preset_category_ids=list(data.get("preset_category_ids", [])),
                        custom_categories=list(data.get("custom_categories", [])),
                    )
                elif event_type == "start_game":
                    service.start_game(room_code, str(data["player_id"]))
                elif event_type == "next_phase":
                    service.advance_phase(room_code, str(data["player_id"]))
                elif event_type == "choose_letter":
                    service.choose_letter(room_code, str(data["player_id"]), str(data["letter"]))
                elif event_type == "submit_answers":
                    service.submit_answers(room_code, str(data["player_id"]), list(data.get("answers", [])))
                elif event_type == "press_done":
                    service.press_done(room_code, str(data["player_id"]), list(data.get("answers", [])))
                elif event_type == "vote":
                    service.submit_vote(room_code, str(data["player_id"]), str(data["answer_id"]), str(data["verdict"]))
                elif event_type == "restart_game":
                    service.restart_game(
                        room_code=room_code,
                        host_id=str(data["player_id"]),
                        max_player_count=int(data["max_player_count"]),
                        total_rounds=int(data["total_rounds"]),
                        answer_timer_seconds=int(data["answer_timer_seconds"]),
                        no_timer=bool(data.get("no_timer", False)),
                        min_done_seconds=int(data["min_done_seconds"]),
                        preset_category_ids=list(data.get("preset_category_ids", [])),
                        custom_categories=list(data.get("custom_categories", [])),
                    )
                elif event_type == "remove_player":
                    service.remove_player(room_code, str(data["player_id"]), str(data["player_id_to_remove"]))
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
                if isinstance(exc, StaleRoomVersionError):
                    await send_state_to_player(player_id)
                await send_action_error(player_id, action_id, str(exc))
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(room_code, websocket)
