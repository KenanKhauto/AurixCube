"""API routes for the drawing guess game."""

from fastapi import APIRouter, HTTPException

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
    DrawGuessWordOptionView,
)
from app.games.draw_guess.service import DrawGuessGameService
from fastapi import WebSocket, WebSocketDisconnect
from app.games.draw_guess.websocket_manager import manager
from app.games.draw_guess.domain import DrawGuessStroke


router = APIRouter()
service = DrawGuessGameService()


def build_room_response(room) -> DrawGuessRoomStateResponse:
    return DrawGuessRoomStateResponse(
        room_code=room.room_code,
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
def create_room(payload: DrawGuessCreateRoomRequest):
    try:
        room = service.create_room(
            host_name=payload.host_name,
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
def join_room(room_code: str, payload: DrawGuessJoinRoomRequest):
    try:
        room = service.join_room(room_code, payload.player_name, payload.character_id)
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
    await manager.connect(room_code, websocket)

    try:
        while True:
            data = await websocket.receive_json()

            event_type = data.get("type")

            # Store player_id association
            if "player_id" in data:
                manager.player_websockets[data["player_id"]] = websocket

            # DRAW EVENT
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

                    room = service.add_stroke(
                        room_code=room_code,
                        player_id=data["player_id"],
                        stroke=stroke
                    )

                    # Send stroke with proper format to all players except sender
                    await manager.broadcast(room_code, {
                        "type": "draw",
                        "stroke": {
                            "x0": stroke.x0,
                            "y0": stroke.y0,
                            "x1": stroke.x1,
                            "y1": stroke.y1,
                            "color": stroke.color,
                            "width": stroke.width,
                            "player_id": data["player_id"]
                        }
                    })
                except (ValueError, KeyError, TypeError) as e:
                    # Skip invalid stroke data
                    print(f"Invalid draw data received: {e}")
                    pass

            # GUESS EVENT
            elif event_type == "guess":
                room = service.submit_guess(
                    room_code=room_code,
                    player_id=data["player_id"],
                    guess_text=data["text"]
                )

                last_guess = room.guesses[-1]

                await manager.broadcast(room_code, {
                    "type": "guess",
                    "player_name": last_guess.player_name,
                    "text": last_guess.text,
                    "is_correct": last_guess.is_correct,
                    "player_id": last_guess.player_id
                })

            # CLEAR CANVAS
            elif event_type == "clear":
                await manager.broadcast(room_code, {
                    "type": "clear"
                })

            # LEAVE EVENT
            elif event_type == "leave":
                room = service.leave_room(room_code, data["player_id"])
                # Optionally broadcast that player left
                await manager.broadcast(room_code, {
                    "type": "player_left",
                    "player_id": data["player_id"]
                })

    except WebSocketDisconnect:
        manager.disconnect(room_code, websocket, service)
