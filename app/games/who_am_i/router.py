"""API routes for the Who Am I game."""

from fastapi import APIRouter, Depends, HTTPException

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

router = APIRouter()
service = WhoAmIService()


def build_room_response(room) -> RoomStateResponse:
    """Convert domain room to API response schema."""
    return RoomStateResponse(
        room_code=room.room_code,
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
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/join", response_model=RoomStateResponse)
def join_room(
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
        return build_room_response(room)
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
        return build_room_response(room)
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
