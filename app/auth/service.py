"""Authentication service layer."""

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.auth.profile_image_storage import (
    ALLOWED_PROFILE_IMAGE_EXTENSIONS,
    MAX_PROFILE_IMAGE_BYTES,
    LocalProfileImageStorage,
    S3ProfileImageStorage,
)
from app.auth.schemas import RegisterRequest
from app.auth.security import hash_password, verify_password
from app.config import settings
from app.db.models.friend import Friend
from app.db.models.game_invite import GameInvite
from app.db.models.user import User
from app.services.game_history_service import get_user_game_history

GAME_INVITE_PATHS = {
    "bluff": "/games/bluff",
    "who_am_i": "/games/who-am-i",
    "undercover": "/games/undercover",
    "draw_guess": "/games/draw-guess",
}


class AuthService:
    """
    Service layer for authentication-related business logic.
    """
    def __init__(self):
        self.profile_image_storage = self._build_profile_image_storage()

    def _build_profile_image_storage(self):
        backend = (settings.profile_image_storage_backend or "local").lower()
        if backend == "local":
            return LocalProfileImageStorage(
                upload_dir=settings.profile_image_local_dir,
                public_base_url=settings.profile_image_local_base_url,
            )
        if backend == "s3":
            if not settings.profile_image_s3_bucket:
                raise ValueError("PROFILE_IMAGE_S3_BUCKET is required when PROFILE_IMAGE_STORAGE_BACKEND=s3.")
            return S3ProfileImageStorage(
                bucket=settings.profile_image_s3_bucket,
                region=settings.profile_image_s3_region,
                prefix=settings.profile_image_s3_prefix,
                public_base_url=settings.profile_image_s3_public_base_url or None,
                endpoint_url=settings.profile_image_s3_endpoint_url or None,
            )
        raise ValueError(f"Unsupported PROFILE_IMAGE_STORAGE_BACKEND: {backend}")

    def get_user_by_id(self, db: Session, user_id: int) -> User | None:
        """
        Get a user by primary key.

        Args:
            db: Database session.
            user_id: User ID.

        Returns:
            The user if found, otherwise None.
        """
        return db.get(User, user_id)

    def get_user_by_username(self, db: Session, username: str) -> User | None:
        """
        Get a user by username.

        Args:
            db: Database session.
            username: Username.

        Returns:
            The user if found, otherwise None.
        """
        stmt = select(User).where(User.username == username)
        return db.execute(stmt).scalar_one_or_none()

    def create_user(self, db: Session, payload: RegisterRequest) -> User:
        """
        Create a new user.

        Args:
            db: Database session.
            payload: Registration payload.

        Returns:
            The created user.

        Raises:
            ValueError: If username is already taken.
        """
        existing_user = self.get_user_by_username(db, payload.username)
        if existing_user:
            raise ValueError("Username already exists.")

        user = User(
            username=payload.username,
            email=payload.email,
            display_name=payload.display_name or payload.username,
            profile_image="profile_img_default.png",
            password_hash=hash_password(payload.password),
        )

        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def authenticate_user(self, db: Session, username: str, password: str) -> User | None:
        """
        Authenticate a user.

        Args:
            db: Database session.
            username: Username.
            password: Plain-text password.

        Returns:
            The authenticated user if credentials are valid, otherwise None.
        """
        user = self.get_user_by_username(db, username)
        if not user:
            return None

        if not verify_password(password, user.password_hash):
            return None

        return user

    def update_profile(
        self,
        db: Session,
        user_id: int,
        username: str,
        display_name: str | None,
        email: str | None,
        current_password: str | None = None,
        new_password: str | None = None,
        profile_image_bytes: bytes | None = None,
        profile_image_extension: str | None = None,
    ) -> User:
        """
        Update editable profile fields for a user.

        Raises:
            ValueError: If any field is invalid or conflicts with another user.
        """
        user = self.get_user_by_id(db, user_id)
        if not user:
            raise ValueError("User not found.")

        username = username.strip()
        if len(username) < 3 or len(username) > 50:
            raise ValueError("Username must be between 3 and 50 characters.")

        display_name = (display_name or "").strip() or None
        if display_name and len(display_name) > 100:
            raise ValueError("Display name must be at most 100 characters.")

        email = (email or "").strip() or None

        existing_user = self.get_user_by_username(db, username)
        if existing_user and existing_user.id != user.id:
            raise ValueError("Username already exists.")

        if email:
            existing_email_user = db.execute(
                select(User).where(User.email == email)
            ).scalar_one_or_none()
            if existing_email_user and existing_email_user.id != user.id:
                raise ValueError("Email already exists.")

        if new_password:
            if len(new_password) < 6 or len(new_password) > 128:
                raise ValueError("New password must be between 6 and 128 characters.")
            if not current_password:
                raise ValueError("Current password is required to set a new password.")
            if not verify_password(current_password, user.password_hash):
                raise ValueError("Current password is incorrect.")
            user.password_hash = hash_password(new_password)

        if profile_image_bytes is not None:
            new_profile_image = self._store_profile_image(
                user=user,
                image_bytes=profile_image_bytes,
                extension=profile_image_extension or ".png",
            )
            user.profile_image = new_profile_image

        user.username = username
        user.display_name = display_name or username
        user.email = email

        db.commit()
        db.refresh(user)
        return user

    def _store_profile_image(self, user: User, image_bytes: bytes, extension: str) -> str:
        extension = extension.lower()
        if extension not in ALLOWED_PROFILE_IMAGE_EXTENSIONS:
            raise ValueError("Unsupported image format.")

        if len(image_bytes) > MAX_PROFILE_IMAGE_BYTES:
            raise ValueError("Profile image must be 5 MB or smaller.")

        try:
            return self.profile_image_storage.store(
                user_id=user.id,
                image_bytes=image_bytes,
                extension=extension,
                old_image=user.profile_image,
            )
        except ValueError:
            raise
        except OSError as exc:
            raise ValueError("Unable to save profile image on server storage.") from exc
        except Exception as exc:
            raise ValueError("Unable to save profile image on server storage.") from exc

    def add_friend(self, db: Session, user_id: int, friend_username: str) -> None:
        """
        Send a friend request.

        Args:
            db: Database session.
            user_id: User ID sending the request.
            friend_username: Username of the potential friend.

        Raises:
            ValueError: If user not found, self-request, or request already exists.
        """
        user = self.get_user_by_id(db, user_id)
        friend = self.get_user_by_username(db, friend_username)

        if not friend:
            raise ValueError("User not found.")

        if user_id == friend.id:
            raise ValueError("Cannot add yourself as a friend.")

        # Check if request already exists
        existing = db.execute(
            select(Friend).where(
                ((Friend.user_id == user_id) & (Friend.friend_id == friend.id)) |
                ((Friend.user_id == friend.id) & (Friend.friend_id == user_id))
            )
        ).scalar_one_or_none()

        if existing:
            if existing.status == "accepted":
                raise ValueError("Already friends.")
            elif existing.status == "pending":
                raise ValueError("Friend request already sent.")

        # Create friend request
        friendship = Friend(user_id=user_id, friend_id=friend.id, status="pending")
        db.add(friendship)
        db.commit()

    def send_game_invite(
        self,
        db: Session,
        sender_id: int,
        recipient_id: int,
        game_key: str,
        room_code: str,
    ) -> GameInvite:
        """Send a game invite notification to an accepted friend."""
        sender = self.get_user_by_id(db, sender_id)
        recipient = self.get_user_by_id(db, recipient_id)

        if not sender or not recipient:
            raise ValueError("User not found.")
        if sender_id == recipient_id:
            raise ValueError("Cannot invite yourself.")
        if game_key not in GAME_INVITE_PATHS:
            raise ValueError("Unsupported game.")

        are_friends = db.execute(
            select(Friend).where(
                (Friend.user_id == sender_id)
                & (Friend.friend_id == recipient_id)
                & (Friend.status == "accepted")
            )
        ).scalar_one_or_none()
        if not are_friends:
            raise ValueError("You can only invite accepted friends.")

        existing_invite = db.execute(
            select(GameInvite).where(
                (GameInvite.sender_id == sender_id)
                & (GameInvite.recipient_id == recipient_id)
                & (GameInvite.game_key == game_key)
                & (GameInvite.room_code == room_code)
                & (GameInvite.status == "pending")
            )
        ).scalar_one_or_none()
        if existing_invite:
            raise ValueError("An invite is already pending for this friend.")

        invite = GameInvite(
            sender_id=sender_id,
            recipient_id=recipient_id,
            game_key=game_key,
            room_code=room_code.upper(),
            status="pending",
        )
        db.add(invite)
        db.commit()
        db.refresh(invite)
        return invite

    def get_game_invites(self, db: Session, user_id: int) -> list[GameInvite]:
        """Return recent invites sent to the current user."""
        return list(
            db.execute(
                select(GameInvite)
                .where(GameInvite.recipient_id == user_id)
                .order_by(desc(GameInvite.created_at))
            ).scalars().all()
        )

    def respond_to_game_invite(
        self,
        db: Session,
        user_id: int,
        invite_id: int,
        action: str,
    ) -> GameInvite:
        """Accept or reject a pending game invite."""
        invite = db.get(GameInvite, invite_id)
        if not invite or invite.recipient_id != user_id:
            raise ValueError("Invite not found.")
        if invite.status != "pending":
            raise ValueError("Invite has already been handled.")

        invite.status = "accepted" if action == "accept" else "rejected"
        db.commit()
        db.refresh(invite)
        return invite

    def get_game_invite_path(self, game_key: str) -> str:
        """Resolve the frontend path for a game invite."""
        path = GAME_INVITE_PATHS.get(game_key)
        if not path:
            raise ValueError("Unsupported game.")
        return path

    def accept_friend_request(self, db: Session, user_id: int, requester_id: int) -> None:
        """
        Accept a friend request.

        Args:
            db: Database session.
            user_id: User ID accepting the request.
            requester_id: User ID who sent the request.

        Raises:
            ValueError: If no pending request exists.
        """
        friendship = db.execute(
            select(Friend).where(
                (Friend.user_id == requester_id) & (Friend.friend_id == user_id) & (Friend.status == "pending")
            )
        ).scalar_one_or_none()

        if not friendship:
            raise ValueError("No pending friend request found.")

        friendship.status = "accepted"
        # Create the reverse relationship
        reverse_friendship = Friend(user_id=user_id, friend_id=requester_id, status="accepted")
        db.add(reverse_friendship)
        db.commit()

    def decline_friend_request(self, db: Session, user_id: int, requester_id: int) -> None:
        """
        Decline a friend request.

        Args:
            db: Database session.
            user_id: User ID declining the request.
            requester_id: User ID who sent the request.

        Raises:
            ValueError: If no pending request exists.
        """
        friendship = db.execute(
            select(Friend).where(
                (Friend.user_id == requester_id) & (Friend.friend_id == user_id) & (Friend.status == "pending")
            )
        ).scalar_one_or_none()

        if not friendship:
            raise ValueError("No pending friend request found.")

        db.delete(friendship)
        db.commit()

    def remove_friend(self, db: Session, user_id: int, friend_username: str) -> None:
        """
        Remove a friend relationship.

        Args:
            db: Database session.
            user_id: User ID removing the friend.
            friend_username: Username of the friend to remove.

        Raises:
            ValueError: If friend not found or not friends.
        """
        friend = self.get_user_by_username(db, friend_username)

        if not friend:
            raise ValueError("User not found.")

        # Find and delete both directions
        friendships = db.execute(
            select(Friend).where(
                ((Friend.user_id == user_id) & (Friend.friend_id == friend.id)) |
                ((Friend.user_id == friend.id) & (Friend.friend_id == user_id))
            )
        ).scalars().all()

        if not friendships:
            raise ValueError("Not friends.")

        for f in friendships:
            db.delete(f)
        db.commit()

    def get_friends(self, db: Session, user_id: int) -> list[User]:
        """
        Get list of accepted friends for a user.

        Args:
            db: Database session.
            user_id: User ID.

        Returns:
            List of friend users.
        """
        friendships = db.execute(
            select(Friend).where((Friend.user_id == user_id) & (Friend.status == "accepted"))
        ).scalars().all()

        friend_ids = [f.friend_id for f in friendships]
        if not friend_ids:
            return []

        friends = db.execute(
            select(User).where(User.id.in_(friend_ids))
        ).scalars().all()

        return list(friends)

    def get_pending_requests(self, db: Session, user_id: int) -> list[User]:
        """
        Get list of users who sent friend requests to this user.

        Args:
            db: Database session.
            user_id: User ID.

        Returns:
            List of users who sent pending requests.
        """
        friendships = db.execute(
            select(Friend).where((Friend.friend_id == user_id) & (Friend.status == "pending"))
        ).scalars().all()

        requester_ids = [f.user_id for f in friendships]
        if not requester_ids:
            return []

        requesters = db.execute(
            select(User).where(User.id.in_(requester_ids))
        ).scalars().all()

        return list(requesters)

    def get_game_history(
        self,
        db: Session,
        user_id: int,
        username: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        """Return the current user's historical game sessions."""
        return get_user_game_history(db=db, user_id=user_id, username=username, limit=limit)
