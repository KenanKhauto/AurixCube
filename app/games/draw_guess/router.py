"""API routes for the drawing guess game."""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_user_optional
from app.db.models.user import User
from app.games.draw_guess.constants import DRAW_CATEGORIES
from app.games.draw_guess.schemas import (
    DrawGuessAdvanceRoundRequest,
    DrawGuessCreateRoomRequest,
    DrawGuessDeleteRoomRequest,
    DrawGuessGuessMessageView,
    DrawGuessJoinRoomRequest,
    DrawGuessLeaveRoomRequest,
    DrawGuessPlayerView,
    DrawGuessRemovePlayerRequest,
    DrawGuessRestartGameRequest,
    DrawGuessRoomStateResponse,
    DrawGuessSelectWordRequest,
    DrawGuessStrokeView,
    DrawGuessUpdateCategoriesRequest,
    DrawGuessUpdateCharacterRequest,
    DrawGuessWordOptionView,
)
from app.games.draw_guess.service import DrawGuessGameService
from fastapi import WebSocket, WebSocketDisconnect
from app.games.draw_guess.websocket_manager import manager
from app.games.draw_guess.domain import DrawGuessStroke


router = APIRouter()
service = DrawGuessGameService()
logger = logging.getLogger(__name__)


def build_room_response(room) -> DrawGuessRoomStateResponse:
    return DrawGuessRoomStateResponse(
        room_code=room.room_code,
        room_version=room.room_version,
        host_id=room.host_id,
        max_player_count=room.max_player_count,
        total_rounds=room.total_rounds,
        categories=room.categories,
        language=room.language,
        round_timer_seconds=room.round_timer_seconds,
        started=room.started,
        ended=room.ended,
        end_reason=room.end_reason,
        winner_ids=room.winner_ids,
        current_round=room.current_round,
        phase=room.phase,
        current_drawer_id=room.current_drawer_id,
        phase_deadline_at=room.phase_deadline_at,
        current_word_choices=[
            DrawGuessWordOptionView(
                word_en=w.word_en,
                word_ar=w.word_ar,
                difficulty=w.difficulty,
            )
            for w in room.current_word_choices
        ],
        current_word_en=room.current_word.word_en if room.current_word else None,
        current_word_ar=room.current_word.word_ar if room.current_word else None,
        guessed_correctly_player_ids=room.guessed_correctly_player_ids,
        last_round_word_en=room.last_round_word_en,
        last_round_word_ar=room.last_round_word_ar,
        last_round_score_changes=room.last_round_score_changes,
        players=[
            DrawGuessPlayerView(
                id=p.id,
                name=p.name,
                username=p.username,
                character_id=p.character_id,
                score=room.scores.get(p.id, 0),
            )
            for p in room.players.values()
        ],
        guesses=[
            DrawGuessGuessMessageView(
                player_id=g.player_id,
                player_name=g.player_name,
                text=g.text,
                is_correct=g.is_correct,
            )
            for g in room.guesses
            if g.is_public
        ],
        strokes=[
            DrawGuessStrokeView(
                x0=s.x0,
                y0=s.y0,
                x1=s.x1,
                y1=s.y1,
                color=s.color,
                width=s.width,
            )
            for s in room.strokes
        ],
    )


@router.get("/categories")
def get_categories():
    return {"categories": list(DRAW_CATEGORIES.keys())}


@router.post("/rooms", response_model=DrawGuessRoomStateResponse)
def create_room(
    payload: DrawGuessCreateRoomRequest,
    current_user: User | None = Depends(get_current_user_optional),
):
    try:
        room = service.create_room(
            host_name=payload.host_name,
            auth_username=current_user.username if current_user else None,
            character_id=payload.character_id,
            max_player_count=payload.max_player_count,
            total_rounds=payload.total_rounds,
            categories=payload.categories,
            language=payload.language,
            round_timer_seconds=payload.round_timer_seconds,
        )
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/join", response_model=DrawGuessRoomStateResponse)
async def join_room(
    room_code: str,
    payload: DrawGuessJoinRoomRequest,
    current_user: User | None = Depends(get_current_user_optional),
):
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


@router.post("/rooms/{room_code}/character", response_model=DrawGuessRoomStateResponse)
def update_character(room_code: str, payload: DrawGuessUpdateCharacterRequest):
    try:
        room = service.update_character(room_code, payload.player_id, payload.character_id)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/start", response_model=DrawGuessRoomStateResponse)
def start_room(room_code: str):
    try:
        room = service.start_game(room_code)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/rooms/{room_code}", response_model=DrawGuessRoomStateResponse)
def get_room(room_code: str):
    try:
        room = service.get_room_state(room_code)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/select-word", response_model=DrawGuessRoomStateResponse)
def select_word(room_code: str, payload: DrawGuessSelectWordRequest):
    try:
        room = service.select_word(room_code, payload.player_id, payload.chosen_word_en)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/advance", response_model=DrawGuessRoomStateResponse)
def advance_round(room_code: str, payload: DrawGuessAdvanceRoundRequest):
    try:
        room = service.advance_round(room_code, payload.player_id)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/restart", response_model=DrawGuessRoomStateResponse)
def restart_room(room_code: str, payload: DrawGuessRestartGameRequest):
    try:
        room = service.restart_game(
            room_code=room_code,
            categories=payload.categories,
            total_rounds=payload.total_rounds,
            language=payload.language,
            round_timer_seconds=payload.round_timer_seconds,
        )
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/leave")
def leave_room(room_code: str, payload: DrawGuessLeaveRoomRequest):
    try:
        room = service.leave_room(room_code, payload.player_id)
        if room is None:
            return {"message": "Room became empty and was deleted."}
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/remove-player", response_model=DrawGuessRoomStateResponse)
def remove_player(room_code: str, payload: DrawGuessRemovePlayerRequest):
    try:
        room = service.remove_player(room_code, payload.host_id, payload.player_id_to_remove)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/categories", response_model=DrawGuessRoomStateResponse)
def update_categories(room_code: str, payload: DrawGuessUpdateCategoriesRequest):
    try:
        room = service.update_categories(room_code, payload.host_id, payload.categories)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/delete")
def delete_room(room_code: str, payload: DrawGuessDeleteRoomRequest):
    try:
        service.delete_room(room_code, payload.player_id)
        return {"message": "Room deleted successfully."}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/heartbeat")
def heartbeat(room_code: str, payload: DrawGuessLeaveRoomRequest):
    """Update player's last seen timestamp."""
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
            logger.warning("Draw WS initial state sync failed room=%s player=%s error=%s", room_code, player_id, exc)

    try:
        while True:
            try:
                raw_message = await websocket.receive_text()
            except WebSocketDisconnect:
                logger.info("Draw WS receive disconnect room=%s player=%s", room_code, player_id or "unknown")
                raise

            try:
                data = json.loads(raw_message)
            except json.JSONDecodeError:
                logger.warning("Draw WS invalid JSON room=%s player=%s payload=%r", room_code, player_id or "unknown", raw_message)
                continue

            if not isinstance(data, dict):
                logger.warning("Draw WS invalid payload type room=%s player=%s payload_type=%s", room_code, player_id or "unknown", type(data).__name__)
                continue

            event_type = data.get("type")
            action_id = data.get("action_id")
            message_player_id = data.get("player_id")

            if message_player_id:
                player_id = str(message_player_id)
                await manager.register_player(room_code, player_id, websocket)

            if not isinstance(event_type, str):
                logger.warning("Draw WS missing event type room=%s player=%s payload=%s", room_code, player_id or "unknown", data)
                continue

            if event_type == "sync_request":
                try:
                    await send_state_to_player(player_id)
                    await send_action_ack(player_id, action_id)
                except Exception as exc:
                    logger.warning("Draw WS sync_request failed room=%s player=%s error=%s", room_code, player_id or "unknown", exc)
                    await send_action_error(player_id, action_id, str(exc))
                continue

            if event_type == "draw":
                try:
                    stroke = DrawGuessStroke(
                        x0=float(data.get("x0", 0)),
                        y0=float(data.get("y0", 0)),
                        x1=float(data.get("x1", 0)),
                        y1=float(data.get("y1", 0)),
                        color=data.get("color", "#000000"),
                        width=float(data.get("width", 2)),
                    )

                    service.add_stroke(
                        room_code=room_code,
                        player_id=data["player_id"],
                        stroke=stroke,
                    )

                    await manager.broadcast(room_code, {
                        "type": "draw",
                        "stroke": {
                            "x0": stroke.x0,
                            "y0": stroke.y0,
                            "x1": stroke.x1,
                            "y1": stroke.y1,
                            "color": stroke.color,
                            "width": stroke.width,
                            "player_id": data["player_id"],
                        },
                    })
                    await send_action_ack(player_id, action_id)
                except (ValueError, KeyError, TypeError) as exc:
                    logger.warning("Draw WS invalid draw payload room=%s player=%s error=%s payload=%s", room_code, player_id or "unknown", exc, data)
                    await send_action_error(player_id, action_id, str(exc))

            elif event_type == "guess":
                try:
                    room = service.submit_guess(
                        room_code=room_code,
                        player_id=data["player_id"],
                        guess_text=data["text"],
                    )

                    last_guess = room.guesses[-1]
                    if last_guess.is_public:
                        await manager.broadcast(room_code, {
                            "type": "guess",
                            "player_name": last_guess.player_name,
                            "text": last_guess.text,
                            "is_correct": last_guess.is_correct,
                            "player_id": last_guess.player_id,
                        })
                    else:
                        await manager.send_to_player(
                            room_code=room_code,
                            player_id=last_guess.player_id,
                            message={
                                "type": "guess",
                                "player_name": last_guess.player_name,
                                "text": last_guess.text,
                                "is_correct": last_guess.is_correct,
                                "player_id": last_guess.player_id,
                            },
                        )
                        await manager.send_to_player(
                            room_code=room_code,
                            player_id=last_guess.player_id,
                            message={
                                "type": "guess_hint_private",
                                "text": "\u062A\u062E\u0645\u064A\u0646\u0643 \u0642\u0631\u064A\u0628 \u0645\u0646 \u0627\u0644\u0643\u0644\u0645\u0629!",
                            },
                        )

                    await broadcast_state()
                    await send_action_ack(player_id, action_id)
                except (ValueError, KeyError, TypeError) as exc:
                    logger.warning("Draw WS invalid guess payload room=%s player=%s error=%s payload=%s", room_code, player_id or "unknown", exc, data)
                    await send_action_error(player_id, action_id, str(exc))

            elif event_type == "update_character":
                try:
                    service.update_character(
                        room_code=room_code,
                        player_id=str(data["player_id"]),
                        character_id=str(data["character_id"]),
                    )
                    await broadcast_state()
                    await send_action_ack(player_id, action_id)
                except (ValueError, KeyError, TypeError) as exc:
                    logger.warning("Draw WS update_character failed room=%s player=%s error=%s payload=%s", room_code, player_id or "unknown", exc, data)
                    await send_action_error(player_id, action_id, str(exc))

            elif event_type == "update_categories":
                try:
                    service.update_categories(
                        room_code=room_code,
                        host_id=str(data["player_id"]),
                        categories=list(data.get("categories", [])),
                    )
                    await broadcast_state()
                    await send_action_ack(player_id, action_id)
                except (ValueError, KeyError, TypeError) as exc:
                    logger.warning("Draw WS update_categories failed room=%s player=%s error=%s payload=%s", room_code, player_id or "unknown", exc, data)
                    await send_action_error(player_id, action_id, str(exc))

            elif event_type == "start_game":
                try:
                    service.start_game(room_code=room_code)
                    await broadcast_state()
                    await send_action_ack(player_id, action_id)
                except Exception as exc:
                    logger.warning("Draw WS start_game failed room=%s player=%s error=%s", room_code, player_id or "unknown", exc)
                    await send_action_error(player_id, action_id, str(exc))

            elif event_type == "select_word":
                try:
                    service.select_word(
                        room_code=room_code,
                        player_id=str(data["player_id"]),
                        chosen_word_en=str(data["chosen_word_en"]),
                    )
                    await broadcast_state()
                    await send_action_ack(player_id, action_id)
                except (ValueError, KeyError, TypeError) as exc:
                    logger.warning("Draw WS select_word failed room=%s player=%s error=%s payload=%s", room_code, player_id or "unknown", exc, data)
                    await send_action_error(player_id, action_id, str(exc))

            elif event_type == "advance_round":
                try:
                    service.advance_round(
                        room_code=room_code,
                        player_id=str(data["player_id"]),
                    )
                    await broadcast_state()
                    await send_action_ack(player_id, action_id)
                except (ValueError, KeyError, TypeError) as exc:
                    logger.warning("Draw WS advance_round failed room=%s player=%s error=%s payload=%s", room_code, player_id or "unknown", exc, data)
                    await send_action_error(player_id, action_id, str(exc))

            elif event_type == "clear":
                await manager.broadcast(room_code, {"type": "clear"})
                await send_action_ack(player_id, action_id)

            elif event_type == "leave":
                try:
                    room = service.leave_room(room_code, data["player_id"])
                    if room is not None:
                        await broadcast_state()
                    await send_action_ack(player_id, action_id)
                    logger.info("Draw WS leave event room=%s player=%s", room_code, data["player_id"])
                except Exception as exc:
                    logger.warning("Draw WS leave event failed room=%s player=%s error=%s", room_code, player_id or "unknown", exc)
                    await send_action_error(player_id, action_id, str(exc))
                finally:
                    manager.disconnect(room_code, websocket)
                    break

            else:
                logger.warning("Draw WS unknown event type room=%s player=%s event=%s", room_code, player_id or "unknown", event_type)

    except WebSocketDisconnect:
        logger.info("Draw WS disconnected room=%s player=%s", room_code, player_id or "unknown")
    except Exception as exc:
        logger.exception("Draw WS endpoint error room=%s player=%s error=%s", room_code, player_id or "unknown", exc)
    finally:
        manager.disconnect(room_code, websocket)
