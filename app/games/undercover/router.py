"""API routes for the Undercover game."""

from fastapi import APIRouter, HTTPException

from app.games.undercover.constants import CATEGORIES
from app.games.undercover.schemas import (
    CreateRoomRequest,
    JoinRoomRequest,
    RestartRoomRequest,
    RevealWordRequest,
    RoomStateResponse,
    VoteRequest,
    PlayerView,
    LeaveRoomRequest,
    DeleteRoomRequest,
    RemovePlayerRequest,
    UpdateCategoriesRequest,
)
from app.games.undercover.service import UndercoverGameService
from app.services.analytics import track_event_async

router = APIRouter()
service = UndercoverGameService()


def build_room_response(room) -> RoomStateResponse:
    """Convert domain room to API response schema."""
    player_vote_counts = {player.id: 0 for player in room.players.values()}
    for voted_targets in room.votes.values():
        for target_id in voted_targets:
            if target_id in player_vote_counts:
                player_vote_counts[target_id] += 1

    return RoomStateResponse(
        room_code=room.room_code,
        host_id=room.host_id,
        categories=room.categories,
        max_player_count=room.max_player_count,
        undercover_count=room.undercover_count,
        started=room.started,
        ended=room.ended,
        end_reason=room.end_reason,
        winner=room.winner,
        eliminated_player_id=room.eliminated_player_id,
        eliminated_player_is_undercover=room.eliminated_player_is_undercover,
        current_asker_id=room.current_asker_id,
        current_target_id=room.current_target_id,
        round_number=room.round_number,
        votes=room.votes,
        players=[
            PlayerView(
                id=player.id,
                name=player.name,
                is_eliminated=player.is_eliminated,
                votes_received=player_vote_counts[player.id],
            )
            for player in room.players.values()
        ],
    )


@router.get("/categories")
def get_categories():
    """Return available categories."""
    return {"categories": CATEGORIES}


@router.post("/rooms", response_model=RoomStateResponse)
def create_room(payload: CreateRoomRequest):
    """Create a new Undercover room."""
    try:
        room = service.create_room(
            host_name=payload.host_name,
            max_player_count=payload.max_player_count,
            undercover_count=payload.undercover_count,
            categories=payload.categories,
        )
        response = build_room_response(room)
        track_event_async(
            distinct_id=f"room_host:{room.host_id}",
            event="room_created",
            properties={
                "room_code": room.room_code,
                "game_type": "undercover",
                "max_player_count": room.max_player_count,
            },
        )
        return response
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/join", response_model=RoomStateResponse)
def join_room(room_code: str, payload: JoinRoomRequest):
    """Join an existing room."""
    try:
        room = service.join_room(room_code, payload.player_name)
        return build_room_response(room)
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
                "game_type": "undercover",
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


@router.post("/rooms/{room_code}/reveal")
def reveal_secret(room_code: str, payload: RevealWordRequest):
    """Get player's secret word."""
    try:
        return service.get_player_secret(room_code, payload.player_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/vote", response_model=RoomStateResponse)
def vote(room_code: str, payload: VoteRequest):
    """Submit or replace votes."""
    try:
        room = service.submit_vote(room_code, payload.voter_id, payload.voted_player_ids)
        return build_room_response(room)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rooms/{room_code}/restart", response_model=RoomStateResponse)
def restart_room(room_code: str, payload: RestartRoomRequest):
    """Restart room with same players and new settings."""
    try:
        room = service.restart_game(room_code, payload.categories, payload.undercover_count)
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
