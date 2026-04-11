"""Authentication routes."""

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from starlette import status

from app.auth.dependencies import get_current_user, get_current_user_optional
from app.auth.schemas import (
    GameInviteResponse,
    ProfileUpdateResponse,
    RegisterRequest,
    RespondGameInviteRequest,
    SendGameInviteRequest,
    UserResponse,
)
from app.auth.service import AuthService
from app.db.models.user import User
from app.db.session import get_db

router = APIRouter()
templates = Jinja2Templates(directory="app/web/templates")
auth_service = AuthService()


@router.get("/login")
def login_page(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """
    Render the login page.
    """
    if current_user:
        return RedirectResponse(url="/profile", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(
        request,
        "login.html",
        {"request": request, "error": None, "current_user": current_user},
    )


@router.post("/login")
def login_user(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """
    Authenticate a user and create a session.
    """
    user = auth_service.authenticate_user(db, username=username, password=password)
    if not user:
        return templates.TemplateResponse(
            request,
            "login.html",
            {
                "request": request,
                "error": "اسم المستخدم أو كلمة المرور غير صحيحة.",
                "current_user": current_user,
            },
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    request.session["user_id"] = user.id
    return RedirectResponse(url="/profile", status_code=status.HTTP_303_SEE_OTHER)


@router.get("/register")
def register_page(
    request: Request,
    current_user: User | None = Depends(get_current_user_optional),
):
    """
    Render the registration page.
    """
    if current_user:
        return RedirectResponse(url="/profile", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(
        request,
        "register.html",
        {"request": request, "error": None, "current_user": current_user},
    )


@router.post("/register")
def register_user(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    email: str = Form(default=""),
    display_name: str = Form(default=""),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """
    Register a new user and log them in immediately.
    """
    payload = RegisterRequest(
        username=username,
        password=password,
        email=email or None,
        display_name=display_name or None,
    )

    try:
        user = auth_service.create_user(db, payload)
    except ValueError as exc:
        return templates.TemplateResponse(
            request,
            "register.html",
            {
                "request": request,
                "error": str(exc),
                "current_user": current_user,
            },
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    request.session["user_id"] = user.id
    return RedirectResponse(url="/profile", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/logout")
def logout_user(request: Request):
    """
    Log out the current user by clearing the session.
    """
    request.session.clear()
    return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/friends")
def add_friend(
    friend_username: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Add a friend.
    """
    try:
        auth_service.add_friend(db, current_user.id, friend_username)
        return {"message": "Friend request sent successfully."}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/profile", response_model=ProfileUpdateResponse)
async def update_profile(
    username: str = Form(...),
    display_name: str = Form(default=""),
    email: str = Form(default=""),
    current_password: str = Form(default=""),
    new_password: str = Form(default=""),
    profile_image: UploadFile | None = File(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the authenticated user's profile details."""
    image_bytes = None
    image_extension = None

    if profile_image and profile_image.filename:
        image_bytes = await profile_image.read()
        image_extension = Path(profile_image.filename).suffix.lower()

    try:
        user = auth_service.update_profile(
            db=db,
            user_id=current_user.id,
            username=username,
            display_name=display_name or None,
            email=email or None,
            current_password=current_password or None,
            new_password=new_password or None,
            profile_image_bytes=image_bytes,
            profile_image_extension=image_extension,
        )
        return ProfileUpdateResponse(
            message="Profile updated successfully.",
            user=UserResponse.model_validate(user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _serialize_game_invite(invite) -> GameInviteResponse:
    return GameInviteResponse(
        id=invite.id,
        game_key=invite.game_key,
        room_code=invite.room_code,
        status=invite.status,
        sender=UserResponse.model_validate(invite.sender),
        recipient=UserResponse.model_validate(invite.recipient),
        created_at=invite.created_at.isoformat(),
    )


@router.get("/friends")
def get_friends(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get list of friends.
    """
    friends = auth_service.get_friends(db, current_user.id)
    return [UserResponse.model_validate(friend) for friend in friends]


@router.get("/invites", response_model=list[GameInviteResponse])
def get_game_invites(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get game invite notifications for the current user."""
    invites = auth_service.get_game_invites(db, current_user.id)
    return [_serialize_game_invite(invite) for invite in invites]


@router.post("/invites", response_model=GameInviteResponse)
def send_game_invite(
    payload: SendGameInviteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a game invite to a friend."""
    try:
        invite = auth_service.send_game_invite(
            db=db,
            sender_id=current_user.id,
            recipient_id=payload.recipient_id,
            game_key=payload.game_key,
            room_code=payload.room_code,
        )
        return _serialize_game_invite(invite)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/invites/{invite_id}/respond")
def respond_to_game_invite(
    invite_id: int,
    payload: RespondGameInviteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Accept or reject a game invite notification."""
    try:
        invite = auth_service.respond_to_game_invite(
            db=db,
            user_id=current_user.id,
            invite_id=invite_id,
            action=payload.action,
        )
        result = {"message": "Invite updated.", "invite": _serialize_game_invite(invite).model_dump()}
        if payload.action == "accept":
            result["redirect_path"] = auth_service.get_game_invite_path(invite.game_key)
            result["room_code"] = invite.room_code
            result["game_key"] = invite.game_key
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/friends/requests")
def get_friend_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get list of pending friend requests.
    """
    requests = auth_service.get_pending_requests(db, current_user.id)
    return [UserResponse.model_validate(requester) for requester in requests]


@router.post("/friends/{requester_id}/accept")
def accept_friend_request(
    requester_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Accept a friend request.
    """
    try:
        auth_service.accept_friend_request(db, current_user.id, requester_id)
        return {"message": "Friend request accepted."}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/friends/{requester_id}/decline")
def decline_friend_request(
    requester_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Decline a friend request.
    """
    try:
        auth_service.decline_friend_request(db, current_user.id, requester_id)
        return {"message": "Friend request declined."}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
