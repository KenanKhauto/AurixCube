(function () {
    const ANON_ID_KEY = "aurixcube_anon_id";
    const SITE_JOINED_TRACKED_KEY = "aurixcube_user_joined_site_tracked";
    const FINISHED_TRACKED_PREFIX = "aurixcube_game_finished_";
    const STARTED_AT_PREFIX = "aurixcube_game_started_at_";

    function safeNowIso() {
        return new Date().toISOString();
    }

    function getMetaValue(name, fallback = "") {
        const el = document.querySelector(`meta[name="${name}"]`);
        return (el?.content || fallback || "").trim();
    }

    function makeAnonId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function getOrCreateAnonId() {
        const existing = localStorage.getItem(ANON_ID_KEY);
        if (existing) return existing;
        const value = makeAnonId();
        localStorage.setItem(ANON_ID_KEY, value);
        return value;
    }

    function isPosthogEnabled(key) {
        return Boolean(key) && key !== "POSTHOG_API_KEY";
    }

    const posthogKey = getMetaValue("posthog-api-key", "POSTHOG_API_KEY");
    const posthogHost = getMetaValue("posthog-host", "https://us.i.posthog.com");
    const anonId = getOrCreateAnonId();
    const currentUser = window.appCurrentUser || null;

    function appTrackEvent(eventName, properties = {}) {
        try {
            if (!window.posthog || !isPosthogEnabled(posthogKey)) return;
            window.posthog.capture(eventName, {
                ...properties,
                path: window.location.pathname,
                title: document.title,
                timestamp: safeNowIso(),
            });
        } catch (error) {
            console.debug("Analytics track error:", error);
        }
    }

    window.appTrackEvent = appTrackEvent;

    function initPosthog() {
        if (!window.posthog || !isPosthogEnabled(posthogKey)) return;
        try {
            window.posthog.init(posthogKey, {
                api_host: posthogHost,
                capture_pageview: false,
                persistence: "localStorage+cookie",
                loaded: function () {
                    try {
                        const distinctId = currentUser?.id ? `user:${currentUser.id}` : `anon:${anonId}`;
                        window.posthog.identify(distinctId, {
                            username: currentUser?.username || null,
                            display_name: currentUser?.display_name || null,
                            is_authenticated: Boolean(currentUser?.id),
                        });
                    } catch (error) {
                        console.debug("Analytics identify error:", error);
                    }
                },
            });
        } catch (error) {
            console.debug("Analytics init error:", error);
        }
    }

    function trackInitialEvents() {
        appTrackEvent("page_view", {
            referrer: document.referrer || null,
            is_authenticated: Boolean(currentUser?.id),
        });

        if (!localStorage.getItem(SITE_JOINED_TRACKED_KEY)) {
            appTrackEvent("user_joined_site", {
                anon_id: anonId,
                is_authenticated: Boolean(currentUser?.id),
            });
            localStorage.setItem(SITE_JOINED_TRACKED_KEY, "1");
        }
    }

    function trackGameFinishedOnce(gameType, roomCode, extra = {}) {
        if (!roomCode) return;
        const key = `${FINISHED_TRACKED_PREFIX}${gameType}_${roomCode}`;
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
        const startedAtRaw = localStorage.getItem(`${STARTED_AT_PREFIX}${gameType}_${roomCode}`);
        let duration = null;
        if (startedAtRaw) {
            const startedAt = Number(startedAtRaw);
            if (!Number.isNaN(startedAt) && startedAt > 0) {
                duration = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            }
        }
        appTrackEvent("game_finished", {
            game_type: gameType,
            room_code: roomCode,
            duration,
            ...extra,
        });
    }

    function markGameStarted(gameType, roomCode) {
        if (!roomCode) return;
        localStorage.setItem(`${STARTED_AT_PREFIX}${gameType}_${roomCode}`, String(Date.now()));
    }

    function wrapAsyncFunction(name, onSuccess) {
        const fn = window[name];
        if (typeof fn !== "function") return;
        if (fn.__analytics_wrapped) return;

        const wrapped = async function (...args) {
            const result = await fn.apply(this, args);
            try {
                await onSuccess(args, result);
            } catch (error) {
                console.debug(`Analytics wrapper failed for ${name}:`, error);
            }
            return result;
        };
        wrapped.__analytics_wrapped = true;
        window[name] = wrapped;
    }

    function wireGameEvents() {
        const path = window.location.pathname || "";
        const isWhoAmIPage = path.includes("/games/who-am-i");
        const isUndercoverPage = path.includes("/games/undercover");
        const whoAmIRoomCode = () => localStorage.getItem("whoami_room_code");
        const undercoverRoomCode = () => localStorage.getItem("undercover_room_code");
        const bluffRoomCode = () => localStorage.getItem("bluff_room_code");
        const drawRoomCode = () => localStorage.getItem("draw_room_code");

        wrapAsyncFunction("joinRoom", async () => {
            appTrackEvent("room_joined", {
                game_type: isWhoAmIPage ? "who_am_i" : "undercover",
                room_code: isWhoAmIPage ? whoAmIRoomCode() : undercoverRoomCode(),
            });
        });
        wrapAsyncFunction("joinBluffRoom", async () => {
            appTrackEvent("room_joined", {
                game_type: "bluff",
                room_code: bluffRoomCode(),
            });
        });
        wrapAsyncFunction("joinDrawRoom", async () => {
            appTrackEvent("room_joined", {
                game_type: "draw_guess",
                room_code: drawRoomCode(),
            });
        });
        wrapAsyncFunction("submitGuess", async () => {
            appTrackEvent("guess_submitted", {
                game_type: "who_am_i",
                room_code: whoAmIRoomCode(),
            });
        });
        wrapAsyncFunction("sendDrawGuess", async () => {
            appTrackEvent("guess_submitted", {
                game_type: "draw_guess",
                room_code: drawRoomCode(),
            });
        });
        wrapAsyncFunction("submitBluffAnswer", async () => {
            appTrackEvent("guess_submitted", {
                game_type: "bluff",
                room_code: bluffRoomCode(),
                submission_type: "answer",
            });
        });
        wrapAsyncFunction("renderGameOver", async () => {
            trackGameFinishedOnce(
                isWhoAmIPage ? "who_am_i" : (isUndercoverPage ? "undercover" : "unknown"),
                isWhoAmIPage ? whoAmIRoomCode() : undercoverRoomCode()
            );
        });
        wrapAsyncFunction("renderBluffGameOver", async () => {
            trackGameFinishedOnce("bluff", bluffRoomCode());
        });
        wrapAsyncFunction("renderDrawGameOver", async () => {
            trackGameFinishedOnce("draw_guess", drawRoomCode());
        });

        wrapAsyncFunction("startGame", async () => {
            if (isWhoAmIPage) {
                markGameStarted("who_am_i", whoAmIRoomCode());
                return;
            }
            if (isUndercoverPage) {
                markGameStarted("undercover", undercoverRoomCode());
            }
        });
        wrapAsyncFunction("startBluffGame", async () => {
            markGameStarted("bluff", bluffRoomCode());
        });
        wrapAsyncFunction("startDrawGame", async () => {
            markGameStarted("draw_guess", drawRoomCode());
        });
    }

    initPosthog();
    trackInitialEvents();

    document.addEventListener("DOMContentLoaded", () => {
        wireGameEvents();
        setTimeout(wireGameEvents, 1500);
    });
})();
