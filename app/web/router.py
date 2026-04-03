"""Routes for rendering frontend pages."""

from fastapi import APIRouter, Depends, Request
from fastapi.templating import Jinja2Templates

from app.auth.dependencies import get_current_user, get_current_user_optional
from app.db.models.user import User
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
):
    """Render the profile page for the authenticated user."""
    return templates.TemplateResponse(
        request,
        "profile.html",
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
    return templates.TemplateResponse(
        request,
        "undercover.html",
        {
            "request": request,
            "current_user": current_user,
        },
    )


@router.get("/games/who-am-i")
def who_am_i_page(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """Render the Who Am I game page."""
    return templates.TemplateResponse(
        request,
        "who_am_i.html",
        {
            "request": request,
            "current_user": current_user,
        },
    )