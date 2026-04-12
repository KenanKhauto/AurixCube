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
let drawWS = null;
let drawCanvas = null;
let drawCtx = null;
let drawIsDrawing = false;
let drawLastX = 0;
let drawLastY = 0;

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

function showDrawError(message) {
    const errorDiv = document.getElementById('draw-global-error');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideDrawError() {
    const errorDiv = document.getElementById('draw-global-error');
    errorDiv.classList.add('hidden');
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

const drawCategoryLabels = {
    animals: "حيوانات",
    objects: "جماد",
    general_sports: "رياضة",
    pc_setup: "تجميعات الكمبيوتر",
    syrian_series: "مسلسلات سورية",
};


document.addEventListener("DOMContentLoaded", async () => {
    renderDrawPlayerCountButtons();
    renderDrawRoundsButtons();
    renderDrawLanguageButtons();
    renderDrawTimerButtons();
    renderDrawCharacterButtons();
    await loadDrawCategories();

    if (currentDrawPlayerName) {
        const nameInput = document.getElementById("drawName");
        if (nameInput) nameInput.value = currentDrawPlayerName;
    }

    if (currentDrawRoomCode) {
        const roomInput = document.getElementById("drawRoomInput");
        if (roomInput) roomInput.value = currentDrawRoomCode;
    }


    if (currentDrawRoomCode && currentDrawPlayerId) {
        await refreshDrawRoomState();
    }
});


function setupDrawCanvas() {
    const canvasContainer = document.getElementById("drawCanvas")?.parentNode;
    if (!canvasContainer) return;

    // Create a new blank canvas instead of cloning to ensure it's cleared
    const newCanvas = document.createElement("canvas");
    newCanvas.id = "drawCanvas";

    // Replace the old canvas
    const oldCanvas = document.getElementById("drawCanvas");
    if (oldCanvas) {
        canvasContainer.replaceChild(newCanvas, oldCanvas);
    } else {
        canvasContainer.appendChild(newCanvas);
    }

    drawCanvas = newCanvas;

    const rect = drawCanvas.getBoundingClientRect();
    
    // Account for device pixel ratio (high-DPI/Retina displays)
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas internal resolution
    drawCanvas.width = rect.width * dpr;
    drawCanvas.height = rect.height * dpr;
    
    // Set canvas CSS size
    drawCanvas.style.width = rect.width + 'px';
    drawCanvas.style.height = rect.height + 'px';

    drawCtx = drawCanvas.getContext("2d");
    
    // Scale context to match device pixel ratio
    drawCtx.scale(dpr, dpr);
    
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";

    // white background
    drawCtx.fillStyle = "#ffffff";
    drawCtx.fillRect(0, 0, rect.width, rect.height);

    drawCanvas.addEventListener("mousedown", handleDrawMouseDown);
    drawCanvas.addEventListener("mousemove", handleDrawMouseMove);
    window.addEventListener("mouseup", handleDrawMouseUp);

    drawCanvas.addEventListener("touchstart", handleDrawTouchStart, { passive: false });
    drawCanvas.addEventListener("touchmove", handleDrawTouchMove, { passive: false });
    drawCanvas.addEventListener("touchend", handleDrawTouchEnd, { passive: false });
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
    
    // Only send if there's an actual distance moved (avoid sending identical points)
    const distance = Math.sqrt(Math.pow(x - drawLastX, 2) + Math.pow(y - drawLastY, 2));
    
    if (distance > 0.5) {
        const stroke = buildStrokePayload(drawLastX, drawLastY, x, y);
        
        const sent = sendDrawWSMessage(stroke);
        if (sent) {
            drawStroke(stroke);
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
    
    // Only send if there's an actual distance moved (avoid sending identical points)
    const distance = Math.sqrt(Math.pow(x - drawLastX, 2) + Math.pow(y - drawLastY, 2));
    
    if (distance > 0.5) {
        const stroke = buildStrokePayload(drawLastX, drawLastY, x, y);
        
        const sent = sendDrawWSMessage(stroke);
        if (sent) {
            drawStroke(stroke);
            drawLastX = x;
            drawLastY = y;
        }
    }
}

function handleDrawTouchEnd(event) {
    event.preventDefault();
    drawIsDrawing = false;
}

function getDrawCoordinates(event) {
    if (!drawCanvas) return { x: 0, y: 0 };
    
    const rect = drawCanvas.getBoundingClientRect();
    
    // Get the actual canvas size used for rendering (accounting for CSS size)
    const displayWidth = rect.width;
    const displayHeight = rect.height;
    
    // Get the internal canvas resolution
    const dpr = window.devicePixelRatio || 1;
    const internalWidth = drawCanvas.width / dpr;
    const internalHeight = drawCanvas.height / dpr;
    
    // Account for any scaling
    const scaleX = internalWidth / displayWidth;
    const scaleY = internalHeight / displayHeight;

    // Get client coordinates
    let clientX = event.clientX || 0;
    let clientY = event.clientY || 0;
    
    // Check if this is a touch event and get the first touch if it is
    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    }

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
    };
}

function initCanvas() {
    canvas = document.getElementById("drawCanvas");
    if (!canvas) return;

    ctx = canvas.getContext("2d");

    resizeCanvas(canvas);

    // white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    setupDrawingEvents();

    window.addEventListener("resize", () => resizeCanvas(canvas));
}

function setupDrawingEvents() {
    canvas.addEventListener("mousedown", (e) => {
        drawing = true;
        const { x, y } = getCanvasCoordinates(canvas, e);
        lastX = x;
        lastY = y;
    });

    canvas.addEventListener("mouseup", () => {
        drawing = false;
    });

    canvas.addEventListener("mouseleave", () => {
        drawing = false;
    });

    canvas.addEventListener("mousemove", (e) => {
        if (!drawing) return;

        const { x, y } = getCanvasCoordinates(canvas, e);

        drawLine(lastX, lastY, x, y);

        lastX = x;
        lastY = y;
    });
}

function drawLine(x1, y1, x2, y2) {
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // send via websocket
    sendDrawWSMessage({
        type: "draw",
        player_id: currentDrawPlayerId,
        stroke: {
            x0: x1,
            y0: y1,
            x1: x2,
            y1: y2,
            color: "#000000",
            width: 3
        }
    });
}


function buildStrokePayload(x0, y0, x1, y1) {
    const color = document.getElementById("drawColorPicker")?.value || "#ffffff";
    const width = Number(document.getElementById("drawBrushSize")?.value || 4);

    return {
        type: "draw",
        player_id: currentDrawPlayerId,
        x0,
        y0,
        x1,
        y1,
        color,
        width
    };
}

function drawStroke(stroke) {
    if (!drawCtx) return;

    drawCtx.beginPath();
    drawCtx.moveTo(stroke.x0, stroke.y0);
    drawCtx.lineTo(stroke.x1, stroke.y1);
    drawCtx.strokeStyle = stroke.color;
    drawCtx.lineWidth = stroke.width;
    drawCtx.stroke();
}

function clearCanvasLocally() {
    if (!drawCtx || !drawCanvas) return;
    
    const rect = drawCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    drawCtx.clearRect(0, 0, rect.width, rect.height);
    drawCtx.fillStyle = "#ffffff";
    drawCtx.fillRect(0, 0, rect.width, rect.height);
}

function clearDrawCanvas() {
    if (!canCurrentPlayerDraw()) return;
    clearCanvasLocally();
    sendDrawWSMessage({
        type: "clear",
        player_id: currentDrawPlayerId
    });
}

function canCurrentPlayerDraw() {
    return (
        currentDrawRoomData &&
        currentDrawRoomData.phase === "drawing" &&
        currentDrawRoomData.current_drawer_id === currentDrawPlayerId
    );
}

function connectDrawWS(roomCode) {
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
    };

    drawWS.onerror = (error) => {
        console.error("WebSocket error:", error);
    };

    drawWS.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "draw" && data.stroke) {
                // Only draw strokes from other players
                if (data.stroke.player_id !== currentDrawPlayerId) {
                    // Validate stroke data
                    const stroke = {
                        x0: parseFloat(data.stroke.x0) || 0,
                        y0: parseFloat(data.stroke.y0) || 0,
                        x1: parseFloat(data.stroke.x1) || 0,
                        y1: parseFloat(data.stroke.y1) || 0,
                        color: data.stroke.color || "#000000",
                        width: parseFloat(data.stroke.width) || 2
                    };
                    drawStroke(stroke);
                }
            }

            if (data.type === "guess") {
                renderDrawGuessMessage(data);
            }

            if (data.type === "clear") {
                clearCanvasLocally();
            }

            if (data.type === "player_left") {
                // Handle player left, maybe refresh room state
                refreshDrawRoomState();
            }
        } catch (error) {
            console.error("Error processing WebSocket message:", error);
        }
    };

    drawWS.onclose = () => {
        console.log("WebSocket closed");
    };

    // Send leave message on page unload
    window.addEventListener('beforeunload', () => {
        if (drawWS && drawWS.readyState === WebSocket.OPEN) {
            try {
                drawWS.send(JSON.stringify({
                    type: 'leave',
                    player_id: currentDrawPlayerId
                }));
            } catch (error) {
                console.error("Error sending leave message:", error);
            }
        }
    });
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

async function loadDrawCategories() {
    const response = await fetch("/api/draw-guess/categories");
    const data = await response.json();

    const container = document.getElementById("drawCategoryGrid");
    if (!container) return;

    container.innerHTML = "";

    (data.categories || []).forEach((key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.categoryKey = key;
        button.textContent = drawCategoryLabels[key] || key;
        button.onclick = () => toggleDrawCategory(key);
        container.appendChild(button);
    });

    updateDrawCategoryButtonsState();
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

function toggleDrawCategory(categoryKey) {
    const exists = selectedDrawCategories.includes(categoryKey);

    if (exists) {
        selectedDrawCategories = selectedDrawCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedDrawCategories.length >= MAX_DRAW_CATEGORIES) {
            showDrawError(`يمكنك اختيار ${MAX_DRAW_CATEGORIES} تصنيفات كحد أقصى`);
            return;
        }
        selectedDrawCategories.push(categoryKey);
    }

    updateDrawCategoryButtonsState();
}

function updateDrawCategoryButtonsState() {
    const info = document.getElementById("drawCategorySelectionInfo");
    if (info) {
        info.textContent = `تم اختيار ${selectedDrawCategories.length}`;
    }

    document.querySelectorAll("#drawCategoryGrid .category-btn").forEach((btn) => {
        const key = btn.dataset.categoryKey;
        btn.classList.toggle("active", selectedDrawCategories.includes(key));
    });
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
    if (selectedDrawCategories.length === 0) {
        showDrawError("اختر تصنيفاً واحداً على الأقل!");
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
            categories: selectedDrawCategories,
            language: selectedDrawLanguage,
            round_timer_seconds: selectedDrawTimer
        })
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
    drawIsHost = true;
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
            character_id: selectedDrawCharacter
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر الانضمام إلى الغرفة.");
        return;
    }

    const joinedPlayer = data.players.find(
        (player) => player.name === name && player.id !== data.host_id
    ) || data.players[data.players.length - 1];

    currentDrawRoomCode = roomCode;
    currentDrawPlayerId = joinedPlayer.id;
    currentDrawPlayerName = name;
    currentDrawRoomData = data;
    drawIsHost = currentDrawPlayerId === data.host_id;
    lastRenderedDrawSignature = null;

    localStorage.setItem("draw_room_code", currentDrawRoomCode);
    localStorage.setItem("draw_player_id", currentDrawPlayerId);
    localStorage.setItem("draw_player_name", currentDrawPlayerName);

    connectDrawWS(currentDrawRoomCode);
    renderDrawState(data);
}

async function startDrawGame() {
    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/start`, {
        method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر بدء اللعبة.");
        return;
    }

    currentDrawRoomData = data;
    lastRenderedDrawSignature = null;
    renderDrawState(data);
}

async function selectDrawWord(chosenWordEn) {
    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/select-word`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_id: currentDrawPlayerId,
            chosen_word_en: chosenWordEn
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر اختيار الكلمة.");
        return;
    }

    currentDrawRoomData = data;
    lastRenderedDrawSignature = null;
    clearCanvasLocally();
    renderDrawState(data);
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
        text
    });

    input.value = "";
}

async function advanceDrawRound() {
    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_id: currentDrawPlayerId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر الانتقال للجولة التالية.");
        return;
    }

    currentDrawRoomData = data;
    lastRenderedDrawSignature = null;
    clearCanvasLocally();
    renderDrawState(data);
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
            round_timer_seconds: timer
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر إعادة اللعبة.");
        return;
    }

    currentDrawRoomData = data;
    lastRenderedDrawSignature = null;
    renderDrawWaitingRoom(data);
}

async function leaveDrawRoom() {
    const confirmed = confirm("هل أنت متأكد أنك تريد الخروج من الغرفة؟");
    if (!confirmed) return;

    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentDrawPlayerId })
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
        body: JSON.stringify({ player_id: currentDrawPlayerId })
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
            player_id_to_remove: playerIdToRemove
        })
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

    currentDrawRoomData = data;
    drawIsHost = currentDrawPlayerId === data.host_id;

    if (!drawWS || drawWS.readyState !== WebSocket.OPEN) {
        connectDrawWS(currentDrawRoomCode);
    }

    const signature = buildDrawStateSignature(data);

    if (signature === lastRenderedDrawSignature) {
        updateDrawLiveTimer(data);
        return;
    }

    lastRenderedDrawSignature = signature;
    renderDrawState(data);
}

function buildDrawStateSignature(data) {
    const playersSignature = data.players
        .map((p) => `${p.id}:${p.score}`)
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
        players: playersSignature
    });
}

function renderDrawState(data) {
    const previousDrawRoomData = currentDrawRoomData;
    currentDrawRoomData = data;

    if (data.ended || data.phase === "game_over") {
        renderDrawGameOver(data);
        updateDrawRoomActionButtons();
        return;
    }

    if (!data.started || data.phase === "waiting") {
        renderDrawWaitingRoom(data);
        updateDrawRoomActionButtons();
        return;
    }

    if (data.phase === "word_choice") {
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

function buildDrawPlayerIdentity(player) {
    return `
        <div class="draw-player-identity">
            <img src="/static/images/${player.character_id || 'char1'}.png" class="draw-player-avatar" alt="${escapeHtml(player.name)}">
            <div class="draw-player-text">
                <span class="draw-player-name">${escapeHtml(player.name)}</span>
            </div>
        </div>
    `;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderDrawWaitingRoom(data) {
    hideAllDrawScreens();
    document.getElementById("screen-draw-wait").classList.remove("hidden");
    document.getElementById("drawDisplayCode").textContent = data.room_code;

    const tbody = document.getElementById("drawPlayerList");
    tbody.innerHTML = "";

    [...data.players]
        .sort((a, b) => b.score - a.score)
        .forEach((player) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${buildDrawPlayerIdentity(player)}</td>
                <td>${player.score}</td>
                ${buildDrawRemoveActionCell(player.id)}
            `;
            tbody.appendChild(row);
        });

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

    const isSameDrawingSession =
        previousData &&
        previousData.phase === "drawing" &&
        previousData.current_round === data.current_round &&
        previousData.current_drawer_id === data.current_drawer_id;

    const roundChanged = !previousData || previousData.current_round !== data.current_round;

    if (!isSameDrawingSession || !drawCanvas || roundChanged) {
        setupDrawCanvas();
        (data.strokes || []).forEach(drawStroke);
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

    document.getElementById("drawRoundWordReveal").textContent =
        `الكلمة كانت: ${revealedWord}`;

    renderDrawRankingResultTable(data);

    const advanceArea = document.getElementById("drawAdvanceArea");
    advanceArea.innerHTML = "";

    if (drawIsHost) {
        const nextButton = document.createElement("button");
        nextButton.className = "btn btn-primary";
        nextButton.textContent = data.current_round >= data.total_rounds
            ? "إنهاء اللعبة"
            : "الجولة التالية";
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

    // Handle insufficient players
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

    // Normal game over
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

function buildHiddenWordHint(data) {
    const choices = data.current_word_choices || [];
    if (!choices.length) return "؟ ؟ ؟";

    const first = data.language === "ar" ? choices[0].word_ar : choices[0].word_en;
    if (!first) return "؟ ؟ ؟";

    return first.split("").map(() => "_").join(" ");
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
        "screen-draw-game-over"
    ];

    screens.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });
}

async function loadDrawCategories() {
    const response = await fetch("/api/draw-guess/categories");
    const data = await response.json();
    allDrawCategories = data.categories || [];
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

    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            host_id: currentDrawPlayerId,
            categories: nextCategories
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062A\u0635\u0646\u064A\u0641\u0627\u062A.");
        return;
    }

    currentDrawRoomData = data;
    selectedDrawCategories = [...(data.categories || [])];
    drawIsHost = currentDrawPlayerId === data.host_id;
    lastRenderedDrawSignature = null;
    renderDrawWaitingRoom(data);
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
            ? `\u0627\u0644\u0645\u0646\u0638\u0645 \u064A\u062E\u062A\u0627\u0631 \u0627\u0644\u062A\u0635\u0646\u064A\u0641\u0627\u062A \u0627\u0644\u0622\u0646: ${data.categories.length} / ${MAX_DRAW_CATEGORIES}`
            : `\u0627\u0644\u0645\u0646\u0638\u0645 \u0644\u0645 \u064A\u062E\u062A\u0631 \u0623\u064A \u062A\u0635\u0646\u064A\u0641 \u0628\u0639\u062F`;
    }

    updateDrawCategoryButtonsState();
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
            round_timer_seconds: selectedDrawTimer
        })
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
    drawIsHost = true;
    selectedDrawCategories = [...(data.categories || [])];
    lastRenderedDrawSignature = null;

    localStorage.setItem("draw_room_code", currentDrawRoomCode);
    localStorage.setItem("draw_player_id", currentDrawPlayerId);
    localStorage.setItem("draw_player_name", currentDrawPlayerName);

    connectDrawWS(currentDrawRoomCode);
    renderDrawWaitingRoom(data);
}

async function startDrawGame() {
    if (!currentDrawRoomData?.categories?.length) {
        showDrawError("اختر تصنيفًا واحدًا على الأقل قبل بدء اللعبة.");
        return;
    }

    const response = await fetch(`/api/draw-guess/rooms/${currentDrawRoomCode}/start`, {
        method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
        showDrawError(data.detail || "تعذر بدء اللعبة.");
        return;
    }

    currentDrawRoomData = data;
    lastRenderedDrawSignature = null;
    renderDrawState(data);
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
            round_timer_seconds: timer
        })
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

function buildDrawStateSignature(data) {
    const playersSignature = data.players
        .map((p) => `${p.id}:${p.score}`)
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
        players: playersSignature
    });
}

function renderDrawWaitingRoom(data) {
    hideAllDrawScreens();
    document.getElementById("screen-draw-wait").classList.remove("hidden");
    currentDrawRoomData = data;
    selectedDrawCategories = [...(data.categories || [])];
    document.getElementById("drawDisplayCode").textContent = data.room_code;

    const tbody = document.getElementById("drawPlayerList");
    tbody.innerHTML = "";

    [...data.players]
        .sort((a, b) => b.score - a.score)
        .forEach((player) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${buildDrawPlayerIdentity(player)}</td>
                <td>${player.score}</td>
                ${buildDrawRemoveActionCell(player.id)}
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

    if (drawWS) {
        drawWS.close();
        drawWS = null;
    }
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
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ player_id: currentDrawPlayerId })
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
