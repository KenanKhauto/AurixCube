"""Routes for rendering frontend pages."""

from fastapi import APIRouter, Depends, Request
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, get_current_user_optional
from app.auth.service import AuthService
from app.db.models.user import User
from app.db.session import get_db
from app.games.registry import GAMES



router = APIRouter()
templates = Jinja2Templates(directory="app/web/templates")


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