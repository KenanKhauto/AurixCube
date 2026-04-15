"""Routes for rendering frontend pages."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi import HTTPException
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin, get_current_user, get_current_user_optional
from app.auth.security import hash_password
from app.auth.service import AuthService
from app.config import settings
from app.db.models.friend import Friend
from app.db.models.game_invite import GameInvite
from app.db.models.game_session import GameSession
from app.db.models.game_session_participant import GameSessionParticipant
from app.db.models.user import User
from app.db.session import get_db
from app.games.bluff.service import BluffGameService
from app.games.draw_guess.service import DrawGuessGameService
from app.games.letters.service import LettersGameService
from app.games.registry import GAMES
from app.games.undercover.service import UndercoverGameService
from app.games.who_am_i.service import WhoAmIService
from app.games.bluff.websocket_manager import manager as bluff_ws_manager
from app.games.draw_guess.websocket_manager import manager as draw_ws_manager
from app.games.letters.websocket_manager import manager as letters_ws_manager
from app.games.who_am_i.websocket_manager import manager as who_am_i_ws_manager
from app.services.room_storage import get_room_repository



router = APIRouter()
templates = Jinja2Templates(directory="app/web/templates")
templates.env.globals["posthog_api_key"] = settings.posthog_api_key
templates.env.globals["posthog_host"] = settings.posthog_host


@router.get("/")
def home(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Render the home page."""
    return templates.TemplateResponse(
        request,
        "home.html",
        {
            "request": request,
            "games": GAMES,
            "current_user": current_user,
        },
    )


@router.get("/games")
def games_page(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Render the games page."""
    return templates.TemplateResponse(
        request,
        "home.html",
        {
            "request": request,
            "games": GAMES,
            "current_user": current_user,
        },
    )





@router.get("/about")
def about_page(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Render the about page."""
    return templates.TemplateResponse(
        request,
        "about.html",
        {
            "request": request,
            "current_user": current_user,
        },
    )


@router.get("/profile")
def profile_page(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Render the profile page for the authenticated user."""
    auth_service = AuthService()
    friends = auth_service.get_friends(db, current_user.id)
    return templates.TemplateResponse(
        request,
        "profile.html",
        {
            "request": request,
            "current_user": current_user,
            "friends": friends,
        },
    )


@router.get("/profile/game-history")
def game_history_page(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Render the dedicated game history page for the authenticated user."""
    return templates.TemplateResponse(
        request,
        "game_history.html",
        {
            "request": request,
            "current_user": current_user,
        },
    )

@router.get("/games/undercover")
def undercover_page(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Render the Undercover game page."""
    game = next((game for game in GAMES if game["path"] == "/games/undercover"), {})

    return templates.TemplateResponse(
        request,
        "undercover.html",
        {
            "request": request,
            "current_user": current_user,
            "theme_class": game.get("theme_class", ""),
        },
    )


@router.get("/games/who-am-i")
def who_am_i_page(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Render the Who Am I game page."""
    game = next((game for game in GAMES if game["path"] == "/games/who-am-i"), {})

    return templates.TemplateResponse(
        request,
        "who_am_i.html",
        {
            "request": request,
            "current_user": current_user,
            "theme_class": game.get("theme_class", ""),
        },
    )


@router.get("/games/bluff")
def bluff_page(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Render the Bluff game page."""
    game = next((game for game in GAMES if game["path"] == "/games/bluff"), {})

    return templates.TemplateResponse(
        request,
        "bluff.html",
        {
            "request": request,
            "current_user": current_user,
            "theme_class": game.get("theme_class", ""),
        },
    )

@router.get("/games/draw-guess")
def draw_guess_page(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Render the Draw & Guess game page."""
    game = next((game for game in GAMES if game["path"] == "/games/draw-guess"), {})

    return templates.TemplateResponse(
        request,
        "draw_guess.html",
        {
            "request": request,
            "current_user": current_user,
            "theme_class": game.get("theme_class", ""),
        },
    )


@router.get("/games/letters")
def letters_page(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Render the letters game page."""
    game = next((game for game in GAMES if game["path"] == "/games/letters"), {})

    return templates.TemplateResponse(
        request,
        "letters.html",
        {
            "request": request,
            "current_user": current_user,
            "theme_class": game.get("theme_class", ""),
        },
    )


def _infer_game_type(room_data: dict) -> str:
    game_type = room_data.get("game_type")
    if isinstance(game_type, str) and game_type:
        return game_type

    if "undercover_count" in room_data:
        return "undercover"
    if "reveal_phase_active" in room_data:
        return "who_am_i"
    if "drawer_order" in room_data or "current_drawer_id" in room_data:
        return "draw_guess"
    if "used_letters" in room_data and "active_categories" in room_data:
        return "letters"
    if "answer_options" in room_data and "total_rounds" in room_data:
        return "bluff"
    return "unknown"


def _room_status(room_data: dict) -> str:
    if room_data.get("ended"):
        return f"ended:{room_data.get('end_reason') or 'unknown'}"
    if not room_data.get("started"):
        return "waiting"
    return room_data.get("phase") or "active"


def _build_live_room_snapshot() -> dict:
    repository = get_room_repository()
    raw_rooms = repository.list_rooms()

    room_items: list[dict] = []
    for storage_room_code, room_data in raw_rooms.items():
        storage_prefix = ""
        room_code = storage_room_code
        if ":" in storage_room_code:
            storage_prefix, room_code = storage_room_code.split(":", 1)

        inferred_game_type = _infer_game_type(room_data)
        if inferred_game_type == "unknown" and storage_prefix in {"bluff", "draw_guess", "who_am_i", "undercover", "letters"}:
            inferred_game_type = storage_prefix

        players = list((room_data.get("players") or {}).values())

        player_names = [player.get("name") for player in players if player.get("name")]
        usernames = [player.get("username") for player in players if player.get("username")]

        room_items.append(
            {
                "room_code": room_code,
                "game_type": inferred_game_type,
                "status": _room_status(room_data),
                "user_count": len(players),
                "player_names": player_names,
                "usernames": usernames,
                "created_at": room_data.get("_meta_created_at"),
                "last_activity_at": room_data.get("_meta_updated_at"),
            }
        )

    connected_users = (
        sum(len(room_connections) for room_connections in draw_ws_manager.rooms.values())
        + sum(len(room_connections) for room_connections in bluff_ws_manager.rooms.values())
        + sum(len(room_connections) for room_connections in who_am_i_ws_manager.rooms.values())
        + sum(len(room_connections) for room_connections in letters_ws_manager.rooms.values())
    )

    return {
        "total_active_rooms": len(room_items),
        "total_connected_users": connected_users,
        "rooms": sorted(room_items, key=lambda item: item.get("last_activity_at") or "", reverse=True),
    }


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        # Accept trailing Z format.
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid datetime format: {value}") from exc


def _apply_live_room_filters(
    rooms: list[dict],
    game_type: str | None,
    status: str | None,
    min_players: int | None,
    max_players: int | None,
    search: str | None,
) -> list[dict]:
    filtered = rooms
    if game_type:
        filtered = [room for room in filtered if (room.get("game_type") or "") == game_type]
    if status:
        filtered = [room for room in filtered if (room.get("status") or "") == status]
    if min_players is not None:
        filtered = [room for room in filtered if int(room.get("user_count") or 0) >= min_players]
    if max_players is not None:
        filtered = [room for room in filtered if int(room.get("user_count") or 0) <= max_players]
    if search:
        needle = search.strip().lower()
        if needle:
            filtered = [
                room
                for room in filtered
                if needle in (room.get("room_code") or "").lower()
                or needle in (room.get("game_type") or "").lower()
                or any(needle in (name or "").lower() for name in room.get("player_names") or [])
                or any(needle in (username or "").lower() for username in room.get("usernames") or [])
            ]
    return filtered


def _sort_live_rooms(
    rooms: list[dict],
    sort_by: str,
    sort_order: Literal["asc", "desc"],
) -> list[dict]:
    reverse = sort_order == "desc"
    if sort_by == "user_count":
        key_fn = lambda room: int(room.get("user_count") or 0)
    elif sort_by == "game_type":
        key_fn = lambda room: room.get("game_type") or ""
    elif sort_by == "status":
        key_fn = lambda room: room.get("status") or ""
    elif sort_by == "created_at":
        key_fn = lambda room: room.get("created_at") or ""
    else:
        key_fn = lambda room: room.get("last_activity_at") or ""
    return sorted(rooms, key=key_fn, reverse=reverse)


def _delete_room_as_admin(game_type: str, room_code: str) -> None:
    game_type = (game_type or "").strip()
    room_code = (room_code or "").strip().upper()
    if game_type not in {"bluff", "draw_guess", "who_am_i", "undercover", "letters"}:
        raise HTTPException(status_code=400, detail="Unsupported game type.")

    scoped_repo = get_room_repository(game_type)
    room_data = scoped_repo.get_room(room_code)
    if not room_data:
        raise HTTPException(status_code=404, detail="Room not found.")

    host_id = room_data.get("host_id")
    if not host_id:
        raise HTTPException(status_code=400, detail="Host id missing in room data.")

    if game_type == "bluff":
        BluffGameService().delete_room(room_code, str(host_id))
    elif game_type == "draw_guess":
        DrawGuessGameService().delete_room(room_code, str(host_id))
    elif game_type == "who_am_i":
        WhoAmIService().delete_room(room_code, str(host_id))
    elif game_type == "letters":
        LettersGameService().delete_room(room_code, str(host_id))
    else:
        UndercoverGameService().delete_room(room_code, str(host_id))


class AdminUserUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=50)
    display_name: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=255)
    new_password: str | None = Field(default=None, min_length=6, max_length=128)


@router.get("/admin/live")
def admin_live_page(
    request: Request,
    current_user: User = Depends(get_current_admin),
):
    """Render the admin-only live monitoring page."""
    return templates.TemplateResponse(
        request,
        "admin_live.html",
        {
            "request": request,
            "current_user": current_user,
        },
    )


@router.get("/api/admin/live-rooms")
def admin_live_rooms_api(
    current_user: User = Depends(get_current_admin),
):
    """Return live room monitoring data for admins."""
    return _build_live_room_snapshot()


@router.get("/api/admin/dashboard/live-rooms")
def admin_dashboard_live_rooms_api(
    game_type: str | None = None,
    status: str | None = None,
    min_players: int | None = None,
    max_players: int | None = None,
    search: str | None = None,
    sort_by: str = "last_activity_at",
    sort_order: Literal["asc", "desc"] = "desc",
    current_user: User = Depends(get_current_admin),
):
    snapshot = _build_live_room_snapshot()
    rooms = snapshot.get("rooms") or []
    rooms = _apply_live_room_filters(
        rooms=rooms,
        game_type=game_type,
        status=status,
        min_players=min_players,
        max_players=max_players,
        search=search,
    )
    rooms = _sort_live_rooms(rooms, sort_by=sort_by, sort_order=sort_order)
    return {
        "total_active_rooms": len(rooms),
        "total_connected_users": snapshot.get("total_connected_users") or 0,
        "rooms": rooms,
    }


@router.post("/api/admin/dashboard/rooms/{game_type}/{room_code}/delete")
def admin_dashboard_delete_room_api(
    game_type: str,
    room_code: str,
    current_user: User = Depends(get_current_admin),
):
    _delete_room_as_admin(game_type=game_type, room_code=room_code)
    return {"message": "Room deleted successfully."}


@router.get("/api/admin/dashboard/history")
def admin_dashboard_history_api(
    db: Session = Depends(get_db),
    game_type: str | None = None,
    end_reason: str | None = None,
    min_players: int | None = None,
    max_players: int | None = None,
    started_at: str | None = None,
    ended_at: str | None = None,
    sort_by: str = "ended_at",
    sort_order: Literal["asc", "desc"] = "desc",
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(get_current_admin),
):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 500")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")

    start_dt = _parse_iso_datetime(started_at)
    end_dt = _parse_iso_datetime(ended_at)

    query = select(GameSession)
    if game_type:
        query = query.where(GameSession.game_type == game_type)
    if end_reason:
        query = query.where(GameSession.end_reason == end_reason)
    if min_players is not None:
        query = query.where(GameSession.player_count >= min_players)
    if max_players is not None:
        query = query.where(GameSession.player_count <= max_players)
    if start_dt is not None:
        query = query.where(GameSession.ended_at >= start_dt)
    if end_dt is not None:
        query = query.where(GameSession.ended_at <= end_dt)

    if sort_by == "player_count":
        sort_col = GameSession.player_count
    elif sort_by == "game_type":
        sort_col = GameSession.game_type
    elif sort_by == "end_reason":
        sort_col = GameSession.end_reason
    else:
        sort_col = GameSession.ended_at

    query = query.order_by(asc(sort_col) if sort_order == "asc" else desc(sort_col))

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    rows = db.execute(query.offset(offset).limit(limit)).scalars().all()

    return {
        "total": total,
        "items": [
            {
                "session_id": row.session_id,
                "game_type": row.game_type,
                "room_code": row.room_code,
                "host_player_name": row.host_player_name,
                "host_username": row.host_username,
                "player_count": row.player_count,
                "end_reason": row.end_reason,
                "winner_ids": row.winner_ids or [],
                "ended_at": row.ended_at.isoformat(),
                "summary": row.summary or {},
            }
            for row in rows
        ],
    }


@router.get("/api/admin/dashboard/users")
def admin_dashboard_users_api(
    db: Session = Depends(get_db),
    search: str | None = None,
    sort_by: str = "created_at",
    sort_order: Literal["asc", "desc"] = "desc",
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(get_current_admin),
):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 500")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")

    query = select(User)
    if search:
        needle = f"%{search.strip()}%"
        if needle != "%%":
            query = query.where(
                or_(
                    User.username.ilike(needle),
                    User.display_name.ilike(needle),
                    User.email.ilike(needle),
                )
            )

    if sort_by == "username":
        sort_col = User.username
    elif sort_by == "email":
        sort_col = User.email
    else:
        sort_col = User.created_at
    query = query.order_by(asc(sort_col) if sort_order == "asc" else desc(sort_col))

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    users = db.execute(query.offset(offset).limit(limit)).scalars().all()

    # Collect lightweight participation stats for displayed users.
    user_ids = [u.id for u in users]
    sessions_by_user: dict[int, int] = {}
    wins_by_user: dict[int, int] = {}
    if user_ids:
        session_counts = db.execute(
            select(
                GameSessionParticipant.user_id,
                func.count(GameSessionParticipant.id),
            )
            .where(GameSessionParticipant.user_id.in_(user_ids))
            .group_by(GameSessionParticipant.user_id)
        ).all()
        sessions_by_user = {int(uid): int(cnt) for uid, cnt in session_counts if uid is not None}

        win_counts = db.execute(
            select(
                GameSessionParticipant.user_id,
                func.count(GameSessionParticipant.id),
            )
            .where(
                GameSessionParticipant.user_id.in_(user_ids),
                GameSessionParticipant.is_winner.is_(True),
            )
            .group_by(GameSessionParticipant.user_id)
        ).all()
        wins_by_user = {int(uid): int(cnt) for uid, cnt in win_counts if uid is not None}

    return {
        "total": total,
        "items": [
            {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
                "email": user.email,
                "profile_image": user.profile_image,
                "created_at": user.created_at.isoformat(),
                "is_admin": (user.username or "").strip().lower() in settings.admin_usernames,
                "session_count": sessions_by_user.get(user.id, 0),
                "win_count": wins_by_user.get(user.id, 0),
            }
            for user in users
        ],
    }


@router.patch("/api/admin/dashboard/users/{user_id}")
def admin_dashboard_update_user_api(
    user_id: int,
    payload: AdminUserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if payload.username is not None:
        next_username = payload.username.strip()
        existing = db.execute(select(User).where(User.username == next_username)).scalar_one_or_none()
        if existing and existing.id != user.id:
            raise HTTPException(status_code=400, detail="Username already exists.")
        user.username = next_username

    if payload.email is not None:
        next_email = payload.email.strip() or None
        if next_email:
            existing = db.execute(select(User).where(User.email == next_email)).scalar_one_or_none()
            if existing and existing.id != user.id:
                raise HTTPException(status_code=400, detail="Email already exists.")
        user.email = next_email

    if payload.display_name is not None:
        user.display_name = payload.display_name.strip() or None

    if payload.new_password:
        user.password_hash = hash_password(payload.new_password)

    db.commit()
    db.refresh(user)
    return {
        "message": "User updated successfully.",
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "email": user.email,
            "created_at": user.created_at.isoformat(),
        },
    }


@router.delete("/api/admin/dashboard/users/{user_id}")
def admin_dashboard_delete_user_api(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own admin user.")

    # Clean relationships and references before user delete.
    db.query(Friend).filter(or_(Friend.user_id == user.id, Friend.friend_id == user.id)).delete(
        synchronize_session=False
    )
    db.query(GameInvite).filter(or_(GameInvite.sender_id == user.id, GameInvite.recipient_id == user.id)).delete(
        synchronize_session=False
    )
    db.query(GameSessionParticipant).filter(GameSessionParticipant.user_id == user.id).update(
        {GameSessionParticipant.user_id: None},
        synchronize_session=False,
    )

    db.delete(user)
    db.commit()
    return {"message": "User deleted successfully."}
