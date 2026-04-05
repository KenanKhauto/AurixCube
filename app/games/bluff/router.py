"""API routes for the Bluff game."""

from fastapi import APIRouter, HTTPException

from app.games.bluff.constants import BLUFF_CATEGORIES
from app.games.bluff.schemas import (
    BluffAdvanceRoundRequest,
    BluffCreateRoomRequest,
    BluffDeleteRoomRequest,
    BluffJoinRoomRequest,
    BluffLeaveRoomRequest,
    BluffRestartGameRequest,
    BluffRoomStateResponse,
    BluffSubmitAnswerRequest,
    BluffSubmitVoteRequest,
    BluffAnswerOptionView,
    BluffPlayerView,
)
from app.games.bluff.service import BluffGameService

router = APIRouter()
service = BluffGameService()


def build_room_response(room) -> BluffRoomStateResponse:
    """Convert domain room to API response schema."""
    return BluffRoomStateResponse(
        room_code=room.room_code,
        host_id=room.host_id,
        categories=room.categories,
        player_count=room.player_count,
        total_rounds=room.total_rounds,
        started=room.started,
        ended=room.ended,
        winner_ids=room.winner_ids,
        current_round=room.current_round,
        phase=room.phase,
        current_question=room.current_question,
        submissions_count=len(room.submissions),
        votes_count=len(room.votes),
        last_round_message=room.last_round_message,
        last_round_correct_option_id=room.last_round_correct_option_id,
        last_round_score_changes=room.last_round_score_changes,
        votes=room.votes,
        players=[
            BluffPlayerView(
                id=player.id,
                name=player.name,
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
            )
            for option in room.answer_options
        ],
    )


@router.get("/categories")
def get_categories():
    """Return available Bluff categories."""
    return {"categories": BLUFF_CATEGORIES}


@router.post("/rooms", response_model=BluffRoomStateResponse)
def create_room(payload: BluffCreateRoomRequest):
    """Create a new Bluff room."""
    try:
        room = service.create_room(
            host_name=payload.host_name,
            player_count=payload.player_count,
            total_rounds=payload.total_rounds,
            categories=payload.categories,        
            )
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/join", response_model=BluffRoomStateResponse)
def join_room(room_code: str, payload: BluffJoinRoomRequest):
    """Join an existing Bluff room."""
    try:
        room = service.join_room(room_code, payload.player_name)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/start", response_model=BluffRoomStateResponse)
def start_room(room_code: str):
    """Start the Bluff game."""
    try:
        room = service.start_game(room_code)
        return build_room_response(room)
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


@router.post("/rooms/{room_code}/submit-answer", response_model=BluffRoomStateResponse)
def submit_answer(room_code: str, payload: BluffSubmitAnswerRequest):
    """Submit a bluff answer."""
    try:
        room = service.submit_answer(room_code, payload.player_id, payload.answer_text)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/vote", response_model=BluffRoomStateResponse)
def vote(room_code: str, payload: BluffSubmitVoteRequest):
    """Submit or replace a vote."""
    try:
        room = service.submit_vote(room_code, payload.player_id, payload.option_id)
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
        room = service.restart_game(room_code, payload.categories, payload.total_rounds)
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