"""Routes for rendering frontend pages."""

from fastapi import APIRouter, Depends, Request
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin, get_current_user, get_current_user_optional
from app.auth.service import AuthService
from app.config import settings
from app.db.models.user import User
from app.db.session import get_db
from app.games.registry import GAMES
from app.games.bluff.websocket_manager import manager as bluff_ws_manager
from app.games.draw_guess.websocket_manager import manager as draw_ws_manager
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
        if inferred_game_type == "unknown" and storage_prefix in {"bluff", "draw_guess", "who_am_i", "undercover"}:
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
    )

    return {
        "total_active_rooms": len(room_items),
        "total_connected_users": connected_users,
        "rooms": sorted(room_items, key=lambda item: item.get("last_activity_at") or "", reverse=True),
    }


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
