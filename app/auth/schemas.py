"""Pydantic schemas for authentication."""

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    """Request schema for user registration."""

    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)
    email: EmailStr | None = None
    display_name: str | None = Field(default=None, max_length=100)


class LoginRequest(BaseModel):
    """Request schema for user login."""

    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)


class UserResponse(BaseModel):
    """Response schema for user information."""

    id: int
    username: str
    email: str | None = None
    display_name: str | None = None
    profile_image: str | None = None

    model_config = {"from_attributes": True}


class FriendRequest(BaseModel):
    """Request schema for adding a friend."""

    friend_username: str = Field(..., min_length=3, max_length=50)


class FriendResponse(BaseModel):
    """Response schema for friend information."""

    id: int
    username: str
    display_name: str | None = None

    model_config = {"from_attributes": True}


class ProfileUpdateResponse(BaseModel):
    """Response schema for updated profile information."""

    message: str
    user: UserResponse


class GameInviteResponse(BaseModel):
    """Serialized game invite/notification."""

    id: int
    game_key: str
    room_code: str
    status: str
    sender: UserResponse
    recipient: UserResponse
    created_at: str


class SendGameInviteRequest(BaseModel):
    """Request schema for inviting a friend to a game lobby."""

    recipient_id: int
    game_key: str = Field(..., min_length=1, max_length=50)
    room_code: str = Field(..., min_length=1, max_length=32)


class RespondGameInviteRequest(BaseModel):
    """Request schema for responding to a game invite."""

    action: str = Field(..., pattern="^(accept|reject)$")
