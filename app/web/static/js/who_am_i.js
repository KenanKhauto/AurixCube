let currentRoomCode = localStorage.getItem("whoami_room_code") || null;
let currentPlayerId = localStorage.getItem("whoami_player_id") || null;
let currentPlayerName = localStorage.getItem("whoami_player_name") || null;
let currentRoomData = null;
let cachedIdentity = "";
let isHost = false;
let currentGuessDraft = "";
let lastRoomSnapshot = null;
let currentPlayerKnowledge = [];

const categoryLabels = {
    football_players: "لاعبين كرة قدم ⚽",
    countries: "دول 🌍",
    animals: "حيوانات 🐾",
    cartoon_characters: "شخصيات كرتون 🎬",
    historical_figures: "شخصيات تاريخية 📜"
};

document.addEventListener("DOMContentLoaded", async () => {
    await loadCategories();

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

async function loadCategories() {
    const response = await fetch("/api/who-am-i/categories");
    const data = await response.json();

    const select = document.getElementById("gameCategory");
    select.innerHTML = "";

    Object.keys(data.categories).forEach((key) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = categoryLabels[key] || key;
        select.appendChild(option);
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
    const playerCount = parseInt(document.getElementById("playerCount").value, 10);
    const category = document.getElementById("gameCategory").value;

    const response = await fetch("/api/who-am-i/rooms", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_name: hostName,
            player_count: playerCount,
            category: category
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
        body: JSON.stringify({ player_name: name })
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
    const category = document.getElementById("gameCategory").value;

    const response = await fetch(`/api/who-am-i/rooms/${currentRoomCode}/restart`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ category: category })
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
        const badge = document.createElement("span");
        badge.style.background = "#333";
        badge.style.padding = "5px 10px";
        badge.style.borderRadius = "5px";
        badge.textContent = player.name;
        playerList.appendChild(badge);
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
        identityElement.textContent = "تم حل هويتك ✅";
    } else {
        identityElement.textContent = "هويتك ما زالت مخفية";
    }

    const guessArea = document.getElementById("guessArea");
    if (me && me.has_guessed_correctly) {
        guessArea.innerHTML = `<p style="color:#aaa;">لقد خمنت هويتك بشكل صحيح. يمكنك متابعة اللعبة كمشاهد 👀</p>`;
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
}

function renderPlayersState(data) {
    const container = document.getElementById("playersState");
    container.innerHTML = "<h4>حالة اللاعبين:</h4>";

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

    sortedPlayers.forEach((player) => {
        const div = document.createElement("div");
        div.className = "vote-item";

        let statusText = "";
        if (player.has_guessed_correctly) {
            statusText = `خمن بشكل صحيح ✅ | عدد المحاولات: ${player.guess_count}`;
        } else {
            statusText = `لم يخمن بعد | عدد المحاولات: ${player.guess_count}`;
        }

        const identityText = player.visible_identity
            ? ` | الهوية: ${player.visible_identity}`
            : ` | الهوية: مخفية`;

        div.innerHTML = `
            <span>${player.name}</span>
            <span>${statusText}${identityText}</span>
        `;
        container.appendChild(div);
    });
}

function renderGameOver(data) {
    hideAll();
    document.getElementById("screen-game-over").classList.remove("hidden");

    document.getElementById("finalMsg").textContent = "تمكن جميع اللاعبين من معرفة هوياتهم 🎉";

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
        <tr>
            <td>${index + 1}</td>
            <td>${player.name}</td>
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