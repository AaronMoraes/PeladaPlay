const API_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ? "http://localhost:5067/api"
  : "https://peladaplay.onrender.com/api";

let token = localStorage.getItem("peladaplay_token") || null;
let currentUser = null;
let myClubs = [];
let cachedVenues = [];
let selectedClubId = localStorage.getItem("peladaplay_club") || null;
let currentClubDetails = null;
let currentMatch = null;
let countdownTimer = null;

const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const FEET = ["Destro", "Canhoto", "Ambidestro"];
const ROLES = ["Jogador", "Sub-Organizador", "Organizador (Admin)"];
const PAYMENT_LABELS = ["Pendente", "Aguardando Baixa", "Pago ✓", "Isento"];

// Registra Service Worker PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

document.addEventListener("DOMContentLoaded", () => {
  if (token) loadDashboard();
});

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3500);
}

async function apiFetch(endpoint, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error("Sessão expirada.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Erro ao processar requisição.");
  return data;
}

// ================= NAVEGAÇÃO ENTRE ABAS =================
function navigateTo(page) {
  document.querySelectorAll(".page-section").forEach(sec => sec.classList.add("hidden"));
  document.getElementById(`page-${page}`).classList.remove("hidden");

  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });

  if (page === "squad" && selectedClubId) loadClubSquad(selectedClubId);
  if (page === "rankings" && selectedClubId) loadClubRankings(selectedClubId);
  if (page === "venues") loadVenues();
  if (page === "profile") renderProfilePage();
}

// ================= AUTENTICAÇÃO =================
function switchAuthTab(tab) {
  document.getElementById("tab-login").classList.toggle("active", tab === "login");
  document.getElementById("tab-register").classList.toggle("active", tab === "register");
  document.getElementById("login-form").classList.toggle("hidden", tab !== "login");
  document.getElementById("register-form").classList.toggle("hidden", tab !== "register");
}

async function handleLogin(e) {
  e.preventDefault();
  try {
    const res = await apiFetch("/Auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("login-email").value,
        password: document.getElementById("login-password").value
      })
    });
    token = res.token;
    localStorage.setItem("peladaplay_token", token);
    showToast(`Bem-vindo, ${res.fullName}!`);
    loadDashboard();
  } catch (err) {
    showToast(err.message);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  try {
    const res = await apiFetch("/Auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: document.getElementById("reg-name").value,
        email: document.getElementById("reg-email").value,
        password: document.getElementById("reg-password").value,
        position: document.getElementById("reg-position").value,
        preferredFoot: Number(document.getElementById("reg-foot").value),
        shirtNumber: Number(document.getElementById("reg-shirt").value)
      })
    });
    token = res.token;
    localStorage.setItem("peladaplay_token", token);
    showToast("PRO ID criado com sucesso!");
    loadDashboard();
  } catch (err) {
    showToast(err.message);
  }
}

function logout() {
  token = null;
  localStorage.removeItem("peladaplay_token");
  document.getElementById("app-view").classList.add("hidden");
  document.getElementById("auth-view").classList.remove("hidden");
}

// ================= DASHBOARD & CLUBES =================
async function loadDashboard() {
  try {
    document.getElementById("auth-view").classList.add("hidden");
    document.getElementById("app-view").classList.remove("hidden");

    currentUser = await apiFetch("/Auth/me");
    renderProfileSummary();
    renderProfilePage();

    cachedVenues = await apiFetch("/Venues");
    myClubs = await apiFetch("/Clubs/my");

    const selector = document.getElementById("club-selector");
    selector.innerHTML = myClubs.length
      ? myClubs.map(c => `<option value="${c.id}">${c.name}</option>`).join("")
      : `<option value="">Nenhum clube ainda</option>`;

    if (myClubs.length > 0) {
      const validClub = myClubs.find(c => c.id === selectedClubId) ? selectedClubId : myClubs[0].id;
      selector.value = validClub;
      await selectClub(validClub);
    }
  } catch (err) {
    showToast(err.message);
  }
}

function renderProfileSummary() {
  document.getElementById("home-pro-name").textContent = currentUser.fullName;
  document.getElementById("home-pro-shirt").textContent = `#${currentUser.shirtNumber}`;
  document.getElementById("home-pro-meta").textContent = `${currentUser.position} • ${FEET[currentUser.preferredFoot]}`;
  document.getElementById("home-stat-matches").textContent = currentUser.stats.matches;
  document.getElementById("home-stat-goals").textContent = currentUser.stats.goals;
  document.getElementById("home-stat-assists").textContent = currentUser.stats.assists;
}

async function selectClub(clubId) {
  if (!clubId) return;
  selectedClubId = clubId;
  localStorage.setItem("peladaplay_club", clubId);
  document.getElementById("match-detail-panel").classList.add("hidden");

  const club = myClubs.find(c => c.id === clubId);
  if (!club) return;

  document.getElementById("club-title").textContent = club.name;
  document.getElementById("club-role-badge").textContent = ROLES[club.myRole].toUpperCase();
  document.getElementById("club-invite-code").textContent = `CONVITE: ${club.inviteCode}`;
  document.getElementById("club-schedule").textContent =
    `${DAYS[club.dayOfWeek]} às ${club.startTime} • ${club.expectedPlayers} vagas (${club.playersPerTeam}x${club.playersPerTeam})` +
    (club.defaultVenue ? ` • 📍 ${club.defaultVenue.name}` : "");
  document.getElementById("club-reserve").textContent = `R$ ${Number(club.cashReserve).toFixed(2)}`;

  const canManage = club.myRole >= 1;
  const isAdmin = club.myRole === 2;
  const dayLabel = DAYS[club.dayOfWeek];

  const quickHomeBtn = document.getElementById("btn-quick-next-match");
  const quickPageBtn = document.getElementById("btn-quick-next-match-page");
  quickHomeBtn.textContent = `⚡ Agendar ${dayLabel} (${club.startTime})`;
  quickPageBtn.textContent = `⚡ Agendar ${dayLabel} (${club.startTime})`;

  quickHomeBtn.classList.toggle("hidden", !canManage);
  quickPageBtn.classList.toggle("hidden", !canManage);
  document.getElementById("btn-new-match-home").classList.toggle("hidden", !canManage);
  document.getElementById("btn-new-match-page").classList.toggle("hidden", !canManage);
  document.getElementById("btn-club-settings").classList.toggle("hidden", !isAdmin);

  await loadClubMatches(clubId);
}

function copyInviteCode() {
  const club = myClubs.find(c => c.id === selectedClubId);
  if (!club) return;
  navigator.clipboard.writeText(club.inviteCode);
  showToast(`Código ${club.inviteCode} copiado!`);
}

async function openClubModal() {
  cachedVenues = await apiFetch("/Venues");
  const select = document.getElementById("new-club-venue");
  select.innerHTML = `<option value="">Sem quadra fixa</option>` +
    cachedVenues.map(v => `<option value="${v.id}">${v.name}</option>`).join("");
  openModal("modal-club");
}

async function handleCreateClub(e) {
  e.preventDefault();
  const venueId = document.getElementById("new-club-venue").value || null;
  try {
    const res = await apiFetch("/Clubs", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("new-club-name").value,
        dayOfWeek: Number(document.getElementById("new-club-day").value),
        startTime: document.getElementById("new-club-time").value,
        durationMinutes: 90,
        expectedPlayers: Number(document.getElementById("new-club-players").value),
        playersPerTeam: Number(document.getElementById("new-club-per-team").value),
        goalkeepersPay: document.getElementById("new-club-gk-pay").checked,
        defaultVenueId: venueId
      })
    });
    closeModal("modal-club");
    selectedClubId = res.id;
    showToast(`Clube "${res.name}" criado! Código: ${res.inviteCode}`);
    await loadDashboard();
  } catch (err) {
    showToast(err.message);
  }
}

async function handleJoinClub(e) {
  e.preventDefault();
  try {
    const code = document.getElementById("invite-code-input").value;
    const res = await apiFetch(`/Clubs/join/${encodeURIComponent(code)}`, { method: "POST" });
    closeModal("modal-club");
    selectedClubId = res.id;
    showToast(res.message);
    await loadDashboard();
  } catch (err) {
    showToast(err.message);
  }
}

// ================= CONFIGURAÇÕES & CAIXINHA DO CLUBE =================
function openClubSettingsModal() {
  const club = myClubs.find(c => c.id === selectedClubId);
  if (!club) return;
  document.getElementById("set-club-name").value = club.name;
  document.getElementById("set-club-day").value = club.dayOfWeek;
  document.getElementById("set-club-time").value = club.startTime;
  document.getElementById("set-club-players").value = club.expectedPlayers;
  document.getElementById("set-club-per-team").value = club.playersPerTeam;
  document.getElementById("set-club-gk-pay").checked = club.goalkeepersPay;
  openModal("modal-club-settings");
}

async function handleUpdateClubSettings(e) {
  e.preventDefault();
  try {
    const res = await apiFetch(`/Clubs/${selectedClubId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: document.getElementById("set-club-name").value,
        dayOfWeek: Number(document.getElementById("set-club-day").value),
        startTime: document.getElementById("set-club-time").value,
        expectedPlayers: Number(document.getElementById("set-club-players").value),
        playersPerTeam: Number(document.getElementById("set-club-per-team").value),
        goalkeepersPay: document.getElementById("set-club-gk-pay").checked
      })
    });
    closeModal("modal-club-settings");
    showToast(res.message);
    await loadDashboard();
  } catch (err) {
    showToast(err.message);
  }
}

async function handleAdjustReserve(e) {
  e.preventDefault();
  const op = document.getElementById("reserve-op").value;
  const amount = Number(document.getElementById("reserve-amount").value);
  const delta = op === "withdraw" ? -amount : amount;
  try {
    const res = await apiFetch(`/Clubs/${selectedClubId}/cash-reserve`, {
      method: "PATCH",
      body: JSON.stringify({ delta })
    });
    document.getElementById("reserve-amount").value = "";
    closeModal("modal-club-settings");
    showToast(res.message);
    await loadDashboard();
  } catch (err) {
    showToast(err.message);
  }
}

// ================= PARTIDAS, RECORRÊNCIA & PIX =================
async function loadClubMatches(clubId) {
  const matches = await apiFetch(`/Matches/club/${clubId}`);
  const container = document.getElementById("matches-list");
  const homeHighlight = document.getElementById("home-next-match");

  if (!matches.length) {
    container.innerHTML = `<p class="muted-text">Nenhuma partida agendada neste clube ainda.</p>`;
    homeHighlight.innerHTML = `<p class="muted-text">Nenhuma partida agendada para este clube.</p>`;
    return;
  }

  const next = matches[0];
  const nextDt = new Date(next.matchDateTime).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
  const nextStatus = next.status === 0 ? "Lista Aberta" : next.status === 1 ? "Pix Aberto (24h)" : "Finalizada";
  homeHighlight.innerHTML = `
    <div class="roster-row">
      <div>
        <span class="badge-neon">${nextStatus}</span>
        <h4 style="margin-top:6px;">${nextDt}</h4>
        <p class="muted-text">${next.confirmedCount} confirmados • ${next.waitlistCount} espera • Quadra R$ ${Number(next.courtCost).toFixed(2)}</p>
      </div>
      <button class="btn-primary" onclick="goToMatchFromHome('${next.id}')">Abrir Lista & Pix</button>
    </div>
  `;

  container.innerHTML = matches.map(m => {
    const dt = new Date(m.matchDateTime).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const statusText = m.status === 0 ? "Lista Aberta" : m.status === 1 ? "Pix Aberto" : "Finalizada";
    return `
      <div class="match-item" onclick="openMatchDetails('${m.id}')">
        <div class="card-top">
          <span class="badge-neon">${statusText}</span>
          <span class="mono-tag">R$ ${Number(m.courtCost).toFixed(2)}</span>
        </div>
        <h4>${dt}</h4>
        <p class="muted-text">${m.confirmedCount} confirmados • ${m.waitlistCount} espera • ${m.paidCount} pagos</p>
      </div>
    `;
  }).join("");
}

async function goToMatchFromHome(matchId) {
  navigateTo("matches");
  await openMatchDetails(matchId);
}

function getNextClubOccurrenceISO(club) {
  const now = new Date();
  const [hours, minutes] = club.startTime.split(":").map(Number);
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  let diffDays = (club.dayOfWeek - now.getDay() + 7) % 7;
  if (diffDays === 0 && target <= now) {
    diffDays = 7;
  }
  target.setDate(now.getDate() + diffDays);

  const pad = n => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(hours)}:${pad(minutes)}`;
}

async function quickScheduleNextWeeklyMatch() {
  const club = myClubs.find(c => c.id === selectedClubId);
  if (!club) return;

  const nextDateTime = getNextClubOccurrenceISO(club);
  const defaultCost = club.defaultVenue?.defaultPrice ? Number(club.defaultVenue.defaultPrice) : 300.00;

  try {
    const res = await apiFetch("/Matches", {
      method: "POST",
      body: JSON.stringify({
        clubId: club.id,
        matchDateTime: nextDateTime,
        courtCost: defaultCost,
        pixReceiverName: currentUser.fullName,
        pixKey: currentUser.phone || currentUser.email
      })
    });
    showToast(`Pelada fixa de ${DAYS[club.dayOfWeek]} agendada!`);
    navigateTo("matches");
    await loadClubMatches(club.id);
    await openMatchDetails(res.id);
  } catch (err) {
    showToast(err.message);
  }
}

async function openMatchModal() {
  cachedVenues = await apiFetch("/Venues");
  const select = document.getElementById("match-venue-select");
  select.innerHTML = `<option value="">Digitar valor manualmente</option>` +
    cachedVenues.map(v => `<option value="${v.id}">${v.name} ${v.defaultPrice ? `(R$ ${Number(v.defaultPrice).toFixed(2)})` : "(Sob consulta)"}</option>`).join("");

  const club = myClubs.find(c => c.id === selectedClubId);
  if (club) {
    document.getElementById("match-datetime").value = getNextClubOccurrenceISO(club);
    if (club.defaultVenue) {
      select.value = club.defaultVenue.id;
      applyVenuePriceToMatch(club.defaultVenue.id);
    }
  }
  openModal("modal-match");
}

function applyVenuePriceToMatch(venueId) {
  const venue = cachedVenues.find(v => v.id === venueId);
  if (venue && venue.defaultPrice) {
    document.getElementById("match-cost").value = Number(venue.defaultPrice).toFixed(2);
  }
}

async function handleCreateMatch(e) {
  e.preventDefault();
  try {
    const res = await apiFetch("/Matches", {
      method: "POST",
      body: JSON.stringify({
        clubId: selectedClubId,
        matchDateTime: document.getElementById("match-datetime").value,
        courtCost: Number(document.getElementById("match-cost").value),
        pixReceiverName: document.getElementById("match-pix-name").value,
        pixKey: document.getElementById("match-pix-key").value
      })
    });
    closeModal("modal-match");
    showToast(res.message);
    navigateTo("matches");
    await loadClubMatches(selectedClubId);
    await openMatchDetails(res.id);
  } catch (err) {
    showToast(err.message);
  }
}

async function openMatchDetails(matchId) {
  currentMatch = await apiFetch(`/Matches/${matchId}`);
  const panel = document.getElementById("match-detail-panel");
  panel.classList.remove("hidden");

  const canManage = currentMatch.myRole >= 1;
  const dt = new Date(currentMatch.matchDateTime).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
  const statusMap = { 0: "LISTA ABERTA (VALOR ESTIMADO)", 1: "JANELA PIX ABERTA (VALOR CONGELADO)", 3: "SÚMULA VALIDADA" };

  document.getElementById("detail-status-badge").textContent = statusMap[currentMatch.status] || "EM ANDAMENTO";
  document.getElementById("detail-title").textContent = `${currentMatch.clubName} — ${dt}`;
  document.getElementById("detail-subtitle").textContent =
    `Quadra: R$ ${Number(currentMatch.courtCost).toFixed(2)} • Vagas: ${currentMatch.expectedPlayers}`;

  updatePixCountdown();
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(updatePixCountdown, 60000);

  document.getElementById("fin-per-player").textContent = `R$ ${Number(currentMatch.financialSummary.estimatedPerPlayer).toFixed(2)}`;
  document.getElementById("fin-collected").textContent = `R$ ${Number(currentMatch.financialSummary.totalCollected).toFixed(2)}`;
  document.getElementById("fin-surplus").textContent = `R$ ${Number(currentMatch.financialSummary.surplusToReserve).toFixed(2)}`;
  document.getElementById("fin-pix-key").textContent = currentMatch.pixKey
    ? `${currentMatch.pixKey} (${currentMatch.pixReceiverName || ""})`
    : "Não informada";

  document.getElementById("btn-open-pix").classList.toggle("hidden", !canManage || currentMatch.status !== 0);
  document.getElementById("btn-draw-teams").classList.toggle("hidden", !canManage);
  document.getElementById("guest-bar").classList.toggle("hidden", !canManage);
  document.getElementById("sumula-admin-bar").classList.toggle("hidden", !canManage);

  renderRoster();
  renderTeams();
  renderSumula();
  panel.scrollIntoView({ behavior: "smooth" });
}

function updatePixCountdown() {
  if (!currentMatch) return;
  const el = document.getElementById("detail-pix-countdown");
  if (currentMatch.status === 1) {
    el.textContent = "✅ Janela Pix Ativa";
    return;
  }
  if (currentMatch.status >= 3) {
    el.textContent = "🏁 Partida Encerrada";
    return;
  }
  const matchTime = new Date(currentMatch.matchDateTime).getTime();
  const pixOpenTime = matchTime - 24 * 60 * 60 * 1000;
  const diffMs = pixOpenTime - Date.now();
  if (diffMs <= 0) {
    el.textContent = "⚡ Pix abrindo automaticamente...";
  } else {
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    el.textContent = `⏳ Pix automático em ${hrs}h ${mins}m`;
  }
}

function copyMatchPixKey() {
  if (!currentMatch?.pixKey) return;
  navigator.clipboard.writeText(currentMatch.pixKey);
  showToast("Chave Pix copiada!");
}

function openPixPaymentModal(regId, amount) {
  document.getElementById("pix-modal-amount").textContent = `R$ ${Number(amount).toFixed(2)}`;
  document.getElementById("pix-modal-receiver").textContent =
    `Recebedor: ${currentMatch.pixReceiverName || "Organizador do Clube"}`;
  document.getElementById("pix-modal-key").value = currentMatch.pixKey || "Solicitar chave ao organizador";
  document.getElementById("pix-modal-confirm-btn").onclick = async () => {
    closeModal("modal-pix");
    await notifyPaid(regId);
  };
  openModal("modal-pix");
}

function copyPixFromModal() {
  const key = document.getElementById("pix-modal-key").value;
  navigator.clipboard.writeText(key);
  showToast("Chave Pix copiada para a área de transferência!");
}

function copyWhatsAppRoster() {
  if (!currentMatch) return;
  const dt = new Date(currentMatch.matchDateTime).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const mains = currentMatch.registrations.filter(r => !r.isWaitlist);
  const waits = currentMatch.registrations.filter(r => r.isWaitlist);

  let text = `⚽ *${currentMatch.clubName}* — ${dt}\n`;
  text += `💰 Cota: R$ ${Number(currentMatch.financialSummary.estimatedPerPlayer).toFixed(2)}\n\n`;
  text += `*CONFIRMADOS (${mains.length}/${currentMatch.expectedPlayers}):*\n`;
  mains.forEach((p, i) => {
    const payIcon = p.paymentStatus === 2 ? "✅" : p.paymentStatus === 3 ? "🧤" : "⏳";
    text += `${i + 1}. ${p.displayName} ${p.isGoalkeeper ? "(GOL)" : ""} ${payIcon}\n`;
  });

  if (waits.length) {
    text += `\n*FILA DE ESPERA (${waits.length}):*\n`;
    waits.forEach((p, i) => {
      text += `${i + 1}. ${p.displayName}\n`;
    });
  }

  navigator.clipboard.writeText(text);
  showToast("Lista formatada copiada para colar no WhatsApp!");
}

async function joinCurrentMatch(isGoalkeeper) {
  try {
    const res = await apiFetch(`/Matches/${currentMatch.id}/join`, {
      method: "POST",
      body: JSON.stringify({ isGoalkeeper })
    });
    showToast(res.message);
    await openMatchDetails(currentMatch.id);
    await loadClubMatches(selectedClubId);
  } catch (err) {
    showToast(err.message);
  }
}

async function addGuest() {
  const input = document.getElementById("guest-name-input");
  if (!input.value.trim()) return;
  try {
    const res = await apiFetch(`/Matches/${currentMatch.id}/guests`, {
      method: "POST",
      body: JSON.stringify({
        guestName: input.value,
        isGoalkeeper: document.getElementById("guest-gk-input").checked
      })
    });
    input.value = "";
    showToast(res.message);
    await openMatchDetails(currentMatch.id);
  } catch (err) {
    showToast(err.message);
  }
}

async function leaveMatch(regId) {
  try {
    const res = await apiFetch(`/Matches/${currentMatch.id}/leave/${regId}`, { method: "DELETE" });
    showToast(res.message);
    await openMatchDetails(currentMatch.id);
    await loadClubMatches(selectedClubId);
  } catch (err) {
    showToast(err.message);
  }
}

async function openPixWindow() {
  try {
    const res = await apiFetch(`/Matches/${currentMatch.id}/open-pix`, { method: "POST" });
    showToast(res.message);
    await openMatchDetails(currentMatch.id);
    await loadClubMatches(selectedClubId);
  } catch (err) {
    showToast(err.message);
  }
}

async function notifyPaid(regId) {
  try {
    const res = await apiFetch(`/Matches/${currentMatch.id}/registrations/${regId}/notify-paid`, { method: "POST" });
    showToast(res.message);
    await openMatchDetails(currentMatch.id);
  } catch (err) {
    showToast(err.message);
  }
}

async function confirmPayment(regId, status) {
  try {
    const res = await apiFetch(`/Matches/${currentMatch.id}/registrations/${regId}/payment`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    showToast(res.message);
    await openMatchDetails(currentMatch.id);
    await loadClubMatches(selectedClubId);
  } catch (err) {
    showToast(err.message);
  }
}

function renderRoster() {
  const canManage = currentMatch.myRole >= 1;
  const list = document.getElementById("roster-list");

  if (!currentMatch.registrations.length) {
    list.innerHTML = `<p class="muted-text">Nenhum jogador na lista ainda. Clique em "Tô Dentro"!</p>`;
    return;
  }

  list.innerHTML = currentMatch.registrations.map((r, idx) => {
    const isMe = r.userId === currentUser.id;
    return `
      <div class="roster-row ${r.isWaitlist ? "waitlist" : ""}">
        <div>
          <strong>${idx + 1}. ${r.displayName}</strong>
          <span class="muted-text"> • ${r.isGoalkeeper ? "🧤 Goleiro" : "⚽ Linha"} • ${"★".repeat(r.skillRank)}</span>
          ${r.isWaitlist ? `<span class="badge-titanium">FILA DE ESPERA</span>` : ""}
        </div>
        <div class="roster-badges">
          <span class="mono-tag">R$ ${Number(r.amountToPay).toFixed(2)}</span>
          <span class="badge-titanium">${PAYMENT_LABELS[r.paymentStatus]}</span>
          ${isMe && !r.isWaitlist && r.paymentStatus === 0
            ? `<button class="btn-primary btn-sm" onclick="openPixPaymentModal('${r.id}', ${r.amountToPay})">Pagar Pix</button>` : ""}
          ${canManage && !r.isWaitlist && r.paymentStatus !== 2 && r.paymentStatus !== 3
            ? `<button class="btn-primary btn-sm" onclick="confirmPayment('${r.id}', 2)">Baixar Pix</button>` : ""}
          ${(isMe || canManage)
            ? `<button class="btn-danger-ghost btn-sm" onclick="leaveMatch('${r.id}')">Remover</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

// ================= SORTEIO & TROCA MANUAL DE TIMES =================
async function drawTeams() {
  try {
    const numTeams = Math.max(2, Math.floor(currentMatch.expectedPlayers / currentMatch.playersPerTeam));
    const res = await apiFetch(`/Matches/${currentMatch.id}/draw-teams`, {
      method: "POST",
      body: JSON.stringify({ numberOfTeams: numTeams })
    });
    showToast(res.message);
    await openMatchDetails(currentMatch.id);
  } catch (err) {
    showToast(err.message);
  }
}

async function movePlayerTeam(regId, newTeam) {
  try {
    const res = await apiFetch(`/Matches/${currentMatch.id}/registrations/${regId}/team`, {
      method: "PATCH",
      body: JSON.stringify({ teamAssigned: newTeam })
    });
    showToast(res.message);
    await openMatchDetails(currentMatch.id);
  } catch (err) {
    showToast(err.message);
  }
}

function renderTeams() {
  const canManage = currentMatch.myRole >= 1;
  const grid = document.getElementById("teams-grid");
  const assigned = currentMatch.registrations.filter(r => !r.isWaitlist && r.teamAssigned);

  if (!assigned.length) {
    grid.innerHTML = `<p class="muted-text">Os times ainda não foram sorteados.</p>`;
    return;
  }

  const teamNames = [...new Set(assigned.map(p => p.teamAssigned))].sort();
  const groups = {};
  teamNames.forEach(t => (groups[t] = assigned.filter(p => p.teamAssigned === t)));

  grid.innerHTML = Object.entries(groups).map(([team, players]) => `
    <div class="team-box">
      <h4>${team} (${players.length})</h4>
      <ul>
        ${players.map(p => `
          <li style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
            <span>${p.isGoalkeeper ? "🧤" : "⚽"} ${p.displayName} (${"★".repeat(p.skillRank)})</span>
            ${canManage ? `
              <select class="btn-sm" style="width:auto; padding:3px 6px;" onchange="movePlayerTeam('${p.id}', this.value)">
                ${teamNames.map(t => `<option value="${t}" ${t === team ? "selected" : ""}>${t}</option>`).join("")}
              </select>
            ` : ""}
          </li>
        `).join("")}
      </ul>
    </div>
  `).join("");
}

// ================= SÚMULA INTELIGENTE =================
async function createGame() {
  try {
    await apiFetch(`/Matches/${currentMatch.id}/games`, {
      method: "POST",
      body: JSON.stringify({
        title: document.getElementById("game-title").value,
        teamLeft: document.getElementById("game-left").value,
        teamRight: document.getElementById("game-right").value
      })
    });
    showToast("Jogo adicionado na súmula!");
    await openMatchDetails(currentMatch.id);
  } catch (err) {
    showToast(err.message);
  }
}

async function addGoal(gameId, teamName) {
  const scorerId = document.getElementById(`scorer-${gameId}`).value;
  const assistId = document.getElementById(`assist-${gameId}`).value || null;
  if (!scorerId) return;

  try {
    await apiFetch(`/Matches/${currentMatch.id}/games/${gameId}/goals`, {
      method: "POST",
      body: JSON.stringify({ teamName, scorerRegistrationId: scorerId, assistRegistrationId: assistId })
    });
    showToast(`Gol registrado para ${teamName}!`);
    await openMatchDetails(currentMatch.id);
  } catch (err) {
    showToast(err.message);
  }
}

async function validateSumula() {
  try {
    const res = await apiFetch(`/Matches/${currentMatch.id}/validate-sumula`, { method: "POST" });
    showToast(res.message);
    await loadDashboard();
    await openMatchDetails(currentMatch.id);
  } catch (err) {
    showToast(err.message);
  }
}

function renderSumula() {
  const canManage = currentMatch.myRole >= 1;
  const container = document.getElementById("games-list");
  const assignedTeams = [...new Set(currentMatch.registrations.filter(r => r.teamAssigned).map(r => r.teamAssigned))].sort();
  const teamOptions = assignedTeams.length ? assignedTeams : ["Time A", "Time B", "Time C"];

  document.getElementById("game-title").value = `Jogo ${currentMatch.games.length + 1}`;
  document.getElementById("game-left").innerHTML = teamOptions.map(t => `<option value="${t}">${t}</option>`).join("");
  document.getElementById("game-right").innerHTML = teamOptions.map((t, i) => `<option value="${t}" ${i === 1 ? "selected" : ""}>${t}</option>`).join("");

  const playersOptions = currentMatch.registrations
    .filter(r => !r.isWaitlist)
    .map(r => `<option value="${r.id}">${r.displayName}</option>`)
    .join("");

  if (!currentMatch.games.length) {
    container.innerHTML = `<p class="muted-text">Nenhum jogo lançado na súmula ainda.</p>`;
    return;
  }

  container.innerHTML = currentMatch.games.map(g => `
    <div class="game-card">
      <div class="card-top">
        <strong>${g.title}</strong>
        <span class="badge-titanium">${currentMatch.isSumulaValidated ? "VALIDADO ✓" : "RASCUNHO"}</span>
      </div>
      <div class="scoreboard">
        <span>${g.teamLeft}</span>
        <span class="neon-text">${g.scoreLeft} x ${g.scoreRight}</span>
        <span>${g.teamRight}</span>
      </div>
      ${canManage && !currentMatch.isSumulaValidated ? `
        <div class="guest-bar">
          <select id="scorer-${g.id}">${playersOptions}</select>
          <select id="assist-${g.id}"><option value="">Sem assistência</option>${playersOptions}</select>
          <button class="btn-secondary btn-sm" onclick="addGoal('${g.id}', '${g.teamLeft}')">+ Gol ${g.teamLeft}</button>
          <button class="btn-secondary btn-sm" onclick="addGoal('${g.id}', '${g.teamRight}')">+ Gol ${g.teamRight}</button>
        </div>
      ` : ""}
      <div class="muted-text">
        ${g.goals.map(gl => `⚽ ${gl.scorerName} (${gl.teamName})${gl.assistName ? ` • Assist: ${gl.assistName}` : ""}`).join("<br/>")}
      </div>
    </div>
  `).join("");
}

// ================= ELENCO & PERMISSÕES CONTEXTUAIS =================
async function loadClubSquad(clubId) {
  currentClubDetails = await apiFetch(`/Clubs/${clubId}`);
  const isAdmin = currentClubDetails.myRole === 2;
  const canManage = currentClubDetails.myRole >= 1;

  document.getElementById("squad-count-badge").textContent = `${currentClubDetails.members.length} atletas`;
  const list = document.getElementById("squad-list");

  list.innerHTML = currentClubDetails.members.map(m => `
    <div class="roster-row">
      <div>
        <strong>${m.fullName}</strong>
        <span class="muted-text"> • ${m.position} • ${m.isGoalkeeper ? "🧤 Goleiro" : "Linha"}</span>
        <div style="margin-top:4px;">
          <span class="badge-titanium">${ROLES[m.role]}</span>
          <span class="neon-text" style="margin-left:8px;">${"★".repeat(m.skillRank)}${"☆".repeat(5 - m.skillRank)}</span>
        </div>
      </div>
      <div class="roster-badges">
        ${canManage ? `
          <select class="btn-sm" style="width:auto;" onchange="updateMemberRank('${m.memberId}', this.value, ${m.isGoalkeeper})">
            ${[1,2,3,4,5].map(s => `<option value="${s}" ${m.skillRank === s ? "selected" : ""}>${s}★</option>`).join("")}
          </select>
          <button class="btn-secondary btn-sm" onclick="updateMemberRank('${m.memberId}', ${m.skillRank}, ${!m.isGoalkeeper})">
            ${m.isGoalkeeper ? "Virar Linha" : "Virar Goleiro"}
          </button>
        ` : ""}
        ${isAdmin && m.role !== 2 ? `
          <button class="btn-warning btn-sm" onclick="toggleSubOrg('${m.memberId}', ${m.role === 1 ? 0 : 1})">
            ${m.role === 1 ? "Remover SubOrg" : "Promover SubOrg"}
          </button>
        ` : ""}
      </div>
    </div>
  `).join("");
}

async function updateMemberRank(memberId, skillRank, isGoalkeeper) {
  try {
    const res = await apiFetch(`/Clubs/${selectedClubId}/members/${memberId}/stats`, {
      method: "PATCH",
      body: JSON.stringify({ skillRank: Number(skillRank), isGoalkeeper })
    });
    showToast(res.message);
    await loadClubSquad(selectedClubId);
  } catch (err) {
    showToast(err.message);
  }
}

async function toggleSubOrg(memberId, newRole) {
  try {
    const res = await apiFetch(`/Clubs/${selectedClubId}/members/${memberId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role: newRole })
    });
    showToast(res.message);
    await loadClubSquad(selectedClubId);
  } catch (err) {
    showToast(err.message);
  }
}

// ================= RANKINGS =================
async function loadClubRankings(clubId) {
  const ranking = await apiFetch(`/Matches/club/${clubId}/rankings`);
  const list = document.getElementById("rankings-list");

  if (!ranking.length) {
    list.innerHTML = `<p class="muted-text">Nenhum dado registrado ainda.</p>`;
    return;
  }

  list.innerHTML = ranking.map((p, idx) => `
    <div class="roster-row">
      <div>
        <span class="mono-tag">#${idx + 1}</span>
        <strong style="margin-left:8px;">${p.fullName}</strong>
        <span class="muted-text"> • ${p.position} • ${p.matches} jogos</span>
      </div>
      <div class="roster-badges">
        <span class="badge-neon">${p.goals} Gols</span>
        <span class="badge-titanium">${p.assists} Assist.</span>
        <span class="mono-tag">${p.totalContributions} G+A</span>
      </div>
    </div>
  `).join("");
}

// ================= LOCAIS / QUADRAS =================
async function loadVenues() {
  cachedVenues = await apiFetch("/Venues");
  document.getElementById("venues-count").textContent = `${cachedVenues.length} locais`;
  renderVenuesList(cachedVenues);
}

function filterVenuesList() {
  const q = document.getElementById("venue-search").value.toLowerCase();
  const filtered = cachedVenues.filter(v =>
    v.name.toLowerCase().includes(q) || v.address.toLowerCase().includes(q)
  );
  renderVenuesList(filtered);
}

function renderVenuesList(venues) {
  const list = document.getElementById("venues-list");
  if (!venues.length) {
    list.innerHTML = `<p class="muted-text">Nenhuma quadra encontrada.</p>`;
    return;
  }
  list.innerHTML = venues.map(v => `
    <div class="roster-row">
      <div>
        <strong>${v.name}</strong>
        <p class="muted-text">${v.address}</p>
      </div>
      <span class="mono-tag">${v.isPriceOnRequest ? "Sob consulta" : `R$ ${Number(v.defaultPrice).toFixed(2)}`}</span>
    </div>
  `).join("");
}

async function handleCreateVenue(e) {
  e.preventDefault();
  const priceVal = document.getElementById("venue-price").value;
  try {
    await apiFetch("/Venues", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("venue-name").value,
        address: document.getElementById("venue-address").value,
        defaultPrice: priceVal ? Number(priceVal) : null
      })
    });
    document.getElementById("venue-name").value = "";
    document.getElementById("venue-address").value = "";
    document.getElementById("venue-price").value = "";
    showToast("Quadra cadastrada com sucesso!");
    await loadVenues();
  } catch (err) {
    showToast(err.message);
  }
}

// ================= PERFIL PRO ID =================
function renderProfilePage() {
  if (!currentUser) return;
  document.getElementById("prof-name").textContent = currentUser.fullName;
  document.getElementById("prof-email").textContent = currentUser.email;
  document.getElementById("prof-shirt").textContent = `#${currentUser.shirtNumber}`;
  document.getElementById("prof-meta").textContent =
    `${currentUser.position} • ${FEET[currentUser.preferredFoot]}${currentUser.city ? ` • ${currentUser.city}` : ""}`;

  const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.fullName)}&background=00F5A0&color=061014&bold=true`;
  document.getElementById("prof-avatar").src = currentUser.photoUrl || fallbackAvatar;

  document.getElementById("prof-stat-matches").textContent = currentUser.stats.matches;
  document.getElementById("prof-stat-goals").textContent = currentUser.stats.goals;
  document.getElementById("prof-stat-assists").textContent = currentUser.stats.assists;
  document.getElementById("prof-stat-avg").textContent = currentUser.stats.contributionsPerGame;

  document.getElementById("edit-name").value = currentUser.fullName;
  document.getElementById("edit-position").value = currentUser.position;
  document.getElementById("edit-foot").value = currentUser.preferredFoot;
  document.getElementById("edit-shirt").value = currentUser.shirtNumber;
  document.getElementById("edit-city").value = currentUser.city || "";
  document.getElementById("edit-phone").value = currentUser.phone || "";
  document.getElementById("edit-photo").value = currentUser.photoUrl || "";

  const clubsList = document.getElementById("prof-clubs-list");
  clubsList.innerHTML = currentUser.clubs.length
    ? currentUser.clubs.map(c => `
        <div class="roster-row">
          <strong>${c.clubName}</strong>
          <div>
            <span class="badge-titanium">${ROLES[c.role]}</span>
            <span class="neon-text" style="margin-left:8px;">${"★".repeat(c.skillRank)}</span>
          </div>
        </div>
      `).join("")
    : `<p class="muted-text">Você ainda não participa de nenhum clube.</p>`;
}

async function handleUpdateProfile(e) {
  e.preventDefault();
  try {
    const res = await apiFetch("/Auth/me", {
      method: "PUT",
      body: JSON.stringify({
        fullName: document.getElementById("edit-name").value,
        position: document.getElementById("edit-position").value,
        preferredFoot: Number(document.getElementById("edit-foot").value),
        shirtNumber: Number(document.getElementById("edit-shirt").value),
        city: document.getElementById("edit-city").value || null,
        phone: document.getElementById("edit-phone").value || null,
        photoUrl: document.getElementById("edit-photo").value || null
      })
    });
    showToast(res.message);
    currentUser = await apiFetch("/Auth/me");
    renderProfileSummary();
    renderProfilePage();
  } catch (err) {
    showToast(err.message);
  }
}

// ================= HELPERS =================
function switchInnerTab(tabName, btn) {
  document.querySelectorAll(".inner-tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".inner-content").forEach(c => c.classList.add("hidden"));
  btn.classList.add("active");
  document.getElementById(`tab-${tabName}`).classList.remove("hidden");
}

function openModal(id) { document.getElementById(id).classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}