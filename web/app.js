// Mão Robótica Pedra-Papel-Tesoura — lógica da página estática
// Câmera + MediaPipe HandLandmarker (deteção do gesto) + Web Serial (Arduino)
// Todos os parâmetros de calibração ficam salvos em localStorage.

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// ---------------------------------------------------------------------------
// Configuração / localStorage
// ---------------------------------------------------------------------------

const CONFIG_KEY = "rps_hand_config_v1";
const FINGER_ORDER = ["polegar", "indicador", "medio", "anelar", "mindinho"];
const FINGER_LABEL = {
  polegar: "Polegar",
  indicador: "Indicador",
  medio: "Médio",
  anelar: "Anelar",
  mindinho: "Mindinho",
};

// Servo posicional (180°): valores em graus (0-180), guardados como
// posicao final direta de cada dedo.
function defaultServos180() {
  const servos = {};
  for (const f of FINGER_ORDER) {
    servos[f] = { zero: 0, open: 0, closed: 90 };
  }
  return servos;
}

// Servo de rotacao continua (360°): "zero"/"open"/"closed" sao duracoes em
// ms (sem sinal) do pulso a partir da referencia aberta; "valorAbrir" e
// "valorFechar" sao os valores brutos do servo (0-180, velocidade+sentido)
// enquanto o pulso dura; "valorParado" e o valor que faz o servo nao girar.
function defaultServos360() {
  const servos = {};
  for (const f of FINGER_ORDER) {
    servos[f] = {
      valorAbrir: 180,
      valorFechar: 0,
      valorParado: 90,
      zero: 500,
      open: 0,
      closed: 500,
    };
  }
  return servos;
}

function defaultConfig() {
  return {
    baudRate: 115200,
    zeroDelayMs: 250,
    holdMs: 400,
    servoType: "360", // "180" (posicional) ou "360" (rotacao continua)
    servos180: defaultServos180(),
    servos360: defaultServos360(),
  };
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultConfig();
    const parsed = JSON.parse(raw);
    const merged = defaultConfig();
    merged.baudRate = parsed.baudRate ?? merged.baudRate;
    merged.zeroDelayMs = parsed.zeroDelayMs ?? merged.zeroDelayMs;
    merged.holdMs = parsed.holdMs ?? merged.holdMs;
    merged.servoType = parsed.servoType === "180" ? "180" : merged.servoType;
    for (const f of FINGER_ORDER) {
      if (parsed.servos180 && parsed.servos180[f]) {
        merged.servos180[f] = { ...merged.servos180[f], ...parsed.servos180[f] };
      }
      if (parsed.servos360 && parsed.servos360[f]) {
        merged.servos360[f] = { ...merged.servos360[f], ...parsed.servos360[f] };
      }
    }
    return merged;
  } catch (e) {
    console.warn("Config inválida em localStorage, usando padrão.", e);
    return defaultConfig();
  }
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

let config = loadConfig();

function servosAtuais() {
  return config.servoType === "180" ? config.servos180 : config.servos360;
}

// ---------------------------------------------------------------------------
// Mapeamento de gestos -> estado (aberto/fechado) de cada dedo
// ---------------------------------------------------------------------------

const GESTURE_TARGETS = {
  pedra: { polegar: "closed", indicador: "closed", medio: "closed", anelar: "closed", mindinho: "closed" },
  papel: { polegar: "open", indicador: "open", medio: "open", anelar: "open", mindinho: "open" },
  tesoura: { polegar: "closed", indicador: "open", medio: "open", anelar: "closed", mindinho: "closed" },
};

// Monta o comando "Z ..." ou "M ..." pronto para enviar, no formato certo
// para o tipo de servo selecionado (angulo simples pro 180°, "valor:duracao"
// pro 360°).
function comandoZero() {
  return "Z " + FINGER_ORDER.map((f) => pulsoDedo(f, "zero")).join(",");
}

function comandoGesto(gestureName) {
  const alvo = GESTURE_TARGETS[gestureName];
  return "M " + FINGER_ORDER.map((f) => pulsoDedo(f, alvo[f])).join(",");
}

function pulsoDedo(finger, estado) {
  if (config.servoType === "180") {
    return String(config.servos180[finger][estado]);
  }
  const c = config.servos360[finger];
  const valor = estado === "closed" ? c.valorFechar : c.valorAbrir;
  const duracao = c[estado];
  return `${valor}:${duracao}`;
}

// So faz sentido no modo 360° (rotacao continua) -- o firmware 180° nao
// conhece o comando T e responde "ERR", por isso so enviamos nesse modo.
function comandoTrim360() {
  const trims = FINGER_ORDER.map((f) => config.servos360[f].valorParado);
  return "T " + trims.join(",");
}

// ---------------------------------------------------------------------------
// Web Serial
// ---------------------------------------------------------------------------

let serialPort = null;
let serialWriter = null;
let serialReadAbort = null;

function logSerial(msg) {
  const el = document.getElementById("serialLog");
  const time = new Date().toLocaleTimeString();
  el.value += `[${time}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    alert(
      "Web Serial API indisponível neste navegador. Use Chrome, Edge ou Opera (desktop), servidos via http://localhost ou https://."
    );
    return;
  }
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: Number(config.baudRate) || 115200 });
    serialWriter = serialPort.writable.getWriter();

    setSerialStatus(true);
    logSerial("Conectado.");
    startSerialReadLoop();

    // pequena pausa para o Arduino terminar o boot/reset via DTR, depois ping
    await sleep(300);
    await enviarLinha("P");
    // a mao sempre comeca aberta: manda o trim (so faz sentido no 360°) e
    // manda ir pra referencia "zero"/aberta com os valores calibrados reais,
    // corrigindo o chute generico que o firmware faz sozinho no boot.
    if (config.servoType === "360") {
      await enviarLinha(comandoTrim360());
    }
    await irParaZero();
  } catch (e) {
    logSerial("Erro ao conectar: " + e.message);
    setSerialStatus(false);
  }
}

async function disconnectSerial() {
  try {
    if (serialReadAbort) serialReadAbort.abort();
    if (serialWriter) {
      await serialWriter.close().catch(() => {});
      serialWriter = null;
    }
    if (serialPort) {
      await serialPort.close().catch(() => {});
      serialPort = null;
    }
  } finally {
    setSerialStatus(false);
    logSerial("Desconectado.");
  }
}

function setSerialStatus(connected) {
  const badge = document.getElementById("serialStatus");
  badge.textContent = connected ? "conectado" : "desconectado";
  badge.className = "badge " + (connected ? "badge-ok" : "badge-off");
  document.getElementById("btnConnect").disabled = connected;
  document.getElementById("btnDisconnect").disabled = !connected;
}

async function startSerialReadLoop() {
  serialReadAbort = new AbortController();
  const textDecoder = new TextDecoderStream();
  const readableClosed = serialPort.readable.pipeTo(textDecoder.writable, {
    signal: serialReadAbort.signal,
  }).catch(() => {});
  const reader = textDecoder.readable.getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) logSerial("Arduino: " + line);
      }
    }
  } catch (e) {
    // leitura interrompida ao desconectar, esperado
  } finally {
    reader.releaseLock();
  }
  await readableClosed;
}

async function enviarLinha(linha) {
  if (!serialWriter) {
    logSerial("Não conectado — comando ignorado: " + linha);
    return;
  }
  const encoder = new TextEncoder();
  await serialWriter.write(encoder.encode(linha + "\n"));
  logSerial("> " + linha);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Acionamento (sempre passa pela posição zero antes do gesto final)
// ---------------------------------------------------------------------------

let ultimoGestoAcionado = null;
let acionando = false;

async function irParaZero() {
  await enviarLinha(comandoZero());
}

async function acionarGesto(gestureName) {
  if (acionando) return;
  acionando = true;
  try {
    await irParaZero();
    await sleep(Number(config.zeroDelayMs) || 0);
    if (gestureName && GESTURE_TARGETS[gestureName]) {
      await enviarLinha(comandoGesto(gestureName));
    }
    ultimoGestoAcionado = gestureName || "zero";
    document.getElementById("statusGestoAcionado").textContent =
      gestureName ? gestureName : "zero (repouso)";
  } finally {
    acionando = false;
  }
}

// Testes manuais (botões da aba Operação)
for (const btn of document.querySelectorAll(".btnTeste")) {
  btn.addEventListener("click", () => {
    const g = btn.dataset.gesto;
    acionarGesto(g === "zero" ? null : g);
  });
}

document.getElementById("btnConnect").addEventListener("click", connectSerial);
document.getElementById("btnDisconnect").addEventListener("click", disconnectSerial);

// ---------------------------------------------------------------------------
// Câmera + MediaPipe HandLandmarker
// ---------------------------------------------------------------------------

let handLandmarker = null;
let cameraAtiva = false;
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");

async function iniciarHandLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });
}

async function iniciarCamera() {
  const btn = document.getElementById("btnCamera");
  btn.disabled = true;
  try {
    if (!handLandmarker) {
      await iniciarHandLandmarker();
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;

    cameraAtiva = true;
    setCameraStatus(true);
    requestAnimationFrame(loopDeteccao);
  } catch (e) {
    alert("Não foi possível iniciar a câmera/detector: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

function setCameraStatus(ativa) {
  const badge = document.getElementById("cameraStatus");
  badge.textContent = ativa ? "câmera ativa" : "câmera parada";
  badge.className = "badge " + (ativa ? "badge-ok" : "badge-off");
}

document.getElementById("btnCamera").addEventListener("click", iniciarCamera);

// --- Classificação do gesto a partir dos 21 landmarks -----------------------

const WRIST = 0;
const FINGER_LANDMARKS = {
  polegar: { mid: 2, tip: 4 },
  indicador: { mid: 6, tip: 8 },
  medio: { mid: 10, tip: 12 },
  anelar: { mid: 14, tip: 16 },
  mindinho: { mid: 18, tip: 20 },
};
const EXTEND_MARGIN = 1.05; // exige tip 5% mais longe que a junta intermediária

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function classificarDedos(landmarks) {
  const wrist = landmarks[WRIST];
  const estado = {};
  for (const f of FINGER_ORDER) {
    const { mid, tip } = FINGER_LANDMARKS[f];
    const dTip = dist(landmarks[tip], wrist);
    const dMid = dist(landmarks[mid], wrist);
    estado[f] = dTip > dMid * EXTEND_MARGIN;
  }
  return estado; // true = estendido
}

function classificarGesto(estadoDedos) {
  const { indicador, medio, anelar, mindinho } = estadoDedos;
  if (!indicador && !medio && !anelar && !mindinho) return "pedra";
  if (indicador && medio && anelar && mindinho) return "papel";
  if (indicador && medio && !anelar && !mindinho) return "tesoura";
  return null; // indefinido
}

// --- loop principal de deteção ----------------------------------------------

let gestoEstavelAtual = null;
let gestoEstavelDesde = 0;

function loopDeteccao() {
  if (!cameraAtiva) return;

  if (video.readyState >= 2) {
    const resultado = handLandmarker.detectForVideo(video, performance.now());
    desenharOverlay(resultado);

    if (resultado.landmarks && resultado.landmarks.length > 0) {
      const estadoDedos = classificarDedos(resultado.landmarks[0]);
      const gesto = classificarGesto(estadoDedos);
      atualizarStatusDeteccao(gesto, estadoDedos);
      processarEstabilidade(gesto);
    } else {
      atualizarStatusDeteccao(null, null);
      processarEstabilidade(null);
    }
  }

  requestAnimationFrame(loopDeteccao);
}

function processarEstabilidade(gesto) {
  const agora = performance.now();
  if (gesto !== gestoEstavelAtual) {
    gestoEstavelAtual = gesto;
    gestoEstavelDesde = agora;
    return;
  }
  const estavelPor = agora - gestoEstavelDesde;
  if (estavelPor < (Number(config.holdMs) || 0)) return;

  if (gesto === null) {
    if (ultimoGestoAcionado !== "zero" && ultimoGestoAcionado !== null) {
      acionarGesto(null);
    }
  } else if (gesto !== ultimoGestoAcionado) {
    acionarGesto(gesto);
  }
}

function atualizarStatusDeteccao(gesto, estadoDedos) {
  document.getElementById("statusGestoDetectado").textContent = gesto ?? "—";
  if (estadoDedos) {
    const txt = ["indicador", "medio", "anelar", "mindinho"]
      .map((f) => (estadoDedos[f] ? "aberto" : "fechado"))
      .join(" · ");
    document.getElementById("statusDedos").textContent = txt;
  } else {
    document.getElementById("statusDedos").textContent = "—";
  }
}

function desenharOverlay(resultado) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  if (!resultado.landmarks) return;
  overlayCtx.fillStyle = "#4f8cff";
  overlayCtx.strokeStyle = "#4f8cff";
  overlayCtx.lineWidth = 2;
  for (const mao of resultado.landmarks) {
    for (const p of mao) {
      const x = p.x * overlay.width;
      const y = p.y * overlay.height;
      overlayCtx.beginPath();
      overlayCtx.arc(x, y, 3, 0, Math.PI * 2);
      overlayCtx.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// UI de calibração
// ---------------------------------------------------------------------------

// Guarda o ultimo angulo enviado de cada dedo no modo 180°, so pra manter os
// outros dedos na posicao atual quando "Testar" move so um servo por vez.
let ultimosAngulos180Enviados = FINGER_ORDER.map((f) => config.servos180[f].zero);

function celulaTexto(texto) {
  const td = document.createElement("td");
  td.textContent = texto;
  return td;
}

function celulaInputNumero(valor, min, max, step, onChange) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = valor;
  input.addEventListener("input", () => {
    onChange(clamp(Number(input.value) || 0, min, max));
  });
  td.appendChild(input);
  return td;
}

function celulaBotaoTestar(onClick) {
  const td = document.createElement("td");
  const btn = document.createElement("button");
  btn.textContent = "Testar";
  btn.addEventListener("click", onClick);
  td.appendChild(btn);
  return td;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function montarTabelaCalibracao() {
  const thead = document.querySelector("#calibTable thead");
  const tbody = document.querySelector("#calibTable tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trHead = document.createElement("tr");
  const titulos =
    config.servoType === "180"
      ? ["Dedo", "Zero (°)", "", "Aberto (°)", "", "Fechado (°)", ""]
      : ["Dedo", "V. abrir", "V. fechar", "Parado", "Zero (ms)", "", "Aberto (ms)", "", "Fechado (ms)", ""];
  for (const titulo of titulos) {
    const th = document.createElement("th");
    th.textContent = titulo;
    trHead.appendChild(th);
  }
  thead.appendChild(trHead);

  const montarLinhas = config.servoType === "180" ? montarLinhas180 : montarLinhas360;
  FINGER_ORDER.forEach((f, idx) => tbody.appendChild(montarLinhas(f, idx)));

  document.getElementById("btnTestarParada").hidden = config.servoType !== "360";
}

function montarLinhas180(f, idx) {
  const tr = document.createElement("tr");
  tr.appendChild(celulaTexto(FINGER_LABEL[f]));

  for (const campo of ["zero", "open", "closed"]) {
    tr.appendChild(
      celulaInputNumero(config.servos180[f][campo], 0, 180, 1, (v) => {
        config.servos180[f][campo] = v;
      })
    );
    tr.appendChild(
      celulaBotaoTestar(async () => {
        const angulos = [...ultimosAngulos180Enviados];
        angulos[idx] = config.servos180[f][campo];
        ultimosAngulos180Enviados = angulos;
        await enviarLinha("M " + angulos.join(","));
      })
    );
  }
  return tr;
}

function montarLinhas360(f, idx) {
  const tr = document.createElement("tr");
  const c = config.servos360[f];
  tr.appendChild(celulaTexto(FINGER_LABEL[f]));

  tr.appendChild(celulaInputNumero(c.valorAbrir, 0, 180, 1, (v) => (c.valorAbrir = v)));
  tr.appendChild(celulaInputNumero(c.valorFechar, 0, 180, 1, (v) => (c.valorFechar = v)));
  tr.appendChild(celulaInputNumero(c.valorParado, 0, 180, 1, (v) => (c.valorParado = v)));

  for (const campo of ["zero", "open", "closed"]) {
    tr.appendChild(celulaInputNumero(c[campo], 0, 3000, 50, (v) => (c[campo] = v)));
    tr.appendChild(
      celulaBotaoTestar(async () => {
        // move so este dedo (pulso real); os outros ficam parados (d=0).
        const pares = FINGER_ORDER.map((ff, i) => (i === idx ? pulsoDedo(ff, campo) : "0:0"));
        await enviarLinha("M " + pares.join(","));
      })
    );
  }
  return tr;
}

function preencherCamposGerais() {
  document.getElementById("cfgBaud").value = config.baudRate;
  document.getElementById("cfgZeroDelay").value = config.zeroDelayMs;
  document.getElementById("cfgHold").value = config.holdMs;
  document.getElementById("cfgServoType").value = config.servoType;
}

document.getElementById("cfgServoType").addEventListener("change", (e) => {
  config.servoType = e.target.value === "180" ? "180" : "360";
  montarTabelaCalibracao();
});

document.getElementById("btnTestarParada").addEventListener("click", async () => {
  await enviarLinha(comandoTrim360());
  const pares = FINGER_ORDER.map(() => "0:0");
  await enviarLinha("M " + pares.join(","));
});

document.getElementById("cfgBaud").addEventListener("input", (e) => {
  config.baudRate = Number(e.target.value) || 115200;
});
document.getElementById("cfgZeroDelay").addEventListener("input", (e) => {
  config.zeroDelayMs = Number(e.target.value) || 0;
});
document.getElementById("cfgHold").addEventListener("input", (e) => {
  config.holdMs = Number(e.target.value) || 0;
});

document.getElementById("btnSalvarConfig").addEventListener("click", () => {
  saveConfig(config);
  const msg = document.getElementById("configSavedMsg");
  msg.hidden = false;
  setTimeout(() => (msg.hidden = true), 1500);
});

document.getElementById("btnResetConfig").addEventListener("click", () => {
  if (!confirm("Restaurar todos os parâmetros de calibração para o padrão?")) return;
  config = defaultConfig();
  saveConfig(config);
  montarTabelaCalibracao();
  preencherCamposGerais();
});

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------

for (const btn of document.querySelectorAll(".tab-btn")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".tab-btn")) b.classList.remove("active");
    for (const p of document.querySelectorAll(".tab-panel")) p.classList.remove("active");
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

montarTabelaCalibracao();
preencherCamposGerais();
