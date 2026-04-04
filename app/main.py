"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.auth.router import router as auth_router
from app.config import settings
from app.db.init_db import init_db
from app.web.router import router as web_router
from app.games.undercover.router import router as undercover_router
from app.games.who_am_i.router import router as who_am_i_router
from app.games.bluff.router import router as bluff_router
# from app.core.guess_matcher import preload_embedding_model


app = FastAPI(title=settings.app_name, debug=settings.debug)

app.add_middleware(
    SessionMiddleware,
    secret_key="change-this-in-production",
)

app.mount("/static", StaticFiles(directory="app/web/static"), name="static")

app.include_router(web_router)
app.include_router(auth_router)
app.include_router(undercover_router, prefix="/api/undercover", tags=["Undercover"])
app.include_router(who_am_i_router, prefix="/api/who-am-i", tags=["Who Am I"])
app.include_router(bluff_router, prefix="/api/bluff", tags=["Bluff"])

@app.on_event("startup")
def on_startup() -> None:
    """
    Initialize application resources on startup.
    """
    init_db()
    # preload_embedding_model()