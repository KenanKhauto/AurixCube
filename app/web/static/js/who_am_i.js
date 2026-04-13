let currentRoomCode = localStorage.getItem("whoami_room_code") || null;
let currentPlayerId = localStorage.getItem("whoami_player_id") || null;
let currentPlayerName = localStorage.getItem("whoami_player_name") || null;
let currentRoomData = null;
let cachedIdentity = "";
let isHost = false;
let currentGuessDraft = "";
let lastRoomSnapshot = null;
let currentPlayerKnowledge = [];
let selectedCategories = [];
let allWhoAmICategories = [];
const MAX_CATEGORIES = 12;
let selectedPlayerCount = null;
let selectedCharacter = localStorage.getItem("whoami_character_id") || "char1";
const whoAmICharacterOptions = Array.from({ length: 12 }, (_, i) => `char${i + 1}`);
let whoAmIFriendCachePrimed = false;
const playerCountOptions = [2, 3, 4, 5, 6, 7, 8];

const categoryLabels = {
    football_players: "لاعبين كرة قدم",
    countries: "دول",
    animals: "حيوانات",
    cartoon_characters: "شخصيات كرتون",
    football_clubs: "أندية كرة القدم",
    vegetables_and_fruits: "خضار وفواكه",
    cars: "سيارات",
    syrian_food: "أكلات سورية",
    syrian_series: "مسلسلات سورية",
    prophets: "أنبياء",
    syrian_characters: "شخصيات سورية",
    quran_references: "سور وآيات قرآنية",
    video_games: "ألعاب فيديو",
    superheroes: "أبطال خارقين", 
    clothing_brands: "ماركات ملابس",
};

function showWhoAmIError(message) {
    const errorDiv = document.getElementById('whoami-global-error');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideWhoAmIError() {
    const errorDiv = document.getElementById('whoami-global-error');
    errorDiv.classList.add('hidden');
}

document.addEventListener("DOMContentLoaded", async () => {
    await primeWhoAmIFriendCache();
    renderPlayerCountButtons();
    await loadCategories();
    renderCharacterButtons();

    const nameInput = document.getElementById("pName");
    const defaultLobbyName = typeof getDefaultLobbyName === "function" ? getDefaultLobbyName() : "";
    const initialName = currentPlayerName || defaultLobbyName;
    if (nameInput && defaultLobbyName) {
        nameInput.placeholder = defaultLobbyName;
    }
    if (nameInput && initialName && !nameInput.value.trim()) {
        nameInput.value = initialName;
    }

    if (currentRoomCode) {
        document.getElementById("roomInput").value = currentRoomCode;
    }

    if (currentRoomCode && currentPlayerId) {
        await refreshRoomState();
    }
});

function renderCharacterButtons() {
    const container = document.getElementById("characterGrid");
    if (!container) return;

    container.innerHTML = "";

    whoAmICharacterOptions.forEach((characterId) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "character-btn";
        button.dataset.characterId = characterId;
        button.onclick = () => selectCharacter(characterId);

        button.innerHTML = `
            <img src="/static/images/${characterId}.png" class="character-btn-img" alt="${characterId}">
        `;

        container.appendChild(button);
    });

    updateCharacterButtonsState();
}

function selectCharacter(characterId) {
    selectedCharacter = characterId;
    localStorage.setItem("whoami_character_id", selectedCharacter);
    updateCharacterButtonsState();
}

function updateCharacterButtonsState() {
    const buttons = document.querySelectorAll("#characterGrid .character-btn");

    buttons.forEach((btn) => {
        const characterId = btn.dataset.characterId;
        btn.classList.toggle("active", characterId === selectedCharacter);
    });

    const preview = document.getElementById("characterPreview");
    if (preview) {
        preview.src = `/static/images/${selectedCharacter}.png`;
    }
}

function buildWhoAmIPlayerIdentity(player) {
    return `
        <div class="whoami-player-identity">
            <img src="/static/images/${player.character_id || 'char1'}.png" class="whoami-player-avatar" alt="${escapeHtml(player.name)}">
            <div class="whoami-player-text">
                <span class="whoami-player-name">${escapeHtml(player.name)}</span>
            </div>
        </div>
    `;
}

function renderRevealPlayersState(data) {
    let container = document.getElementById("revealPlayersState");
    if (!container) {
        const screen = document.getElementById("screen-reveal");
        const controls = document.querySelector("#screen-reveal > div[style*='margin-top:20px']");
        if (!screen) return;
        container = document.createElement("div");
        container.id = "revealPlayersState";
        container.style.marginTop = "20px";
        if (controls) {
            screen.insertBefore(container, controls);
        } else {
            screen.appendChild(container);
        }
    }

    const currentRevealIndex = data.reveal_order.indexOf(data.current_reveal_player_id);
    const rows = data.players.map((player) => {
        const playerRevealIndex = data.reveal_order.indexOf(player.id);

        let statusText = "بانتظار الدور";
        if (player.id === data.current_reveal_player_id) {
            statusText = "يكشف الآن";
        } else if (playerRevealIndex !== -1 && currentRevealIndex !== -1 && playerRevealIndex < currentRevealIndex) {
            statusText = "تم الكشف";
        }

        return `
            <tr>
                <td>${buildWhoAmIPlayerIdentity(player)}</td>
                <td>${statusText}</td>
                ${buildWhoAmIRemoveActionCell(player.id)}
            </tr>
        `;
    }).join("");

    container.innerHTML = `
        <h4>اللاعبون</h4>
        <div class="table-wrapper">
            <table class="bluff-table whoami-players-table">
                <thead>
                    <tr>
                        <th>اللاعب</th>
                        <th>الحالة</th>
                        <th>${isHost ? "الإجراء" : ""}</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

async function handleWhoAmIRoomExit(message) {
    clearLocalGameState();
    await openAppAlert(message, {
        title: "تمت إزالتك",
        confirmLabel: "الخروج",
        danger: true,
    });
    window.location.reload();
}

function ensureCurrentWhoAmIPlayerStillInRoom(data) {
    if ((data.players || []).some((player) => player.id === currentPlayerId)) {
        return true;
    }

    handleWhoAmIRoomExit("تمت إزالتك من الغرفة.");
    return false;
}

function buildWhoAmIRemoveActionCell(playerId, showActions = true) {
    if (showActions && isHost && playerId !== currentPlayerId) {
        return `<td><button class="btn btn-danger" onclick="removeWhoAmIPlayer('${playerId}')">حذف</button></td>`;
    }
    return "<td></td>";
}

function buildWhoAmILobbyActionCell(player) {
    const actions = [];
    if (isHost && player.id !== currentPlayerId) {
        actions.push(`<button class="btn btn-danger" onclick="removeWhoAmIPlayer('${player.id}')">حذف</button>`);
    }
    if (window.appCurrentUser && typeof canSendFriendRequestToUsername === "function" && canSendFriendRequestToUsername(player.username)) {
        const encodedUsername = encodeURIComponent(player.username);
        actions.push(`<button class="btn" onclick="sendWhoAmIFriendRequest('${encodedUsername}', this)">Add Friend</button>`);
    }
    if (!actions.length) return "<td></td>";
    return `<td>${actions.join(" ")}</td>`;
}

async function sendWhoAmIFriendRequest(encodedUsername, buttonEl) {
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

async function primeWhoAmIFriendCache() {
    if (whoAmIFriendCachePrimed || !window.appCurrentUser || typeof ensureAppFriendCache !== "function") return;
    await ensureAppFriendCache();
    whoAmIFriendCachePrimed = true;
    if (currentRoomData && (!currentRoomData.started || currentRoomData.phase === "waiting")) {
        renderWaitingRoom(currentRoomData);
    }
}

function renderWhoAmILobbyCharacterPicker(data) {
    const grid = document.getElementById("whoamiWaitCharacterGrid");
    const preview = document.getElementById("whoamiWaitCharacterPreview");
    if (!grid || !preview) return;

    const me = (data.players || []).find((player) => player.id === currentPlayerId);
    const activeCharacterId = me?.character_id || selectedCharacter || "char1";
    selectedCharacter = activeCharacterId;
    localStorage.setItem("whoami_character_id", selectedCharacter);

    preview.src = `/static/images/${activeCharacterId}.png`;
    grid.innerHTML = "";

    whoAmICharacterOptions.forEach((characterId) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "character-btn";
        button.dataset.characterId = characterId;
        button.classList.toggle("active", characterId === activeCharacterId);
        button.onclick = () => updateWhoAmILobbyCharacter(characterId);
        button.innerHTML = `<img src="/static/images/${characterId}.png" class="character-btn-img" alt="${characterId}">`;
        grid.appendChild(button);
    });
}

async function updateWhoAmILobbyCharacter(characterId) {
    if (!currentRoomCode || !currentPlayerId) return;
    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/character`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_id: currentPlayerId,
            character_id: characterId,
        }),
    });
    const data = await response.json();
    if (!response.ok) {
        showWhoAmIError(data.detail || "Unable to update character.");
        return;
    }
    selectedCharacter = characterId;
    localStorage.setItem("whoami_character_id", selectedCharacter);
    currentRoomData = data;
    renderWaitingRoom(data);
}


function renderPlayerCountButtons() {
    const container = document.getElementById("playerCountGrid");
    if (!container) return;

    container.innerHTML = "";

    playerCountOptions.forEach((count) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.playerCount = String(count);
        button.textContent = `${count} لاعبين`;

        if (count === selectedPlayerCount) {
            button.classList.add("active");
        }

        button.onclick = () => selectPlayerCount(count);

        container.appendChild(button);
    });
}

function selectPlayerCount(count) {
    selectedPlayerCount = count;
    updatePlayerCountButtonsState();
}

function updatePlayerCountButtonsState() {
    const buttons = document.querySelectorAll("#playerCountGrid .category-btn");

    buttons.forEach((btn) => {
        const count = Number(btn.dataset.playerCount);

        if (count === selectedPlayerCount) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

async function loadCategories() {
    const response = await fetch("/api/who-am-i/categories");
    const data = await response.json();
    allWhoAmICategories = Object.keys(data.categories || {});
}


function toggleCategory(categoryKey) {
    const isSelected = selectedCategories.includes(categoryKey);

    if (isSelected) {
        selectedCategories = selectedCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedCategories.length >= MAX_CATEGORIES) {
            showWhoAmIError(`يمكنك اختيار ${MAX_CATEGORIES} تصنيفات كحد أقصى`);
            return;
        }

        selectedCategories.push(categoryKey);
    }

    updateCategoryButtonsState();
}

function updateCategoryButtonsState() {
    const buttons = document.querySelectorAll(".category-btn");
    const info = document.getElementById("categorySelectionInfo");

    if (info) {
        info.textContent = `تم اختيار ${selectedCategories.length} / ${MAX_CATEGORIES}`;
    }

    buttons.forEach((btn) => {
        const key = btn.dataset.categoryKey;
        if (!key) return;

        const isSelected = selectedCategories.includes(key);

        if (isSelected) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }

        if (!isSelected && selectedCategories.length >= MAX_CATEGORIES) {
            btn.classList.add("disabled");
            btn.disabled = true;
        } else {
            btn.classList.remove("disabled");
            btn.disabled = false;
        }
    });
}

function showSetup() {
    const name = document.getElementById("pName").value.trim();

    if (!name) {
        showWhoAmIError("الرجاء إدخال اسمك أولاً!");
        return;
    }

    currentPlayerName = name;
    localStorage.setItem("whoami_player_name", currentPlayerName);

    hideAll();
    document.getElementById("screen-setup").classList.remove("hidden");
}

function goBackToLobby() {
    hideAll();
    document.getElementById("screen-lobby").classList.remove("hidden");
}

async function createRoom() {
    const hostName = currentPlayerName || document.getElementById("pName").value.trim();
    const playerCount = selectedPlayerCount;

    if (selectedCategories.length === 0) {
    showWhoAmIError("اختر تصنيفاً واحداً على الأقل!");
    return;
    }
    if (!selectedPlayerCount) {
        showWhoAmIError("اختر عدد اللاعبين أولاً!");
        return;
    }

    const response = await fetch("/api/who-am-i/rooms", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_name: hostName,
            max_player_count: playerCount,
            categories: selectedCategories,
            character_id: selectedCharacter
        })
    });

    
    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "حدث خطأ أثناء إنشاء الغرفة.");
        return;
    }

    currentRoomCode = data.room_code;
    currentPlayerId = data.host_id;
    currentPlayerName = hostName;
    currentRoomData = data;
    isHost = true;
    cachedIdentity = "";
    currentGuessDraft = "";
    lastRoomSnapshot = null;

    localStorage.setItem("whoami_room_code", currentRoomCode);
    localStorage.setItem("whoami_player_id", currentPlayerId);
    localStorage.setItem("whoami_player_name", currentPlayerName);
    hideWhoAmIError();    renderWaitingRoom(data);
}

async function joinRoom() {
    const name = document.getElementById("pName").value.trim();
    const roomCode = document.getElementById("roomInput").value.trim().toUpperCase();

    if (!name || !roomCode) {
        showWhoAmIError("اكمل البيانات!");
        return;
    }

    const response = await fetch(`/api/who-am-i/rooms/${roomCode}/join`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ 
            player_name: name,
            character_id: selectedCharacter 
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "تعذر الانضمام إلى الغرفة.");
        return;
    }

    const joinedPlayer = data.players.find(
        (player) => player.name === name && player.id !== data.host_id
    ) || data.players[data.players.length - 1];

    currentRoomCode = roomCode;
    currentPlayerId = joinedPlayer.id;
    currentPlayerName = name;
    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    cachedIdentity = "";
    currentGuessDraft = "";
    lastRoomSnapshot = null;

    localStorage.setItem("whoami_room_code", currentRoomCode);
    localStorage.setItem("whoami_player_id", currentPlayerId);
    localStorage.setItem("whoami_player_name", currentPlayerName);
    hideWhoAmIError();    renderState(data);
}

async function startGame() {
    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/start`, {
        method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "تعذر بدء اللعبة.");
        return;
    }

    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    cachedIdentity = "";
    currentGuessDraft = "";
    lastRoomSnapshot = null;

    renderRevealScreen(data);
}

async function advanceRevealPhase() {
    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/confirm-reveal`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ player_id: currentPlayerId })
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "تعذر الانتقال للاعب التالي.");
        return;
    }

    currentRoomData = data;
    lastRoomSnapshot = null;

    if (data.reveal_phase_active) {
        await renderRevealScreen(data);
    } else {
        renderPlayScreen(data);
    }
}

async function submitGuess() {
    const guessInput = document.getElementById("guessInput");
    const guessText = guessInput.value.trim();

    if (!guessText) {
        showWhoAmIError("أدخل تخميناً أولاً.");
        return;
    }

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/guess`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            player_id: currentPlayerId,
            guess_text: guessText
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "تعذر إرسال التخمين.");
        return;
    }

    currentRoomData = data;
    currentGuessDraft = "";
    lastRoomSnapshot = null;

    const me = data.players.find((player) => player.id === currentPlayerId);
    if (me && me.has_guessed_correctly && !cachedIdentity) {
        await fetchMySolvedIdentity();
    }

    if (data.ended) {
        renderGameOver(data);
    } else {
        renderPlayScreen(data);
    }
}

async function fetchMySolvedIdentity() {
    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/reveal-view`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ player_id: currentPlayerId })
    });

    if (!response.ok) {
        return;
    }

    const data = await response.json();

    if (data.mode === "solved_self_reveal" && data.identity) {
        cachedIdentity = data.identity;
    }
}

async function restartGame() {
    if (selectedCategories.length === 0) {
    showWhoAmIError("اختر تصنيفاً واحداً على الأقل!");
    return;
    }

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/restart`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ categories: selectedCategories })
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "تعذر إعادة اللعبة.");
        return;
    }

    currentRoomData = data;
    cachedIdentity = "";
    currentGuessDraft = "";
    lastRoomSnapshot = null;
    renderWaitingRoom(data);
}

async function leaveCurrentRoom() {
    const confirmed = confirm("هل أنت متأكد أنك تريد الخروج من الغرفة؟");
    if (!confirmed) return;

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/leave`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ player_id: currentPlayerId })
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "تعذر الخروج من الغرفة.");
        return;
    }

    clearLocalGameState();
    goBackToLobby();
}

async function deleteCurrentRoom() {
    const confirmed = await openAppConfirm("هل أنت متأكد أنك تريد حذف الغرفة بالكامل؟", {
        title: "حذف الغرفة",
        confirmLabel: "حذف الغرفة",
        cancelLabel: "إلغاء",
        danger: true,
    });
    if (!confirmed) return;

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/delete`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ player_id: currentPlayerId })
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "تعذر حذف الغرفة.");
        return;
    }

    clearLocalGameState();
    goBackToLobby();
}

async function removeWhoAmIPlayer(playerIdToRemove) {
    const confirmed = await openAppConfirm("هل أنت متأكد أنك تريد حذف هذا اللاعب من الغرفة؟", {
        title: "حذف لاعب",
        confirmLabel: "حذف اللاعب",
        cancelLabel: "إلغاء",
        danger: true,
    });
    if (!confirmed) return;

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/remove-player`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_id: currentPlayerId,
            player_id_to_remove: playerIdToRemove
        })
    });

    const data = await response.json();

    if (!response.ok) {
        const errorDetail = data.detail || "";

        if (errorDetail === "Player not found.") {
            await handleWhoAmIRoomExit("تمت إزالتك من الغرفة.");
            return;
        }

        if (errorDetail === "Room not found.") {
            await handleWhoAmIRoomExit("تم حذف الغرفة أو لم تعد متاحة.");
            return;
        }
        showWhoAmIError(data.detail || "تعذر حذف اللاعب من الغرفة.");
        return;
    }

    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    lastRoomSnapshot = null;
    await refreshPlayerKnowledge();

    if (data.ended) {
        renderGameOver(data);
        return;
    }

    if (!data.started) {
        renderWaitingRoom(data);
        return;
    }

    if (data.reveal_phase_active) {
        await renderRevealScreen(data);
        return;
    }

    renderPlayScreen(data);
}

function buildRoomSnapshot(data) {
    return JSON.stringify(data);
}

function shouldRenderRoom(data) {
    const snapshot = buildRoomSnapshot(data);
    if (snapshot === lastRoomSnapshot) {
        return false;
    }

    lastRoomSnapshot = snapshot;
    return true;
}

async function refreshPlayerKnowledge() {
    if (!currentRoomCode || !currentPlayerId) return;

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/player-knowledge`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ player_id: currentPlayerId })
    });

    if (!response.ok) return;

    const data = await response.json();
    currentPlayerKnowledge = data.players || [];
}

async function refreshRoomState() {
    if (!currentRoomCode) return;

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}`);
    if (!response.ok) {
        if (response.status === 404) {
            await handleWhoAmIRoomExit("تم حذف الغرفة أو لم تعد متاحة.");
        }
        return;
    }

    const data = await response.json();
    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;

    if (!ensureCurrentWhoAmIPlayerStillInRoom(data)) {
        return;
    }

    await refreshPlayerKnowledge();

    const me = data.players.find((player) => player.id === currentPlayerId);
    if (me && me.has_guessed_correctly && !cachedIdentity) {
        await fetchMySolvedIdentity();
    }

    if (!shouldRenderRoom(data)) {
        return;
    }

    if (data.ended) {
        renderGameOver(data);
        return;
    }

    if (!data.started) {
        renderWaitingRoom(data);
        return;
    }

    if (data.reveal_phase_active) {
        await renderRevealScreen(data);
        return;
    }

    renderPlayScreen(data);
}

function renderWaitingRoom(data) {
    hideAll();
    document.getElementById("screen-wait").classList.remove("hidden");

    document.getElementById("displayCode").textContent = data.room_code;

    const playerList = document.getElementById("playerList");
    const headerRow = playerList?.closest("table")?.querySelector("thead tr");
    playerList.innerHTML = "";
    if (headerRow) {
        let actionsHeader = document.getElementById("playerListActionsHeader");
        if (!actionsHeader) {
            actionsHeader = document.createElement("th");
            actionsHeader.id = "playerListActionsHeader";
            headerRow.appendChild(actionsHeader);
        }
        actionsHeader.textContent = isHost ? "\u0627\u0644\u0625\u062C\u0631\u0627\u0621" : "";
    }

    data.players.forEach((player) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${buildWhoAmIPlayerIdentity(player)}</td>
            ${buildWhoAmIRemoveActionCell(player.id)}
        `;
        playerList.appendChild(row);
    });

    if (isHost) {
        document.getElementById("adminArea").classList.remove("hidden");
        document.getElementById("memberArea").classList.add("hidden");
        document.getElementById("waitMsg").classList.add("hidden");
    } else {
        document.getElementById("adminArea").classList.add("hidden");
        document.getElementById("memberArea").classList.remove("hidden");
        document.getElementById("waitMsg").classList.remove("hidden");
    }
    updateWhoAmIRoomActionButtons();
}

async function renderRevealScreen(data) {
    hideAll();
    document.getElementById("screen-reveal").classList.remove("hidden");

    const status = document.getElementById("revealStatus");
    const identityBox = document.getElementById("identityBox");
    const nextRevealBtn = document.getElementById("nextRevealBtn");

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/reveal-view`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ player_id: currentPlayerId })
    });

    if (!response.ok) {
        let errorDetail = "";
        try {
            const errorData = await response.json();
            errorDetail = errorData.detail || "";
        } catch (error) {
            errorDetail = "";
        }

        if (errorDetail === "Player not found.") {
            await handleWhoAmIRoomExit("تمت إزالتك من الغرفة.");
            return;
        }

        if (errorDetail === "Room not found.") {
            await handleWhoAmIRoomExit("تم حذف الغرفة أو لم تعد متاحة.");
            return;
        }

        status.textContent = "بانتظار تحديث حالة الكشف...";
        identityBox.textContent = "بانتظار الدور...";
        nextRevealBtn.classList.add("hidden");
        renderRevealPlayersState(data);
        return;
    }

    const revealView = await response.json();

    status.textContent = revealView.message || "";

    if (revealView.mode === "hidden_for_target") {
        identityBox.textContent = "لا تنظر. الآخرون يرون هويتك الآن.";
    } else if (revealView.mode === "visible_for_others") {
        identityBox.textContent = `${revealView.target_player_name}: ${revealView.identity}`;
    } else {
        identityBox.textContent = "بانتظار الدور...";
    }

    if (isHost) {
        nextRevealBtn.classList.remove("hidden");
    } else {
        nextRevealBtn.classList.add("hidden");
    }
    renderRevealPlayersState(data);
    updateWhoAmIRoomActionButtons();
}

function handleGuessDraftChange() {
    const guessInput = document.getElementById("guessInput");
    if (!guessInput) return;
    currentGuessDraft = guessInput.value;
}

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function renderPlayScreen(data) {
    hideAll();
    document.getElementById("screen-play").classList.remove("hidden");

    document.getElementById("roundInfo").textContent = `رقم الجولة: ${data.turn_number}`;

    const currentTurnPlayer = data.players.find(
        (player) => player.id === data.current_turn_player_id
    );

    const me = data.players.find((player) => player.id === currentPlayerId);

    if (currentTurnPlayer) {
        document.getElementById("turnBox").textContent = `الدور الحالي: ${currentTurnPlayer.name}`;
    } else {
        document.getElementById("turnBox").textContent = "لا يوجد دور حالي.";
    }

    const identityElement = document.getElementById("myIdentitySmall");
    if (me && me.has_guessed_correctly && cachedIdentity) {
        identityElement.textContent = `هويتك: ${cachedIdentity}`;
    } else if (me && me.has_guessed_correctly) {
        identityElement.textContent = "تم حل هويتك";
    } else {
        identityElement.textContent = "هويتك ما زالت مخفية";
    }

    const guessArea = document.getElementById("guessArea");
    if (me && me.has_guessed_correctly) {
        guessArea.innerHTML = `<p style="color:#aaa;">لقد خمنت هويتك بشكل صحيح. يمكنك متابعة اللعبة كمشاهد</p>`;
        currentGuessDraft = "";
    } else if (data.current_turn_player_id === currentPlayerId) {
        guessArea.innerHTML = `
            <input
                id="guessInput"
                type="text"
                placeholder="اكتب تخمينك هنا..."
                value="${escapeHtml(currentGuessDraft)}"
                oninput="handleGuessDraftChange()"
            />
            <button class="btn btn-primary" onclick="submitGuess()">إرسال التخمين</button>
        `;
    } else {
        guessArea.innerHTML = `<p style="color:#aaa;">ليس دورك حالياً للتخمين. اسأل سؤالك في المكالمة عندما يأتي دورك.</p>`;
        currentGuessDraft = "";
    }

    renderPlayersState(data);
    updateWhoAmIRoomActionButtons();
}

function updateWhoAmIRoomActionButtons() {
    document.querySelectorAll(".room-leave-button").forEach((button) => {
        button.classList.toggle("hidden", isHost);
    });
    document.querySelectorAll(".room-delete-button").forEach((button) => {
        button.classList.toggle("hidden", !isHost);
    });
}

function renderPlayersState(data) {
    const container = document.getElementById("playersState");

    const sourcePlayers = currentPlayerKnowledge.length > 0
        ? currentPlayerKnowledge
        : data.players.map((player) => ({
            ...player,
            visible_identity: null
        }));

    const sortedPlayers = [...sourcePlayers].sort((a, b) => {
        const aSolved = a.solved_order ?? Number.POSITIVE_INFINITY;
        const bSolved = b.solved_order ?? Number.POSITIVE_INFINITY;

        if (a.has_guessed_correctly && b.has_guessed_correctly) {
            if (a.guess_count !== b.guess_count) {
                return a.guess_count - b.guess_count;
            }
            return aSolved - bSolved;
        }

        if (a.has_guessed_correctly) return -1;
        if (b.has_guessed_correctly) return 1;

        return a.name.localeCompare(b.name);
    });

    const rows = sortedPlayers.map((player) => {
        const statusText = player.has_guessed_correctly
            ? "خمن بشكل صحيح"
            : "لم يخمن بعد";

        const identityText = player.visible_identity
            ? player.visible_identity
            : "مخفية";

        const rowClass = player.has_guessed_correctly ? "whoami-player-done-row" : "";

        return `
            <tr class="${rowClass}">
                <td>${buildWhoAmIPlayerIdentity(player)}</td>
                <td>${statusText}</td>
                <td>${player.guess_count}</td>
                <td>${identityText}</td>
                ${buildWhoAmIRemoveActionCell(player.id)}
            </tr>
        `;
    }).join("");

    container.innerHTML = `
        <h4>حالة اللاعبين:</h4>
        <div class="table-wrapper">
            <table class="bluff-table whoami-players-table">
                <thead>
                    <tr>
                        <th>اللاعب</th>
                        <th>الحالة</th>
                        <th>عدد المحاولات</th>
                        <th>الهوية</th>
                        <th>${isHost ? "\u0627\u0644\u0625\u062C\u0631\u0627\u0621" : ""}</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

function renderGameOver(data) {
    hideAll();
    document.getElementById("screen-game-over").classList.remove("hidden");

    // Handle insufficient players
    if (data.end_reason === "insufficient_players") {
        document.getElementById("finalMsg").textContent = "انتهت اللعبة! عدد اللاعبين غير كافي للمتابعة.";
    } else {
        document.getElementById("finalMsg").textContent = "تمكن جميع اللاعبين من معرفة هوياتهم";
    }

    renderRankingTable(data);

    if (isHost) {
        document.getElementById("adminReplayArea").classList.remove("hidden");
        document.getElementById("memberGameOverArea").classList.add("hidden");
    } else {
        document.getElementById("adminReplayArea").classList.add("hidden");
        document.getElementById("memberGameOverArea").classList.remove("hidden");
    }
}

function renderRankingTable(data) {
    const container = document.getElementById("rankingTableContainer");

    const rankedPlayers = [...data.players].sort((a, b) => {
        if (a.guess_count !== b.guess_count) {
            return a.guess_count - b.guess_count;
        }
        return (a.solved_order ?? Number.POSITIVE_INFINITY) - (b.solved_order ?? Number.POSITIVE_INFINITY);
    });

    const rows = rankedPlayers.map((player, index) => `
        <tr class="${
            index === 0 ? 'rank-gold' :
            index === 1 ? 'rank-silver' :
            index === 2 ? 'rank-bronze' : ''
        }">
            <td>${index + 1}</td>
            <td>${buildWhoAmIPlayerIdentity(player)}</td>
            <td>${player.guess_count}</td>
            <td>${player.solved_order ?? "-"}</td>
            ${buildWhoAmIRemoveActionCell(player.id)}
        </tr>
    `).join("");

    container.innerHTML = `
        <h3 style="color:var(--primary); margin-bottom:10px;">الترتيب النهائي</h3>
        <table style="width:100%; border-collapse: collapse; background:#141414; border-radius:12px; overflow:hidden;">
            <thead>
                <tr style="background:#222;">
                    <th style="padding:10px; border-bottom:1px solid #333;">الترتيب</th>
                    <th style="padding:10px; border-bottom:1px solid #333;">اللاعب</th>
                    <th style="padding:10px; border-bottom:1px solid #333;">عدد التخمينات</th>
                    <th style="padding:10px; border-bottom:1px solid #333;">ترتيب الحل</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;

    const headerRow = container.querySelector("thead tr");
    if (headerRow) {
        const actionHeader = document.createElement("th");
        actionHeader.style.padding = "10px";
        actionHeader.style.borderBottom = "1px solid #333";
        actionHeader.textContent = isHost ? "\u0627\u0644\u0625\u062C\u0631\u0627\u0621" : "";
        headerRow.appendChild(actionHeader);
    }
}

async function toggleCategory(categoryKey) {
    if (!isHost || currentRoomData?.started) {
        return;
    }

    const isSelected = selectedCategories.includes(categoryKey);
    let nextCategories;

    if (isSelected) {
        nextCategories = selectedCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedCategories.length >= MAX_CATEGORIES) {
            showWhoAmIError(`يمكنك اختيار ${MAX_CATEGORIES} تصنيفات كحد أقصى`);
            return;
        }

        nextCategories = [...selectedCategories, categoryKey];
    }

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/categories`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_id: currentPlayerId,
            categories: nextCategories
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "تعذر تحديث التصنيفات.");
        return;
    }

    currentRoomData = data;
    selectedCategories = [...(data.categories || [])];
    isHost = currentPlayerId === data.host_id;
    lastRoomSnapshot = null;
    renderWaitingRoom(data);
}

function updateCategoryButtonsState() {
    const buttons = document.querySelectorAll("#categoryGrid .category-btn");
    const info = document.getElementById("categorySelectionInfo");
    const canEdit = isHost && currentRoomData && !currentRoomData.started;

    if (info) {
        info.textContent = `تم اختيار ${selectedCategories.length} / ${MAX_CATEGORIES}`;
    }

    buttons.forEach((btn) => {
        const key = btn.dataset.categoryKey;
        if (!key) return;

        const isSelected = selectedCategories.includes(key);
        btn.classList.toggle("active", isSelected);

        if (!canEdit) {
            btn.classList.add("disabled");
            btn.disabled = true;
            return;
        }

        if (!isSelected && selectedCategories.length >= MAX_CATEGORIES) {
            btn.classList.add("disabled");
            btn.disabled = true;
        } else {
            btn.classList.remove("disabled");
            btn.disabled = false;
        }
    });
}

function renderWhoAmIPregameCategories(data) {
    const container = document.getElementById("categoryGrid");
    if (!container) return;

    container.innerHTML = "";

    allWhoAmICategories.forEach((key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.categoryKey = key;
        button.textContent = categoryLabels[key] || key;
        button.onclick = () => toggleCategory(key);
        container.appendChild(button);
    });

    const info = document.getElementById("categorySelectionInfo");
    if (info && !isHost) {
        info.textContent = data.categories?.length
            ? `المنظم يختار التصنيفات الآن: ${data.categories.length} / ${MAX_CATEGORIES}`
            : `المنظم لم يختر أي تصنيف بعد`;
    }

    updateCategoryButtonsState();
}

async function createRoom() {
    const hostName = currentPlayerName || document.getElementById("pName").value.trim();
    const playerCount = selectedPlayerCount;

    if (!selectedPlayerCount) {
        showWhoAmIError("اختر عدد اللاعبين أولاً!");
        return;
    }

    const response = await fetch("/api/who-am-i/rooms", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_name: hostName,
            max_player_count: playerCount,
            categories: [],
            character_id: selectedCharacter
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "حدث خطأ أثناء إنشاء الغرفة.");
        return;
    }

    currentRoomCode = data.room_code;
    currentPlayerId = data.host_id;
    currentPlayerName = hostName;
    currentRoomData = data;
    isHost = true;
    cachedIdentity = "";
    currentGuessDraft = "";
    selectedCategories = [...(data.categories || [])];
    lastRoomSnapshot = null;

    localStorage.setItem("whoami_room_code", currentRoomCode);
    localStorage.setItem("whoami_player_id", currentPlayerId);
    localStorage.setItem("whoami_player_name", currentPlayerName);
    hideWhoAmIError();
    renderWaitingRoom(data);
}

async function startGame() {
    if (!currentRoomData?.categories?.length) {
        showWhoAmIError("اختر تصنيفًا واحدًا على الأقل قبل بدء اللعبة.");
        return;
    }

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/start`, {
        method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "تعذر بدء اللعبة.");
        return;
    }

    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    cachedIdentity = "";
    currentGuessDraft = "";
    lastRoomSnapshot = null;

    renderRevealScreen(data);
}

async function restartGame() {
    const categories = selectedCategories.length > 0
        ? selectedCategories
        : currentRoomData?.categories || [];

    if (categories.length === 0) {
        showWhoAmIError("اختر تصنيفًا واحدًا على الأقل!");
        return;
    }

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/restart`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ categories })
    });

    const data = await response.json();

    if (!response.ok) {
        showWhoAmIError(data.detail || "تعذر إعادة اللعبة.");
        return;
    }

    currentRoomData = data;
    cachedIdentity = "";
    currentGuessDraft = "";
    selectedCategories = [...(data.categories || [])];
    lastRoomSnapshot = null;
    renderWaitingRoom(data);
}

function renderWaitingRoom(data) {
    hideAll();
    document.getElementById("screen-wait").classList.remove("hidden");
    currentRoomData = data;
    selectedCategories = [...(data.categories || [])];

    document.getElementById("displayCode").textContent = data.room_code;
    renderWhoAmILobbyCharacterPicker(data);

    const playerList = document.getElementById("playerList");
    const headerRow = playerList?.closest("table")?.querySelector("thead tr");
    playerList.innerHTML = "";
    if (headerRow) {
        let actionsHeader = document.getElementById("playerListActionsHeader");
        if (!actionsHeader) {
            actionsHeader = document.createElement("th");
            actionsHeader.id = "playerListActionsHeader";
            headerRow.appendChild(actionsHeader);
        }
        const showLobbyActions = isHost || Boolean(window.appCurrentUser);
        actionsHeader.textContent = showLobbyActions ? "Actions" : "";
    }

    data.players.forEach((player) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${buildWhoAmIPlayerIdentity(player)}</td>
            ${buildWhoAmILobbyActionCell(player)}
        `;
        playerList.appendChild(row);
    });

    renderWhoAmIPregameCategories(data);

    if (isHost) {
        document.getElementById("adminArea").classList.remove("hidden");
        document.getElementById("memberArea").classList.add("hidden");
        document.getElementById("waitMsg").classList.add("hidden");
    } else {
        document.getElementById("adminArea").classList.add("hidden");
        document.getElementById("memberArea").classList.remove("hidden");
        document.getElementById("waitMsg").classList.remove("hidden");
    }
    updateWhoAmIRoomActionButtons();
}

function clearLocalGameState() {
    localStorage.removeItem("whoami_room_code");
    localStorage.removeItem("whoami_player_id");
    localStorage.removeItem("whoami_player_name");

    currentRoomCode = null;
    currentPlayerId = null;
    currentPlayerName = null;
    currentRoomData = null;
    cachedIdentity = "";
    isHost = false;
    currentGuessDraft = "";
    lastRoomSnapshot = null;
    currentPlayerKnowledge = [];
    selectedCategories = [];
    localStorage.removeItem("whoami_character_id");
    selectedCharacter = "char1";
}

function resetAndExit() {
    clearLocalGameState();
    window.location.reload();
}

function hideAll() {
    document.querySelectorAll(".card").forEach((card) => card.classList.add("hidden"));
}

setInterval(async () => {
    if (currentRoomCode && currentPlayerId) {
        await refreshRoomState();
    }
}, 3000);

setInterval(async () => {
    if (currentRoomCode && currentPlayerId) {
        try {
            await fetch(`/api/who-am-i/rooms/${currentRoomCode}/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ player_id: currentPlayerId })
            });
        } catch (e) {
            // Ignore errors
        }
    }
}, 10000);

function ensureWhoAmIInviteButton() {
    if (!window.appCurrentUser || !isHost || !currentRoomCode) return;

    const hostArea = document.getElementById("adminArea");
    if (!hostArea || hostArea.querySelector(".invite-friends-btn")) return;

    const inviteButton = document.createElement("button");
    inviteButton.type = "button";
    inviteButton.className = "btn invite-friends-btn";
    inviteButton.textContent = "دعوة الأصدقاء";
    inviteButton.onclick = () => openInviteFriendsModal("who_am_i", currentRoomCode);
    hostArea.insertBefore(inviteButton, hostArea.firstChild);
}

const originalWhoAmIRenderWaitingRoom = renderWaitingRoom;
renderWaitingRoom = function(data) {
    originalWhoAmIRenderWaitingRoom(data);
    ensureWhoAmIInviteButton();
};

async function maybeAutoJoinWhoAmIInvite() {
    if (!window.appCurrentUser || currentRoomCode || currentPlayerId) return;

    const params = new URLSearchParams(window.location.search);
    const inviteRoom = params.get("invite_room");
    const accepted = params.get("invite_accept");
    if (!inviteRoom || accepted !== "1") return;

    const preferredName = (window.appCurrentUser.display_name || window.appCurrentUser.username || "").trim();
    if (preferredName) {
        currentPlayerName = preferredName;
        localStorage.setItem("whoami_player_name", preferredName);
        const nameInput = document.getElementById("pName");
        if (nameInput) nameInput.value = preferredName;
    }

    const roomInput = document.getElementById("roomInput");
    if (roomInput) roomInput.value = inviteRoom;

    history.replaceState({}, "", location.pathname);
    await joinRoom();
}

document.addEventListener("DOMContentLoaded", () => {
    maybeAutoJoinWhoAmIInvite();
});
