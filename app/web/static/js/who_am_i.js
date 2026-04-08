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
const MAX_CATEGORIES = 12;
let selectedPlayerCount = null;
let selectedCharacter = localStorage.getItem("whoami_character_id") || "char1";
const whoAmICharacterOptions = Array.from({ length: 12 }, (_, i) => `char${i + 1}`);
const playerCountOptions = [2, 3, 4, 5, 6, 7, 8];

const categoryLabels = {
    football_players: "لاعبين كرة قدم",
    countries: "دول",
    animals: "حيوانات",
    cartoon_characters: "شخصيات كرتون",
    historical_figures: "شخصيات تاريخية"
};

document.addEventListener("DOMContentLoaded", async () => {
    renderPlayerCountButtons();
    await loadCategories();
    renderCharacterButtons();

    if (currentPlayerName) {
        document.getElementById("pName").value = currentPlayerName;
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

    const container = document.getElementById("categoryGrid");
    if (!container) return;

    container.innerHTML = "";

    Object.keys(data.categories).forEach((key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.categoryKey = key;
        button.textContent = categoryLabels[key] || key;

        if (selectedCategories.includes(key)) {
            button.classList.add("active");
        }

        button.onclick = () => toggleCategory(key);

        container.appendChild(button);
    });

    updateCategoryButtonsState();
}


function toggleCategory(categoryKey) {
    const isSelected = selectedCategories.includes(categoryKey);

    if (isSelected) {
        selectedCategories = selectedCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedCategories.length >= MAX_CATEGORIES) {
            alert(`يمكنك اختيار ${MAX_CATEGORIES} تصنيفات كحد أقصى`);
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
        alert("الرجاء إدخال اسمك أولاً!");
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
    alert("اختر تصنيفاً واحداً على الأقل!");
    return;
    }
    if (!selectedPlayerCount) {
        alert("اختر عدد اللاعبين أولاً!");
        return;
    }

    const response = await fetch("/api/who-am-i/rooms", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_name: hostName,
            player_count: playerCount,
            categories: selectedCategories,
            character_id: selectedCharacter
        })
    });

    
    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "حدث خطأ أثناء إنشاء الغرفة.");
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

    renderWaitingRoom(data);
}

async function joinRoom() {
    const name = document.getElementById("pName").value.trim();
    const roomCode = document.getElementById("roomInput").value.trim().toUpperCase();

    if (!name || !roomCode) {
        alert("اكمل البيانات!");
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
        alert(data.detail || "تعذر الانضمام إلى الغرفة.");
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

    renderWaitingRoom(data);
}

async function startGame() {
    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/start`, {
        method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر بدء اللعبة.");
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
        alert(data.detail || "تعذر الانتقال للاعب التالي.");
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
        alert("أدخل تخميناً أولاً.");
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
        alert(data.detail || "تعذر إرسال التخمين.");
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
    alert("اختر تصنيفاً واحداً على الأقل!");
    return;
    }

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/restart`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ categories: selectedCategories })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر إعادة اللعبة.");
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
        alert(data.detail || "تعذر الخروج من الغرفة.");
        return;
    }

    clearLocalGameState();
    goBackToLobby();
}

async function deleteCurrentRoom() {
    const confirmed = confirm("هل أنت متأكد أنك تريد حذف الغرفة بالكامل؟");
    if (!confirmed) return;

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/delete`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ player_id: currentPlayerId })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر حذف الغرفة.");
        return;
    }

    clearLocalGameState();
    goBackToLobby();
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
    if (!response.ok) return;

    const data = await response.json();
    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
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
    playerList.innerHTML = "";

    data.players.forEach((player) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${buildWhoAmIPlayerIdentity(player)}</td>
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
        status.textContent = "بانتظار تحديث حالة الكشف...";
        identityBox.textContent = "بانتظار الدور...";
        nextRevealBtn.classList.add("hidden");
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