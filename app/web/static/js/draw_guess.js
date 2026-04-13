let currentDrawRoomCode = localStorage.getItem("draw_room_code") || null;
let currentDrawPlayerId = localStorage.getItem("draw_player_id") || null;
let currentDrawPlayerName = localStorage.getItem("draw_player_name") || null;

let currentDrawRoomData = null;
let drawIsHost = false;
let lastRenderedDrawSignature = null;

let selectedDrawPlayerCount = null;
let selectedDrawRounds = null;
let selectedDrawCategories = [];
let allDrawCategories = [];
let selectedDrawLanguage = "en";
let selectedDrawTimer = 60;
let selectedDrawCharacter = localStorage.getItem("draw_character_id") || "char1";
let drawFriendCachePrimed = false;

let drawWS = null;
let drawWSRoomCode = null;
let drawWSReconnectTimer = null;
let drawWSShouldReconnect = false;
let drawWSBeforeUnloadBound = false;
let drawCanvas = null;
let drawCtx = null;
let drawIsDrawing = false;
let drawLastX = 0;
let drawLastY = 0;
let drawStrokeHistory = [];
let lastDrawCanvasSessionKey = null;
let latestDrawRoomVersion = 0;
let drawActionCounter = 0;
const pendingDrawActions = new Map();

const MAX_DRAW_CATEGORIES = 12;
const drawPlayerCountOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10];

const drawTimerOptions = [
    { value: 30, label: "30 ثانية" },
    { value: 60, label: "60 ثانية" },
    { value: 90, label: "90 ثانية" },
];

const drawLanguageOptions = [
    { value: "en", label: "English" },
    { value: "ar", label: "العربية" },
];

const drawCharacterOptions = Array.from({ length: 12 }, (_, i) => `char${i + 1}`);

const drawCategoryLabels = {
    animals: "حيوانات",
    objects: "جماد",
    general_sports: "رياضة",
    pc_setup: "تجميعات الكمبيوتر",
    syrian_series: "مسلسلات سورية",
};

document.addEventListener("DOMContentLoaded", async () => {
    await primeDrawFriendCache();
    renderDrawPlayerCountButtons();
    renderDrawRoundsButtons();
    renderDrawLanguageButtons();
    renderDrawTimerButtons();
    renderDrawCharacterButtons();
    await loadDrawCategories();

    const nameInput = document.getElementById("drawName");
    const defaultLobbyName = typeof getDefaultLobbyName === "function" ? getDefaultLobbyName() : "";
    const initialName = currentDrawPlayerName || defaultLobbyName;
    if (nameInput && defaultLobbyName) {
        nameInput.placeholder = defaultLobbyName;
    }
    if (nameInput && initialName && !nameInput.value.trim()) {
        nameInput.value = initialName;
    }

    if (currentDrawRoomCode) {
        const roomInput = document.getElementById("drawRoomInput");
        if (roomInput) roomInput.value = currentDrawRoomCode;
    }

    if (currentDrawRoomCode && currentDrawPlayerId) {
        await refreshDrawRoomState();
    }

    window.addEventListener("resize", () => {
        if (currentDrawRoomData?.phase === "drawing" && drawCanvas) {
            resizeDrawCanvas();
        }
    });

    window.addEventListener("orientationchange", () => {
        setTimeout(() => {
            if (currentDrawRoomData?.phase === "drawing" && drawCanvas) {
                resizeDrawCanvas();
            }
        }, 150);
    });
});

function showDrawError(message) {
    const errorDiv = document.getElementById("draw-global-error");
    if (!errorDiv) return;
    errorDiv.textContent = message;
    errorDiv.classList.remove("hidden");
    errorDiv.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideDrawError() {
    const errorDiv = document.getElementById("draw-global-error");
    if (!errorDiv) return;
    errorDiv.classList.add("hidden");
}

async function handleDrawRoomExit(message) {
    clearDrawLocalState();
    await openAppAlert(message, {
        title: "تمت إزالتك",
        confirmLabel: "الخروج",
        danger: true,
    });
    window.location.reload();
}

function ensureCurrentDrawPlayerStillInRoom(data) {
    if ((data.players || []).some((player) => player.id === currentDrawPlayerId)) {
        return true;
    }

    handleDrawRoomExit("تمت إزالتك من الغرفة.");
    return false;
}

function buildDrawRemoveActionCell(playerId, showActions = true) {
    if (showActions && drawIsHost && playerId !== currentDrawPlayerId) {
        return `<td><button class="btn btn-danger" onclick="removeDrawPlayer('${playerId}')">حذف</button></td>`;
    }
    return "<td></td>";
}

function buildDrawLobbyActionCell(player) {
    const actions = [];
    if (drawIsHost && player.id !== currentDrawPlayerId) {
        actions.push(`<button class="btn btn-danger" onclick="removeDrawPlayer('${player.id}')">حذف</button>`);
    }
    if (window.appCurrentUser && typeof canSendFriendRequestToUsername === "function" && canSendFriendRequestToUsername(player.username)) {
        const encodedUsername = encodeURIComponent(player.username);
        actions.push(`<button class="btn" onclick="sendDrawFriendRequest('${encodedUsername}', this)">Add Friend</button>`);
    }
    if (!actions.length) return "<td></td>";
    return `<td>${actions.join(" ")}</td>`;
}

async function sendDrawFriendRequest(encodedUsername, buttonEl) {
    const username = decodeURIComponent(encodedUsername || "");
    if (!username || typeof sendFriendRequestByUsername !== "function") return;
    if (buttonEl) buttonEl.disabled = true;
    try {
        const success = await sendFriendRequestByUsername(username);
        if (success && buttonEl) {
            buttonEl.textContent = "Requested";
            buttonEl.classList.add("disabled");
        } else if (buttonEl) {
            buttonEl.disabled = false;
        }
    } catch (error) {
        if (buttonEl) buttonEl.disabled = false;
        console.error("Failed to send friend request:", error);
    }
}

async function primeDrawFriendCache() {
    if (drawFriendCachePrimed || !window.appCurrentUser || typeof ensureAppFriendCache !== "function") return;
    await ensureAppFriendCache();
    drawFriendCachePrimed = true;
    if (currentDrawRoomData && (!currentDrawRoomData.started || currentDrawRoomData.phase === "waiting")) {
        renderDrawWaitingRoom(currentDrawRoomData);
    }
}

function renderDrawLobbyCharacterPicker(data) {
    const grid = document.getElementById("drawWaitCharacterGrid");
    const preview = document.getElementById("drawWaitCharacterPreview");
    if (!grid || !preview) return;

    const me = (data.players || []).find((player) => player.id === currentDrawPlayerId);
    const activeCharacterId = me?.character_id || selectedDrawCharacter || "char1";
    selectedDrawCharacter = activeCharacterId;
    localStorage.setItem("draw_character_id", selectedDrawCharacter);

    preview.src = `/static/images/${activeCharacterId}.png`;
    grid.innerHTML = "";

    drawCharacterOptions.forEach((characterId) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "character-btn";
        button.dataset.characterId = characterId;
        button.classList.toggle("active", characterId === activeCharacterId);
        button.onclick = () => updateDrawLobbyCharacter(characterId);
        button.innerHTML = `<img src="/static/images/${characterId}.png" class="character-btn-img" alt="${characterId}">`;
        grid.appendChild(button);
    });
}

async function updateDrawLobbyCharacter(characterId) {
    if (!currentDrawRoomCode || !currentDrawPlayerId) return;
    try {
        await sendDrawWSAction("update_character", { character_id: characterId });
        selectedDrawCharacter = characterId;
        localStorage.setItem("draw_character_id", selectedDrawCharacter);
    } catch (error) {
        showDrawError(error.message || "Unable to update character.");
    }
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function buildDrawPlayerIdentity(player) {
    return `
        <div class="draw-player-identity">
            <img src="/static/images/${player.character_id || "char1"}.png" class="draw-player-avatar" alt="${escapeHtml(player.name)}">
            <div class="draw-player-text">
                <span class="draw-player-name">${escapeHtml(player.name)}</span>
            </div>
        </div>
    `;
}

function setupDrawCanvas() {
    const canvasContainer = document.querySelector(".draw-canvas-wrapper");
    if (!canvasContainer) return;

    const oldCanvas = document.getElementById("drawCanvas");
    const newCanvas = document.createElement("canvas");
    newCanvas.id = "drawCanvas";

    if (oldCanvas) {
        canvasContainer.replaceChild(newCanvas, oldCanvas);
    } else {
        canvasContainer.appendChild(newCanvas);
    }

    drawCanvas = newCanvas;
    drawCtx = drawCanvas.getContext("2d");

    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";

    resizeDrawCanvas();

    drawCanvas.addEventListener("mousedown", handleDrawMouseDown);
    drawCanvas.addEventListener("mousemove", handleDrawMouseMove);
    drawCanvas.addEventListener("touchstart", handleDrawTouchStart, { passive: false });
    drawCanvas.addEventListener("touchmove", handleDrawTouchMove, { passive: false });
    drawCanvas.addEventListener("touchend", handleDrawTouchEnd, { passive: false });

    window.addEventListener("mouseup", handleDrawMouseUp);
}

function resizeDrawCanvas() {
    if (!drawCanvas || !drawCtx) return;

    const wrapper = drawCanvas.parentElement;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;

    drawCanvas.width = Math.floor(rect.width * dpr);
    drawCanvas.height = Math.floor(rect.height * dpr);

    drawCanvas.style.width = `${rect.width}px`;
    drawCanvas.style.height = `${rect.height}px`;

    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.scale(dpr, dpr);
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";

    drawCtx.fillStyle = "#ffffff";
    drawCtx.fillRect(0, 0, rect.width, rect.height);

    for (const stroke of drawStrokeHistory) {
        drawStroke(stroke, false);
    }
}

function getDrawCoordinates(event) {
    if (!drawCanvas) return { x: 0, y: 0 };

    const rect = drawCanvas.getBoundingClientRect();

    let clientX = event.clientX || 0;
    let clientY = event.clientY || 0;

    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    }

    return {
        x: clientX - rect.left,
        y: clientY - rect.top,
    };
}

function handleDrawMouseDown(event) {
    if (!canCurrentPlayerDraw()) return;

    drawIsDrawing = true;
    const { x, y } = getDrawCoordinates(event);
    drawLastX = x;
    drawLastY = y;
}

function handleDrawMouseMove(event) {
    if (!drawIsDrawing || !canCurrentPlayerDraw()) return;

    const { x, y } = getDrawCoordinates(event);
    const distance = Math.sqrt((x - drawLastX) ** 2 + (y - drawLastY) ** 2);

    if (distance > 0.5) {
        const stroke = buildStrokePayload(drawLastX, drawLastY, x, y);

        const sent = sendDrawWSMessage(stroke);
        if (sent) {
            drawStroke(stroke, true);
            drawLastX = x;
            drawLastY = y;
        }
    }
}

function handleDrawMouseUp() {
    drawIsDrawing = false;
}

function handleDrawTouchStart(event) {
    if (!canCurrentPlayerDraw()) return;
    event.preventDefault();

    drawIsDrawing = true;
    const { x, y } = getDrawCoordinates(event);
    drawLastX = x;
    drawLastY = y;
}

function handleDrawTouchMove(event) {
    if (!drawIsDrawing || !canCurrentPlayerDraw()) return;
    event.preventDefault();

    const { x, y } = getDrawCoordinates(event);
    const distance = Math.sqrt((x - drawLastX) ** 2 + (y - drawLastY) ** 2);

    if (distance > 0.5) {
        const stroke = buildStrokePayload(drawLastX, drawLastY, x, y);

        const sent = sendDrawWSMessage(stroke);
        if (sent) {
            drawStroke(stroke, true);
            drawLastX = x;
            drawLastY = y;
        }
    }
}

function handleDrawTouchEnd(event) {
    event.preventDefault();
    drawIsDrawing = false;
}

function buildStrokePayload(x0, y0, x1, y1) {
    const color = document.getElementById("drawColorPicker")?.value || "#000000";
    const width = Number(document.getElementById("drawBrushSize")?.value || 4);

    return {
        type: "draw",
        player_id: currentDrawPlayerId,
        x0,
        y0,
        x1,
        y1,
        color,
        width,
    };
}

function drawStroke(stroke, saveToHistory = true) {
    if (!drawCtx) return;

    drawCtx.beginPath();
    drawCtx.moveTo(stroke.x0, stroke.y0);
    drawCtx.lineTo(stroke.x1, stroke.y1);
    drawCtx.strokeStyle = stroke.color;
    drawCtx.lineWidth = stroke.width;
    drawCtx.stroke();

    if (saveToHistory) {
        drawStrokeHistory.push(stroke);
    }
}

function clearCanvasLocally() {
    if (!drawCtx || !drawCanvas) return;

    const rect = drawCanvas.getBoundingClientRect();
    drawStrokeHistory = [];

    drawCtx.clearRect(0, 0, rect.width, rect.height);
    drawCtx.fillStyle = "#ffffff";
    drawCtx.fillRect(0, 0, rect.width, rect.height);
}

function clearDrawCanvas() {
    if (!canCurrentPlayerDraw()) return;

    clearCanvasLocally();
    sendDrawWSMessage({
        type: "clear",
        player_id: currentDrawPlayerId,
    });
}

function canCurrentPlayerDraw() {
    return (
        currentDrawRoomData &&
        currentDrawRoomData.phase === "drawing" &&
        currentDrawRoomData.current_drawer_id === currentDrawPlayerId
    );
}

function legacyConnectDrawWS(roomCode) {
    if (drawWS) {
        drawWS.close();
        drawWS = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/api/draw-guess/ws/${roomCode}`;

    try {
        drawWS = new WebSocket(wsUrl);
    } catch (error) {
        console.error("Failed to create WebSocket:", error);
        showDrawError("خطأ في الاتصال. حاول مرة أخرى.");
        return;
    }

    drawWS.onopen = () => {
        console.log("Draw WebSocket connected");
        sendDrawWSMessage({
            type: "sync_request",
            player_id: currentDrawPlayerId,
            action_id: nextDrawActionId(),
        });
    };

    drawWS.onerror = (error) => {
        console.error("WebSocket error:", error);
    };

    drawWS.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "state_sync" && data.state) {
                applyDrawStateSync(data.state);
                return;
            }

            if (data.type === "action_ack" && data.action_id) {
                const pending = pendingDrawActions.get(data.action_id);
                if (pending) {
                    pendingDrawActions.delete(data.action_id);
                    pending.resolve();
                }
                return;
            }

            if (data.type === "action_error") {
                if (data.action_id) {
                    const pending = pendingDrawActions.get(data.action_id);
                    if (pending) {
                        pendingDrawActions.delete(data.action_id);
                        pending.reject(new Error(data.detail || "Action failed."));
                    }
                }
                if (data.detail) {
                    showDrawError(data.detail);
                }
                return;
            }

            if (data.type === "draw" && data.stroke) {
                if (data.stroke.player_id !== currentDrawPlayerId) {
                    const stroke = {
                        x0: parseFloat(data.stroke.x0) || 0,
                        y0: parseFloat(data.stroke.y0) || 0,
                        x1: parseFloat(data.stroke.x1) || 0,
                        y1: parseFloat(data.stroke.y1) || 0,
                        color: data.stroke.color || "#000000",
                        width: parseFloat(data.stroke.width) || 2,
                    };
                    drawStroke(stroke, true);
                }
            }

            if (data.type === "guess") {
                renderDrawGuessMessage(data);
            }

            if (data.type === "guess_hint_private") {
                renderDrawPrivateHintMessage(data.text || "تخمينك قريب من الكلمة!");
            }

            if (data.type === "clear") {
                clearCanvasLocally();
            }

            if (data.type === "player_left") {
                refreshDrawRoomState();
            }
        } catch (error) {
            console.error("Error processing WebSocket message:", error);
        }
    };

    drawWS.onclose = () => {
        console.log("WebSocket closed");
    };

    window.addEventListener("beforeunload", () => {
        if (drawWS && drawWS.readyState === WebSocket.OPEN) {
            try {
                drawWS.send(JSON.stringify({
                    type: "leave",
                    player_id: currentDrawPlayerId,
                }));
            } catch (error) {
                console.error("Error sending leave message:", error);
            }
        }
    });
}

function clearDrawWSReconnectTimer() {
    if (drawWSReconnectTimer) {
        clearTimeout(drawWSReconnectTimer);
        drawWSReconnectTimer = null;
    }
}

function scheduleDrawWSReconnect(roomCode) {
    if (!drawWSShouldReconnect || !roomCode || !currentDrawPlayerId || drawWSReconnectTimer) {
        return;
    }

    drawWSReconnectTimer = setTimeout(() => {
        drawWSReconnectTimer = null;

        if (!drawWSShouldReconnect || currentDrawRoomCode !== roomCode || !currentDrawPlayerId) {
            return;
        }

        console.log("Reconnecting draw WebSocket", { roomCode, playerId: currentDrawPlayerId });
        connectDrawWS(roomCode);
    }, 1500);
}

function closeDrawWS({ shouldReconnect = false } = {}) {
    drawWSShouldReconnect = shouldReconnect;
    clearDrawWSReconnectTimer();

    if (!drawWS) {
        drawWSRoomCode = null;
        return;
    }

    const socket = drawWS;
    drawWS = null;
    drawWSRoomCode = null;

    socket.onopen = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.onclose = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        try {
            socket.close();
        } catch (error) {
            console.error("Error closing draw WebSocket:", error);
        }
    }
}

function handleDrawWindowUnload() {
    closeDrawWS({ shouldReconnect: false });
}

function connectDrawWS(roomCode) {
    if (!roomCode || !currentDrawPlayerId) {
        return;
    }

    if (
        drawWS &&
        drawWSRoomCode === roomCode &&
        (drawWS.readyState === WebSocket.OPEN || drawWS.readyState === WebSocket.CONNECTING)
    ) {
        return;
    }

    closeDrawWS({ shouldReconnect: false });
    drawWSShouldReconnect = true;
    clearDrawWSReconnectTimer();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/api/draw-guess/ws/${roomCode}?player_id=${encodeURIComponent(currentDrawPlayerId)}`;

    let socket;

    try {
        socket = new WebSocket(wsUrl);
    } catch (error) {
        console.error("Failed to create WebSocket:", error);
        showDrawError("حدث خطأ في الاتصال. حاول مرة أخرى.");
        scheduleDrawWSReconnect(roomCode);
        return;
    }

    drawWS = socket;
    drawWSRoomCode = roomCode;

    socket.onopen = () => {
        if (drawWS !== socket) {
            return;
        }

        clearDrawWSReconnectTimer();
        console.log("Draw WebSocket connected", { roomCode, playerId: currentDrawPlayerId });
        sendDrawWSMessage({
            type: "sync_request",
            player_id: currentDrawPlayerId,
            action_id: nextDrawActionId(),
        });
    };

    socket.onerror = (error) => {
        if (drawWS !== socket) {
            return;
        }

        console.error("Draw WebSocket error:", { roomCode, playerId: currentDrawPlayerId, error });
    };

    socket.onmessage = (event) => {
        if (drawWS !== socket) {
            return;
        }

        try {
            const data = JSON.parse(event.data);

            if (data.type === "state_sync" && data.state) {
                applyDrawStateSync(data.state);
                return;
            }

            if (data.type === "action_ack" && data.action_id) {
                const pending = pendingDrawActions.get(data.action_id);
                if (pending) {
                    pendingDrawActions.delete(data.action_id);
                    pending.resolve();
                }
                return;
            }

            if (data.type === "action_error") {
                if (data.action_id) {
                    const pending = pendingDrawActions.get(data.action_id);
                    if (pending) {
                        pendingDrawActions.delete(data.action_id);
                        pending.reject(new Error(data.detail || "Action failed."));
                    }
                }
                if (data.detail) {
                    showDrawError(data.detail);
                }
                return;
            }

            if (data.type === "draw" && data.stroke) {
                if (data.stroke.player_id !== currentDrawPlayerId) {
                    const stroke = {
                        x0: parseFloat(data.stroke.x0) || 0,
                        y0: parseFloat(data.stroke.y0) || 0,
                        x1: parseFloat(data.stroke.x1) || 0,
                        y1: parseFloat(data.stroke.y1) || 0,
                        color: data.stroke.color || "#000000",
                        width: parseFloat(data.stroke.width) || 2,
                    };
                    drawStroke(stroke, true);
                }
            }

            if (data.type === "guess") {
                renderDrawGuessMessage(data);
            }

            if (data.type === "guess_hint_private") {
                renderDrawPrivateHintMessage(data.text || "تخمينك قريب من الكلمة!");
            }

            if (data.type === "clear") {
                clearCanvasLocally();
            }

            if (data.type === "player_left") {
                refreshDrawRoomState();
            }
        } catch (error) {
            console.error("Error processing WebSocket message:", error);
        }
    };

    socket.onclose = (event) => {
        if (drawWS === socket) {
            drawWS = null;
            drawWSRoomCode = null;
        }

        console.log("Draw WebSocket closed", {
            roomCode,
            playerId: currentDrawPlayerId,
            code: event.code,
            wasClean: event.wasClean,
        });

        if (drawWSShouldReconnect && currentDrawRoomCode === roomCode && currentDrawPlayerId) {
            scheduleDrawWSReconnect(roomCode);
        }
    };

    if (!drawWSBeforeUnloadBound) {
        window.addEventListener("beforeunload", handleDrawWindowUnload);
        window.addEventListener("pagehide", handleDrawWindowUnload);
        drawWSBeforeUnloadBound = true;
    }
}

function sendDrawWSMessage(payload) {
    if (!drawWS || drawWS.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not ready. readyState:", drawWS?.readyState);
        return false;
    }

    try {
        drawWS.send(JSON.stringify(payload));
        return true;
    } catch (error) {
        console.error("Error sending WebSocket message:", error);
        return false;
    }
}

function nextDrawActionId() {
    drawActionCounter += 1;
    return `draw-action-${Date.now()}-${drawActionCounter}`;
}

function sendDrawWSAction(actionType, payload = {}) {
    if (!drawWS || drawWS.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("Realtime connection is not ready."));
    }

    const actionId = nextDrawActionId();
    const message = {
        type: actionType,
        action_id: actionId,
        player_id: currentDrawPlayerId,
        ...payload,
    };

    const timeoutId = setTimeout(() => {
        const pending = pendingDrawActions.get(actionId);
        if (!pending) return;
        pendingDrawActions.delete(actionId);
        pending.reject(new Error("Action timed out."));
    }, 8000);

    return new Promise((resolve, reject) => {
        pendingDrawActions.set(actionId, {
            resolve: () => {
                clearTimeout(timeoutId);
                resolve();
            },
            reject: (error) => {
                clearTimeout(timeoutId);
                reject(error);
            },
        });

        const sent = sendDrawWSMessage(message);
        if (!sent) {
            const pending = pendingDrawActions.get(actionId);
            if (pending) {
                pendingDrawActions.delete(actionId);
                pending.reject(new Error("Realtime connection is not ready."));
            }
        }
    });
}

function applyDrawStateSync(state) {
    if (!state || typeof state !== "object") return;

    const incomingVersion = Number(state.room_version || 0);
    if (incomingVersion && incomingVersion < latestDrawRoomVersion) {
        return;
    }
    if (incomingVersion) {
        latestDrawRoomVersion = incomingVersion;
    }

    currentDrawRoomData = state;
    drawIsHost = currentDrawPlayerId === state.host_id;

    const signature = buildDrawStateSignature(state);
    if (signature === lastRenderedDrawSignature) {
        updateDrawLiveTimer(state);
        return;
    }

    lastRenderedDrawSignature = signature;
    renderDrawState(state);
}

async function loadDrawCategories() {
    const response = await fetch("/api/draw-guess/categories");
    const data = await response.json();
    allDrawCategories = data.categories || [];
}

function renderDrawPlayerCountButtons() {
    const container = document.getElementById("drawPlayerCountGrid");
    if (!container) return;

    container.innerHTML = "";

    drawPlayerCountOptions.forEach((count) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.playerCount = String(count);
        button.textContent = `${count} لاعبين`;
        button.onclick = () => {
            selectedDrawPlayerCount = count;
            if (selectedDrawRounds && selectedDrawRounds < count) {
                selectedDrawRounds = count;
            }
            updateDrawPlayerCountButtonsState();
            renderDrawRoundsButtons();
            updateDrawRoundsButtonsState();
        };
        container.appendChild(button);
    });

    updateDrawPlayerCountButtonsState();
}

function updateDrawPlayerCountButtonsState() {
    document.querySelectorAll("#drawPlayerCountGrid .category-btn").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.playerCount) === selectedDrawPlayerCount);
    });
}

function renderDrawRoundsButtons() {
    const container = document.getElementById("drawRoundsGrid");
    if (!container) return;

    container.innerHTML = "";

    let options = [];
    if (selectedDrawPlayerCount) {
        for (let i = selectedDrawPlayerCount; i <= 10; i += selectedDrawPlayerCount) {
            options.push(i);
        }
    } else {
        options = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    }

    options.forEach((rounds) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.rounds = String(rounds);
        button.textContent = `${rounds} جولات`;
        button.onclick = () => {
            selectedDrawRounds = rounds;
            updateDrawRoundsButtonsState();
        };
        container.appendChild(button);
    });

    if (selectedDrawRounds && !options.includes(selectedDrawRounds)) {
        selectedDrawRounds = options[0] || null;
    }

    updateDrawRoundsButtonsState();
}

function updateDrawRoundsButtonsState() {
    document.querySelectorAll("#drawRoundsGrid .category-btn").forEach((btn) => {
        const rounds = Number(btn.dataset.rounds);
        const disabled = selectedDrawPlayerCount && rounds < selectedDrawPlayerCount;

        btn.disabled = !!disabled;
        btn.classList.toggle("disabled", !!disabled);
        btn.classList.toggle("active", rounds === selectedDrawRounds);

        if (disabled && selectedDrawRounds === rounds) {
            selectedDrawRounds = null;
        }
    });
}

function renderDrawLanguageButtons() {
    const container = document.getElementById("drawLanguageGrid");
    if (!container) return;

    container.innerHTML = "";

    drawLanguageOptions.forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.languageValue = option.value;
        button.textContent = option.label;
        button.onclick = () => {
            selectedDrawLanguage = option.value;
            updateDrawLanguageButtonsState();
        };
        container.appendChild(button);
    });

    updateDrawLanguageButtonsState();
}

function updateDrawLanguageButtonsState() {
    document.querySelectorAll("#drawLanguageGrid .category-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.languageValue === selectedDrawLanguage);
    });
}

function renderDrawTimerButtons() {
    const container = document.getElementById("drawTimerGrid");
    if (!container) return;

    container.innerHTML = "";

    drawTimerOptions.forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.timerValue = String(option.value);
        button.textContent = option.label;
        button.onclick = () => {
            selectedDrawTimer = option.value;
            updateDrawTimerButtonsState();
        };
        container.appendChild(button);
    });

    updateDrawTimerButtonsState();
}

function updateDrawTimerButtonsState() {
    document.querySelectorAll("#drawTimerGrid .category-btn").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.timerValue) === selectedDrawTimer);
    });
}

function renderDrawCharacterButtons() {
    const container = document.getElementById("drawCharacterGrid");
    if (!container) return;

    container.innerHTML = "";

    drawCharacterOptions.forEach((characterId) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "character-btn";
        button.dataset.characterId = characterId;
        button.onclick = () => selectDrawCharacter(characterId);
        button.innerHTML = `<img src="/static/images/${characterId}.png" class="character-btn-img" alt="${characterId}">`;
        container.appendChild(button);
    });

    updateDrawCharacterButtonsState();
}

function selectDrawCharacter(characterId) {
    selectedDrawCharacter = characterId;
    localStorage.setItem("draw_character_id", selectedDrawCharacter);
    updateDrawCharacterButtonsState();
}

function updateDrawCharacterButtonsState() {
    document.querySelectorAll("#drawCharacterGrid .character-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.characterId === selectedDrawCharacter);
    });

    const preview = document.getElementById("drawCharacterPreview");
    if (preview) {
        preview.src = `/static/images/${selectedDrawCharacter}.png`;
    }
}

async function toggleDrawCategory(categoryKey) {
    if (!drawIsHost || currentDrawRoomData?.started) {
        return;
    }

    const exists = selectedDrawCategories.includes(categoryKey);
    let nextCategories;

    if (exists) {
        nextCategories = selectedDrawCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedDrawCategories.length >= MAX_DRAW_CATEGORIES) {
            showDrawError(`يمكنك اختيار ${MAX_DRAW_CATEGORIES} تصنيفات كحد أقصى`);
            return;
        }
        nextCategories = [...selectedDrawCategories, categoryKey];
    }

    try {
        await sendDrawWSAction("update_categories", { categories: nextCategories });
    } catch (error) {
        showDrawError(error.message || "تعذر تحديث التصنيفات.");
    }
}

function updateDrawCategoryButtonsState() {
    const info = document.getElementById("drawCategorySelectionInfo");
    const canEdit = drawIsHost && currentDrawRoomData && !currentDrawRoomData.started;

    if (info) {
        info.textContent = `تم اختيار ${selectedDrawCategories.length} / ${MAX_DRAW_CATEGORIES}`;
    }

    document.querySelectorAll("#drawCategoryGrid .category-btn").forEach((btn) => {
        const key = btn.dataset.categoryKey;
        const isSelected = selectedDrawCategories.includes(key);
        btn.classList.toggle("active", isSelected);

        if (!canEdit) {
            btn.classList.add("disabled");
            btn.disabled = true;
            return;
        }

        if (!isSelected && selectedDrawCategories.length >= MAX_DRAW_CATEGORIES) {
            btn.classList.add("disabled");
            btn.disabled = true;
        } else {
            btn.classList.remove("disabled");
            btn.disabled = false;
        }
    });
}

function renderDrawPregameCategories(data) {
    const container = document.getElementById("drawCategoryGrid");
    if (!container) return;

    container.innerHTML = "";

    allDrawCategories.forEach((key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.categoryKey = key;
        button.textContent = drawCategoryLabels[key] || key;
        button.onclick = () => toggleDrawCategory(key);
        container.appendChild(button);
    });

    const info = document.getElementById("drawCategorySelectionInfo");
    if (info && !drawIsHost) {
        info.textContent = data.categories?.length
            ? `المنظم يختار التصنيفات الآن: ${data.categories.length} / ${MAX_DRAW_CATEGORIES}`
            : "المنظم لم يختر أي تصنيف بعد";
    }

    updateDrawCategoryButtonsState();
}

function showDrawSetup() {
    const name = document.getElementById("drawName").value.trim();
    if (!name) {
        showDrawError("الرجاء إدخال اسمك أولاً!");
        return;
    }

    currentDrawPlayerName = name;
    localStorage.setItem("draw_player_name", currentDrawPlayerName);

    hideAllDrawScreens();
    document.getElementById("screen-draw-setup").classList.remove("hidden");
}

function goBackToDrawLobby() {
    hideAllDrawScreens();
    document.getElementById("screen-draw-lobby").classList.remove("hidden");
}

async function createDrawRoom() {
    const hostName = document.getElementById("drawName").value.trim();

    if (!hostName) {
        showDrawError("الرجاء إدخال الاسم أولاً!");
        return;
    }
    if (!selectedDrawPlayerCount) {
        showDrawError("اختر عدد اللاعبين أولاً!");
        return;
    }
    if (!selectedDrawRounds) {
        showDrawError("اختر عدد الجولات أولاً!");
        return;
    }
    if (selectedDrawRounds < selectedDrawPlayerCount) {
        showDrawError("عدد الجولات يجب أن يكون على الأقل بعدد اللاعبين.");
        return;
    }

    const response = await fetch("/api/draw-guess/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            host_name: hostName,
            character_id: selectedDrawCharacter,
            max_player_count: selectedDrawPlayerCount,
            total_rounds: selectedDrawRounds,
            categories: [],
            language: selectedDrawLanguage,
            round_timer_seconds: selectedDrawTimer,
        }),
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "حدث خطأ أثناء إنشاء الغرفة.");
        return;
    }

    currentDrawRoomCode = data.room_code;
    currentDrawPlayerId = data.host_id;
    currentDrawPlayerName = hostName;
    currentDrawRoomData = data;
    latestDrawRoomVersion = Number(data.room_version || 0);
    drawIsHost = true;
    selectedDrawCategories = [...(data.categories || [])];
    lastRenderedDrawSignature = null;

    localStorage.setItem("draw_room_code", currentDrawRoomCode);
    localStorage.setItem("draw_player_id", currentDrawPlayerId);
    localStorage.setItem("draw_player_name", currentDrawPlayerName);

    connectDrawWS(currentDrawRoomCode);
    renderDrawWaitingRoom(data);
}

async function joinDrawRoom() {
    const name = document.getElementById("drawName").value.trim();
    const roomCode = document.getElementById("drawRoomInput").value.trim().toUpperCase();

    if (!name || !roomCode) {
        showDrawError("اكمل البيانات!");
        return;
    }

    const response = await fetch(`/api/draw-guess/rooms/${roomCode}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_name: name,
            character_id: selectedDrawCharacter,
        }),
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر الانضمام إلى الغرفة.");
        return;
    }

    const joinedPlayer =
        data.players.find((player) => player.name === name && player.id !== data.host_id) ||
        data.players[data.players.length - 1];

    currentDrawRoomCode = roomCode;
    currentDrawPlayerId = joinedPlayer.id;
    currentDrawPlayerName = name;
    currentDrawRoomData = data;
    latestDrawRoomVersion = Number(data.room_version || 0);
    drawIsHost = currentDrawPlayerId === data.host_id;
    lastRenderedDrawSignature = null;

    localStorage.setItem("draw_room_code", currentDrawRoomCode);
    localStorage.setItem("draw_player_id", currentDrawPlayerId);
    localStorage.setItem("draw_player_name", currentDrawPlayerName);

    connectDrawWS(currentDrawRoomCode);
    renderDrawState(data);
}

async function startDrawGame() {
    if (!currentDrawRoomData?.categories?.length) {
        showDrawError("اختر تصنيفًا واحدًا على الأقل قبل بدء اللعبة.");
        return;
    }

    try {
        await sendDrawWSAction("start_game");
    } catch (error) {
        showDrawError(error.message || "تعذر بدء اللعبة.");
    }
}

async function selectDrawWord(chosenWordEn) {
    try {
        await sendDrawWSAction("select_word", { chosen_word_en: chosenWordEn });
        clearCanvasLocally();
    } catch (error) {
        showDrawError(error.message || "تعذر اختيار الكلمة.");
    }
}

function handleDrawGuessEnter(event) {
    if (event.key === "Enter") {
        sendDrawGuess();
    }
}

function sendDrawGuess() {
    const input = document.getElementById("drawGuessInput");
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    sendDrawWSMessage({
        type: "guess",
        player_id: currentDrawPlayerId,
        text,
    });

    input.value = "";
}

async function advanceDrawRound() {
    try {
        await sendDrawWSAction("advance_round");
        clearCanvasLocally();
    } catch (error) {
        showDrawError(error.message || "تعذر الانتقال للجولة التالية.");
    }
}

async function restartDrawGame() {
    const categories = selectedDrawCategories.length > 0
        ? selectedDrawCategories
        : currentDrawRoomData?.categories || [];

    const totalRounds = selectedDrawRounds || currentDrawRoomData?.total_rounds;
    const language = selectedDrawLanguage || currentDrawRoomData?.language || "en";
    const timer = selectedDrawTimer || currentDrawRoomData?.round_timer_seconds || 60;

    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            categories,
            total_rounds: totalRounds,
            language,
            round_timer_seconds: timer,
        }),
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر إعادة اللعبة.");
        return;
    }

    currentDrawRoomData = data;
    selectedDrawCategories = [...(data.categories || [])];
    lastRenderedDrawSignature = null;
    renderDrawWaitingRoom(data);
}

async function leaveDrawRoom() {
    const confirmed = confirm("هل أنت متأكد أنك تريد الخروج من الغرفة؟");
    if (!confirmed) return;

    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentDrawPlayerId }),
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر الخروج من الغرفة.");
        return;
    }

    clearDrawLocalState();
    window.location.reload();
}

async function deleteDrawRoom() {
    const confirmed = await openAppConfirm("هل أنت متأكد أنك تريد حذف الغرفة بالكامل؟", {
        title: "حذف الغرفة",
        confirmLabel: "حذف الغرفة",
        cancelLabel: "إلغاء",
        danger: true,
    });
    if (!confirmed) return;

    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentDrawPlayerId }),
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر حذف الغرفة.");
        return;
    }

    clearDrawLocalState();
    window.location.reload();
}

async function removeDrawPlayer(playerIdToRemove) {
    const confirmed = await openAppConfirm("هل أنت متأكد أنك تريد حذف هذا اللاعب من الغرفة؟", {
        title: "حذف لاعب",
        confirmLabel: "حذف اللاعب",
        cancelLabel: "إلغاء",
        danger: true,
    });
    if (!confirmed) return;

    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/remove-player`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            host_id: currentDrawPlayerId,
            player_id_to_remove: playerIdToRemove,
        }),
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر حذف اللاعب.");
        return;
    }

    hideDrawError();
    renderDrawState(data);
}

async function refreshDrawRoomState() {
    if (!currentDrawRoomCode) return;

    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}`);
    if (!response.ok) {
        if (response.status === 404) {
            await handleDrawRoomExit("تم حذف الغرفة أو لم تعد متاحة.");
        }
        return;
    }

    const data = await response.json();
    if (!ensureCurrentDrawPlayerStillInRoom(data)) return;

    if (!drawWS || (drawWS.readyState !== WebSocket.OPEN && drawWS.readyState !== WebSocket.CONNECTING)) {
        connectDrawWS(currentDrawRoomCode);
    }
    applyDrawStateSync(data);
}

function buildDrawStateSignature(data) {
    const playersSignature = data.players
        .map((p) => `${p.id}:${p.score}:${p.character_id || ""}`)
        .join("|");

    return JSON.stringify({
        started: data.started,
        ended: data.ended,
        phase: data.phase,
        current_round: data.current_round,
        current_drawer_id: data.current_drawer_id,
        phase_deadline_at: data.phase_deadline_at,
        guessed_correctly_player_ids: data.guessed_correctly_player_ids,
        last_round_word_en: data.last_round_word_en,
        last_round_word_ar: data.last_round_word_ar,
        last_round_score_changes: data.last_round_score_changes,
        categories: (data.categories || []).join(","),
        players: playersSignature,
    });
}

function renderDrawState(data) {
    const previousDrawRoomData = currentDrawRoomData;
    currentDrawRoomData = data;

    if (data.ended || data.phase === "game_over") {
        lastDrawCanvasSessionKey = null;
        renderDrawGameOver(data);
        updateDrawRoomActionButtons();
        return;
    }

    if (!data.started || data.phase === "waiting") {
        lastDrawCanvasSessionKey = null;
        renderDrawWaitingRoom(data);
        updateDrawRoomActionButtons();
        return;
    }

    if (data.phase === "word_choice") {
        lastDrawCanvasSessionKey = null;
        renderDrawWordChoice(data);
        updateDrawRoomActionButtons();
        return;
    }

    if (data.phase === "drawing") {
        renderDrawPlay(data, previousDrawRoomData);
        updateDrawRoomActionButtons();
        return;
    }

    if (data.phase === "round_result") {
        lastDrawCanvasSessionKey = null;
        renderDrawRoundResult(data);
        updateDrawRoomActionButtons();
    }
}

function updateDrawRoomActionButtons() {
    document.querySelectorAll(".draw-room-leave").forEach((button) => {
        button.classList.toggle("hidden", drawIsHost);
    });

    document.querySelectorAll(".draw-room-delete").forEach((button) => {
        button.classList.toggle("hidden", !drawIsHost);
    });
}

function renderDrawWaitingRoom(data) {
    hideAllDrawScreens();
    document.getElementById("screen-draw-wait").classList.remove("hidden");
    currentDrawRoomData = data;
    selectedDrawCategories = [...(data.categories || [])];
    document.getElementById("drawDisplayCode").textContent = data.room_code;
    renderDrawLobbyCharacterPicker(data);

    const tbody = document.getElementById("drawPlayerList");
    tbody.innerHTML = "";

    [...data.players]
        .sort((a, b) => b.score - a.score)
        .forEach((player) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${buildDrawPlayerIdentity(player)}</td>
                <td>${player.score}</td>
                ${buildDrawLobbyActionCell(player)}
            `;
            tbody.appendChild(row);
        });

    renderDrawPregameCategories(data);

    if (drawIsHost) {
        document.getElementById("drawHostArea").classList.remove("hidden");
        document.getElementById("drawMemberArea").classList.add("hidden");
        document.getElementById("drawWaitMsg").classList.add("hidden");
    } else {
        document.getElementById("drawHostArea").classList.add("hidden");
        document.getElementById("drawMemberArea").classList.remove("hidden");
        document.getElementById("drawWaitMsg").classList.remove("hidden");
    }
}

function renderDrawWordChoice(data) {
    hideAllDrawScreens();
    document.getElementById("screen-draw-word-choice").classList.remove("hidden");

    document.getElementById("drawRoundInfoChoice").textContent =
        `الجولة ${data.current_round} / ${data.total_rounds}`;

    const drawer = data.players.find((p) => p.id === data.current_drawer_id);
    const isDrawer = data.current_drawer_id === currentDrawPlayerId;

    document.getElementById("drawDrawerInfoChoice").textContent = isDrawer
        ? "اختر الكلمة التي تريد رسمها"
        : `${drawer ? drawer.name : "اللاعب"} يختار الكلمة الآن`;

    const box = document.getElementById("drawWordChoiceBox");
    box.innerHTML = "";

    if (isDrawer) {
        (data.current_word_choices || []).forEach((option) => {
            const label = data.language === "ar" ? option.word_ar : option.word_en;

            const button = document.createElement("button");
            button.className = "btn draw-word-choice-btn";
            button.textContent = `${label} (${option.difficulty})`;
            button.onclick = () => selectDrawWord(option.word_en);
            box.appendChild(button);
        });
    } else {
        box.innerHTML = `<p style="color:#aaa; text-align:center;">بانتظار اختيار الكلمة...</p>`;
    }

    renderDrawScoreboard(data.players, "drawScoreboardChoice", true);
}

function renderDrawPlay(data, previousData) {
    hideAllDrawScreens();
    document.getElementById("screen-draw-play").classList.remove("hidden");

    document.getElementById("drawRoundInfoPlay").textContent =
        `الجولة ${data.current_round} / ${data.total_rounds}`;

    renderDrawTimer("drawTimerPlay", data.phase_deadline_at);

    const drawSessionKey = `${data.current_round}:${data.current_drawer_id || ""}`;
    const shouldResetCanvas = !drawCanvas || lastDrawCanvasSessionKey !== drawSessionKey;

    if (shouldResetCanvas) {
        drawStrokeHistory = [];
        setupDrawCanvas();
        (data.strokes || []).forEach((stroke) => drawStroke(stroke, true));
        lastDrawCanvasSessionKey = drawSessionKey;
    }

    const drawer = data.players.find((p) => p.id === data.current_drawer_id);
    const isDrawer = data.current_drawer_id === currentDrawPlayerId;

    document.getElementById("drawTopStatus").textContent = isDrawer
        ? "أنت الرسّام في هذه الجولة"
        : `${drawer ? drawer.name : "اللاعب"} يرسم الآن`;

    const hintEl = document.getElementById("drawWordHint");
    if (isDrawer) {
        const word = data.language === "ar"
            ? getSelectedDisplayedWord(data, "ar")
            : getSelectedDisplayedWord(data, "en");
        hintEl.textContent = word || "اخترت كلمة";
    } else {
        hintEl.textContent = buildHiddenWordHint(data);
    }

    document.getElementById("drawToolsBar").classList.toggle("hidden", !isDrawer);
    document.getElementById("drawGuessInputArea").classList.toggle("hidden", isDrawer);

    renderDrawPlayersState(data);

    const feed = document.getElementById("drawGuessFeed");
    feed.innerHTML = "";
    (data.guesses || []).forEach((guess) => {
        renderDrawGuessMessage(guess, true);
    });
}

function renderDrawPlayersState(data) {
    const tbody = document.getElementById("drawPlayersState");
    tbody.innerHTML = "";

    const guessedSet = new Set(data.guessed_correctly_player_ids || []);

    data.players.forEach((player) => {
        const isDrawer = player.id === data.current_drawer_id;
        const guessedCorrectly = guessedSet.has(player.id);

        let statusText = "بانتظار التخمين";
        let rowClass = "";

        if (isDrawer) {
            statusText = "يرسم الآن";
            rowClass = "draw-player-current-row";
        } else if (guessedCorrectly) {
            statusText = "خمن بشكل صحيح";
            rowClass = "draw-player-done-row";
        }

        const row = document.createElement("tr");
        row.className = rowClass;
        row.innerHTML = `
            <td>${buildDrawPlayerIdentity(player)}</td>
            <td>${statusText}</td>
            <td>${player.score}</td>
            ${buildDrawRemoveActionCell(player.id)}
        `;
        tbody.appendChild(row);
    });
}

function renderDrawGuessMessage(data, isInitial = false) {
    const container = document.getElementById("drawGuessFeed");
    if (!container) return;

    const div = document.createElement("div");
    div.className = "draw-guess-message";

    if (data.is_correct) {
        div.classList.add("correct");
        div.textContent = `${data.player_name} guessed correctly!`;
    } else {
        div.textContent = `${data.player_name}: ${data.text}`;
    }

    container.appendChild(div);

    if (!isInitial) {
        container.scrollTop = container.scrollHeight;
    }
}

function renderDrawRoundResult(data) {
    hideAllDrawScreens();
    document.getElementById("screen-draw-result").classList.remove("hidden");

    const revealedWord = data.language === "ar"
        ? (data.last_round_word_ar || data.last_round_word_en || "-")
        : (data.last_round_word_en || data.last_round_word_ar || "-");

    document.getElementById("drawRoundWordReveal").textContent = `الكلمة كانت: ${revealedWord}`;

    renderDrawRankingResultTable(data);

    const advanceArea = document.getElementById("drawAdvanceArea");
    advanceArea.innerHTML = "";

    if (drawIsHost) {
        const nextButton = document.createElement("button");
        nextButton.className = "btn btn-primary";
        nextButton.textContent = data.current_round >= data.total_rounds ? "إنهاء اللعبة" : "الجولة التالية";
        nextButton.onclick = advanceDrawRound;
        advanceArea.appendChild(nextButton);
    } else {
        const waitText = document.createElement("p");
        waitText.textContent = "بانتظار صاحب الغرفة للانتقال...";
        advanceArea.appendChild(waitText);
    }
}

function renderDrawRankingResultTable(data) {
    const tbody = document.getElementById("drawRankingTableBody");
    tbody.innerHTML = "";

    const changes = data.last_round_score_changes || {};
    const sortedPlayers = [...data.players].sort((a, b) => b.score - a.score);

    sortedPlayers.forEach((player, index) => {
        const delta = changes[player.id] || 0;
        const row = document.createElement("tr");

        if (index === 0) row.classList.add("rank-gold");
        if (index === 1) row.classList.add("rank-silver");
        if (index === 2) row.classList.add("rank-bronze");

        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${buildDrawPlayerIdentity(player)}</td>
            <td>${player.score}</td>
            <td>${delta > 0 ? `+${delta}` : "-"}</td>
            ${buildDrawRemoveActionCell(player.id)}
        `;
        tbody.appendChild(row);
    });
}

function renderDrawGameOver(data) {
    hideAllDrawScreens();
    document.getElementById("screen-draw-game-over").classList.remove("hidden");

    if (data.end_reason === "insufficient_players") {
        document.getElementById("drawFinalMsg").textContent =
            "انتهت اللعبة! عدد اللاعبين غير كافي للمتابعة.";

        const tbody = document.getElementById("drawFinalScoreboard");
        tbody.innerHTML = "";

        [...data.players]
            .sort((a, b) => b.score - a.score)
            .forEach((player, index) => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${buildDrawPlayerIdentity(player)}</td>
                    <td>${player.score}</td>
                    ${buildDrawRemoveActionCell(player.id)}
                `;
                tbody.appendChild(row);
            });

        if (drawIsHost) {
            document.getElementById("drawGameOverAdminArea").classList.remove("hidden");
            document.getElementById("drawGameOverMemberArea").classList.add("hidden");
        } else {
            document.getElementById("drawGameOverAdminArea").classList.add("hidden");
            document.getElementById("drawGameOverMemberArea").classList.remove("hidden");
        }
        return;
    }

    const winners = data.players.filter((player) => data.winner_ids.includes(player.id));
    const winnerNames = winners.map((player) => player.name).join(" / ");

    document.getElementById("drawFinalMsg").textContent =
        winners.length > 1
            ? `انتهت اللعبة! تعادل بين: ${winnerNames}`
            : `الفائز هو: ${winnerNames}`;

    const tbody = document.getElementById("drawFinalScoreboard");
    tbody.innerHTML = "";

    [...data.players]
        .sort((a, b) => b.score - a.score)
        .forEach((player, index) => {
            const row = document.createElement("tr");

            if (index === 0) row.classList.add("rank-gold");
            if (index === 1) row.classList.add("rank-silver");
            if (index === 2) row.classList.add("rank-bronze");

            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${buildDrawPlayerIdentity(player)}</td>
                <td>${player.score}</td>
                ${buildDrawRemoveActionCell(player.id)}
            `;
            tbody.appendChild(row);
        });

    if (drawIsHost) {
        document.getElementById("drawGameOverAdminArea").classList.remove("hidden");
        document.getElementById("drawGameOverMemberArea").classList.add("hidden");
    } else {
        document.getElementById("drawGameOverAdminArea").classList.add("hidden");
        document.getElementById("drawGameOverMemberArea").classList.remove("hidden");
    }
}

function renderDrawScoreboard(players, containerId, showActions = false) {
    const tbody = document.getElementById(containerId);
    if (!tbody) return;

    tbody.innerHTML = "";

    [...players]
        .sort((a, b) => b.score - a.score)
        .forEach((player) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${buildDrawPlayerIdentity(player)}</td>
                <td>${player.score}</td>
                ${buildDrawRemoveActionCell(player.id, showActions)}
            `;
            tbody.appendChild(row);
        });
}

function getSelectedDisplayedWord(data, language) {
    if (language === "ar") return data.current_word_ar || null;
    return data.current_word_en || null;
}

function renderDrawPrivateHintMessage(text) {
    const container = document.getElementById("drawGuessFeed");
    if (!container) return;

    const div = document.createElement("div");
    div.className = "draw-guess-message";
    div.classList.add("close");
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function hashStringFNV1a(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function createSeededRng(seed) {
    let state = seed >>> 0;
    return function next() {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function buildDeterministicRevealOrder(indexes, seedText) {
    const order = [...indexes];
    const rng = createSeededRng(hashStringFNV1a(seedText || "draw-guess-hint"));

    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }

    return order;
}

function buildHiddenWordHint(data) {
    const targetWord = data.language === "ar"
        ? (data.current_word_ar || "")
        : (data.current_word_en || "");

    // Fallback to first choice length if the selected word is not yet available.
    const fallbackWord = (() => {
        const choices = data.current_word_choices || [];
        if (!choices.length) return "";
        return data.language === "ar" ? (choices[0].word_ar || "") : (choices[0].word_en || "");
    })();

    const word = (targetWord || fallbackWord || "").trim();
    if (!word) return "؟ ؟ ؟";

    const totalSeconds = Number(data.round_timer_seconds) || 0;
    const deadlineAt = Number(data.phase_deadline_at) || 0;
    const secondsLeft = deadlineAt ? Math.max(0, deadlineAt - (Date.now() / 1000)) : 0;
    const elapsedSeconds = totalSeconds > 0 ? Math.max(0, totalSeconds - secondsLeft) : 0;

    // Reveal letters progressively as time passes, while keeping at least one hidden.
    const chars = word.split("");
    const maskableIndexes = chars
        .map((char, index) => ({ char, index }))
        .filter(({ char }) => char.trim().length > 0)
        .map(({ index }) => index);

    if (!maskableIndexes.length) return "؟ ؟ ؟";

    const maxRevealCount = Math.max(0, maskableIndexes.length - 1);
    const revealProgress = totalSeconds > 0 ? Math.min(1, elapsedSeconds / totalSeconds) : 0;
    const revealCount = Math.min(maxRevealCount, Math.floor(maskableIndexes.length * revealProgress));

    const revealSeed = `${data.room_code || ""}:${data.current_round || 0}:${data.current_drawer_id || ""}:${word}`;
    const randomizedOrder = buildDeterministicRevealOrder(maskableIndexes, revealSeed);
    const revealedSet = new Set(randomizedOrder.slice(0, revealCount));

    return chars
        .map((char, index) => {
            if (char.trim().length === 0) return " ";
            if (revealedSet.has(index)) return char;
            return "_";
        })
        .join(" ");
}

function renderDrawTimer(elementId, deadlineAt) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (!deadlineAt) {
        el.textContent = "";
        return;
    }

    const now = Date.now() / 1000;
    const secondsLeft = Math.max(0, Math.ceil(deadlineAt - now));
    el.textContent = `${secondsLeft} ثانية`;
}

function updateDrawLiveTimer(data) {
    if (!data) return;
    if (data.phase === "drawing") {
        renderDrawTimer("drawTimerPlay", data.phase_deadline_at);

        const isDrawer = data.current_drawer_id === currentDrawPlayerId;
        if (!isDrawer) {
            const hintEl = document.getElementById("drawWordHint");
            if (hintEl) {
                hintEl.textContent = buildHiddenWordHint(data);
            }
        }
    }
}

function hideAllDrawScreens() {
    const screens = [
        "screen-draw-lobby",
        "screen-draw-setup",
        "screen-draw-wait",
        "screen-draw-word-choice",
        "screen-draw-play",
        "screen-draw-result",
        "screen-draw-game-over",
    ];

    screens.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });
}

function clearDrawLocalState() {
    localStorage.removeItem("draw_room_code");
    localStorage.removeItem("draw_player_id");
    localStorage.removeItem("draw_player_name");
    localStorage.removeItem("draw_character_id");

    currentDrawRoomCode = null;
    currentDrawPlayerId = null;
    currentDrawPlayerName = null;
    currentDrawRoomData = null;
    drawIsHost = false;
    lastRenderedDrawSignature = null;
    selectedDrawPlayerCount = null;
    selectedDrawRounds = null;
    selectedDrawCategories = [];
    selectedDrawLanguage = "en";
    selectedDrawTimer = 60;
    selectedDrawCharacter = "char1";
    drawStrokeHistory = [];
    latestDrawRoomVersion = 0;
    drawActionCounter = 0;
    pendingDrawActions.forEach((pending) => pending.reject(new Error("Room state reset.")));
    pendingDrawActions.clear();

    closeDrawWS({ shouldReconnect: false });
}

function resetDrawAndExit() {
    clearDrawLocalState();
    window.location.reload();
}

setInterval(async () => {
    if (currentDrawRoomCode && currentDrawPlayerId) {
        await refreshDrawRoomState();
    }
}, 3000);

setInterval(async () => {
    if (currentDrawRoomCode && currentDrawPlayerId) {
        try {
            await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/heartbeat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ player_id: currentDrawPlayerId }),
            });
        } catch (e) {
            // Ignore errors
        }
    }
}, 10000);

setInterval(() => {
    if (currentDrawRoomData) {
        updateDrawLiveTimer(currentDrawRoomData);
    }
}, 1000);

function ensureDrawInviteButton() {
    if (!window.appCurrentUser || !drawIsHost || !currentDrawRoomCode) return;

    const hostArea = document.getElementById("drawHostArea");
    if (!hostArea || hostArea.querySelector(".invite-friends-btn")) return;

    const inviteButton = document.createElement("button");
    inviteButton.type = "button";
    inviteButton.className = "btn invite-friends-btn";
    inviteButton.textContent = "دعوة الأصدقاء";
    inviteButton.onclick = () => openInviteFriendsModal("draw_guess", currentDrawRoomCode);
    hostArea.insertBefore(inviteButton, hostArea.firstChild);
}

const originalRenderDrawWaitingRoom = renderDrawWaitingRoom;
renderDrawWaitingRoom = function(data) {
    originalRenderDrawWaitingRoom(data);
    ensureDrawInviteButton();
};

async function maybeAutoJoinDrawInvite() {
    if (!window.appCurrentUser || currentDrawRoomCode || currentDrawPlayerId) return;

    const params = new URLSearchParams(window.location.search);
    const inviteRoom = params.get("invite_room");
    const accepted = params.get("invite_accept");
    if (!inviteRoom || accepted !== "1") return;

    const preferredName = (window.appCurrentUser.display_name || window.appCurrentUser.username || "").trim();
    if (preferredName) {
        currentDrawPlayerName = preferredName;
        localStorage.setItem("draw_player_name", preferredName);
        const nameInput = document.getElementById("drawName");
        if (nameInput) nameInput.value = preferredName;
    }

    const roomInput = document.getElementById("drawRoomInput");
    if (roomInput) roomInput.value = inviteRoom;

    history.replaceState({}, "", location.pathname);
    await joinDrawRoom();
}

document.addEventListener("DOMContentLoaded", () => {
    maybeAutoJoinDrawInvite();
});
