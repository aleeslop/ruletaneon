/**
 * RULETA DE SORTEOS OFICIAL - VISTA ESPECTADOR EN TIEMPO REAL
 * Sincronizada automáticamente vía Server-Sent Events (SSE).
 * Los giros son controlados exclusivamente por el Administrador desde /admin
 * o mediante la tecla 'Enter' en la pantalla principal.
 */

(function () {
  'use strict';

  // ================= CONFIGURACIÓN Y CONSTANTES =================
  const TOTAL_NUMBERS = 151; // 00 hasta 150 (índice 0 = '00', 51 = '51', ..., 150 = '150')
  const WINNER_INDEX = 51;
  const SPIN_DURATION_MS = 3600; // Entre 3 y 4 segundos exactos
  const FULL_ROTATIONS = 7; // Revoluciones completas para movimiento natural

  // Generar la lista de números: '00', '01', ..., '150'
  const items = Array.from({ length: TOTAL_NUMBERS }, (_, i) => {
    if (i === 0) return '00';
    return i < 10 ? '0' + i : String(i);
  });

  const sliceAngle = (2 * Math.PI) / TOTAL_NUMBERS;

  // ================= VARIABLES DE ESTADO =================
  let currentRotation = 0;
  let isSpinning = false;
  let audioEnabled = true;
  let lastTickIndex = -1;
  let localSpinCount = 0;

  // ================= ELEMENTOS DEL DOM =================
  const canvas = document.getElementById('rouletteCanvas');
  const ctx = canvas.getContext('2d');
  const wheelContainer = document.getElementById('wheelContainer');
  const pointerNeedle = document.getElementById('pointerNeedle');
  const hudValue = document.getElementById('hudValue');

  // Estado del espectador
  const spectatorStatusContainer = document.getElementById('spectatorStatusContainer');
  const spectatorStatus = document.getElementById('spectatorStatus');

  // Modal de Resultados
  const resultModal = document.getElementById('resultModal');
  const modalCard = document.getElementById('modalCard');
  const modalBadge = document.getElementById('modalBadge');
  const modalNumber = document.getElementById('modalNumber');
  const modalMessage = document.getElementById('modalMessage');
  const modalSubtext = document.getElementById('modalSubtext');

  // Confetti Canvas
  const confettiCanvas = document.getElementById('confettiCanvas');
  const confettiCtx = confettiCanvas.getContext('2d');

  // ================= SISTEMA DE AUDIO (Web Audio API) =================
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // Activar audio con la primera interacción del usuario en la pantalla
  window.addEventListener('click', () => initAudio(), { once: true });
  window.addEventListener('keydown', () => initAudio(), { once: true });
  window.addEventListener('touchstart', () => initAudio(), { once: true });

  function playTickSound() {
    if (!audioEnabled || !audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.025);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.03);
    } catch (e) {}
  }

  function playTestChime() {
    if (!audioEnabled || !audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      [440, 659.25].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);
        gain.gain.setValueAtTime(0.18, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.6);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.65);
      });
    } catch (e) {}
  }

  function playWinnerFanfare() {
    if (!audioEnabled || !audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.14);

        gain.gain.setValueAtTime(0.25, now + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + (idx === 3 ? 1.5 : 0.4));

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.14);
        osc.stop(now + idx * 0.14 + (idx === 3 ? 1.6 : 0.45));
      });
    } catch (e) {}
  }

  // ================= PRE-RENDERIZADO DE ALTA RESOLUCIÓN =================
  let offscreenCanvas = null;
  const VIRTUAL_SIZE = 1000;

  function renderWheelTexture() {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = VIRTUAL_SIZE;
    offscreenCanvas.height = VIRTUAL_SIZE;
    const offCtx = offscreenCanvas.getContext('2d');

    const centerX = VIRTUAL_SIZE / 2;
    const centerY = VIRTUAL_SIZE / 2;
    const outerRadius = (VIRTUAL_SIZE / 2) - 24;

    offCtx.clearRect(0, 0, VIRTUAL_SIZE, VIRTUAL_SIZE);

    offCtx.save();
    offCtx.beginPath();
    offCtx.arc(centerX, centerY, outerRadius, 0, 2 * Math.PI);
    offCtx.fillStyle = '#0a0e17';
    offCtx.fill();
    offCtx.restore();

    for (let i = 0; i < TOTAL_NUMBERS; i++) {
      const startAngle = i * sliceAngle;
      const endAngle = (i + 1) * sliceAngle;
      const midAngle = startAngle + sliceAngle / 2;

      offCtx.save();

      offCtx.beginPath();
      offCtx.moveTo(centerX, centerY);
      offCtx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
      offCtx.closePath();

      if (i % 2 === 0) {
        offCtx.fillStyle = '#0f172a';
      } else {
        offCtx.fillStyle = '#161f33';
      }
      offCtx.fill();

      offCtx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      offCtx.lineWidth = 1;
      offCtx.stroke();

      offCtx.beginPath();
      offCtx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
      if (i % 4 === 0) {
        offCtx.strokeStyle = 'rgba(0, 242, 254, 0.7)';
      } else if (i % 4 === 2) {
        offCtx.strokeStyle = 'rgba(255, 0, 127, 0.7)';
      } else {
        offCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      }
      offCtx.lineWidth = 3.5;
      offCtx.stroke();

      const pegAngle = startAngle;
      const pegX = centerX + (outerRadius - 8) * Math.cos(pegAngle);
      const pegY = centerY + (outerRadius - 8) * Math.sin(pegAngle);
      offCtx.beginPath();
      offCtx.arc(pegX, pegY, 2.5, 0, 2 * Math.PI);
      offCtx.fillStyle = i % 2 === 0 ? '#00f2fe' : '#ff007f';
      offCtx.fill();

      offCtx.save();
      offCtx.translate(centerX, centerY);
      offCtx.rotate(midAngle);
      offCtx.translate(outerRadius - 32, 0);
      offCtx.rotate(Math.PI / 2);

      offCtx.textAlign = 'center';
      offCtx.textBaseline = 'middle';

      const label = items[i];
      if (label.length >= 3) {
        offCtx.font = 'bold 9.5px "Space Grotesk", sans-serif';
      } else {
        offCtx.font = 'bold 11px "Space Grotesk", sans-serif';
      }

      if (i % 2 === 0) {
        offCtx.fillStyle = '#f8fafc';
      } else {
        offCtx.fillStyle = '#cbd5e1';
      }

      offCtx.fillText(label, 0, 0);
      offCtx.restore();

      offCtx.restore();
    }

    offCtx.save();
    offCtx.beginPath();
    offCtx.arc(centerX, centerY, outerRadius + 5, 0, 2 * Math.PI);
    offCtx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
    offCtx.lineWidth = 3;
    offCtx.stroke();

    offCtx.beginPath();
    offCtx.arc(centerX, centerY, outerRadius + 10, 0, 2 * Math.PI);
    offCtx.strokeStyle = 'rgba(255, 0, 127, 0.3)';
    offCtx.lineWidth = 1.5;
    offCtx.stroke();
    offCtx.restore();
  }

  function drawWheel(angle) {
    if (!offscreenCanvas) return;
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);
    ctx.drawImage(offscreenCanvas, -centerX, -centerY, width, height);
    ctx.restore();
  }

  function getNumberAtPointer(rotation) {
    const pointerAngle = -Math.PI / 2;
    let wheelAngle = (pointerAngle - rotation) % (2 * Math.PI);
    if (wheelAngle < 0) wheelAngle += 2 * Math.PI;

    const index = Math.floor(wheelAngle / sliceAngle) % TOTAL_NUMBERS;
    return {
      index: index,
      label: items[index]
    };
  }

  function triggerNeedleTick() {
    pointerNeedle.classList.add('tick');
    setTimeout(() => {
      pointerNeedle.classList.remove('tick');
    }, 45);
  }

  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  // ================= CONFETI =================
  let confettiParticles = [];
  let confettiAnimationId = null;

  function resizeConfetti() {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeConfetti);
  resizeConfetti();

  function launchConfettiCelebration(isWinner = false) {
    confettiParticles = [];
    const colors = isWinner
      ? ['#00f2fe', '#ff007f', '#ffffff', '#ffd700', '#00ffcc', '#ff3399']
      : ['#00f2fe', '#ffffff', '#38bdf8', '#818cf8'];

    const count = isWinner ? 220 : 75;

    for (let i = 0; i < count; i++) {
      confettiParticles.push({
        x: window.innerWidth * 0.5 + (Math.random() - 0.5) * (isWinner ? 280 : 160),
        y: window.innerHeight * 0.45 + (Math.random() - 0.5) * (isWinner ? 140 : 80),
        vx: (Math.random() - 0.5) * (isWinner ? 24 : 16),
        vy: -Math.random() * (isWinner ? 20 : 14) - (isWinner ? 7 : 4),
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        wobble: Math.random() * 10,
        gravity: 0.40,
        opacity: 1,
        shape: Math.random() > 0.4 ? 'rect' : 'circle'
      });
    }

    if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
    animateConfetti();
  }

  function animateConfetti() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    let activeParticles = 0;

    for (let p of confettiParticles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.985;
      p.rotation += p.rotationSpeed;
      p.wobble += 0.1;

      if (p.y > window.innerHeight * 0.72) {
        p.opacity -= 0.014;
      }

      if (p.opacity > 0 && p.y < window.innerHeight + 50) {
        activeParticles++;
        confettiCtx.save();
        confettiCtx.globalAlpha = Math.max(0, p.opacity);
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate((p.rotation * Math.PI) / 180);

        confettiCtx.fillStyle = p.color;
        if (p.shape === 'rect') {
          confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        } else {
          confettiCtx.beginPath();
          confettiCtx.arc(0, 0, p.size / 2, 0, 2 * Math.PI);
          confCtx.fill();
        }
        confettiCtx.restore();
      }
    }

    if (activeParticles > 0) {
      confettiAnimationId = requestAnimationFrame(animateConfetti);
    } else {
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      confettiAnimationId = null;
    }
  }

  function stopConfetti() {
    if (confettiAnimationId) {
      cancelAnimationFrame(confettiAnimationId);
      confettiAnimationId = null;
    }
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiParticles = [];
  }

  // ================= ANUNCIO DE RESULTADO LIMPIO (TODO 100% IDÉNTICO) =================
  function showResult(targetNum, isWinner, turnNumber) {
    if (spectatorStatusContainer) spectatorStatusContainer.classList.remove('spinning', 'winner');

    // Sonido exactamente idéntico para todos los giros
    playTestChime();
    stopConfetti();

    if (spectatorStatus) {
      if (isWinner) {
        spectatorStatus.textContent = `VUELTA OFICIAL: ${targetNum}`;
      } else {
        spectatorStatus.textContent = `VUELTA DE PRUEBA: ${targetNum}`;
      }
    }
  }

  function closeModal() {
    stopConfetti();
  }

  // ================= EJECUCIÓN DEL GIRO =================
  function executeSpin(targetIndex, targetNumberLabel, isWinner, turnNumber) {
    if (isSpinning) return;
    initAudio();
    closeModal();

    isSpinning = true;
    if (wheelContainer) wheelContainer.classList.add('spinning');
    if (spectatorStatusContainer) {
      spectatorStatusContainer.classList.add('spinning');
      spectatorStatusContainer.classList.remove('winner');
    }
    if (spectatorStatus) spectatorStatus.textContent = 'RULETA EN MOVIMIENTO...';

    // Cálculo matemático exacto de rotación
    const targetSliceCenter = (targetIndex + 0.5) * sliceAngle;
    const pointerAngle = -Math.PI / 2;

    const desiredMod = ((pointerAngle - targetSliceCenter) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const currentMod = (currentRotation % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

    let deltaAngle = desiredMod - currentMod;
    if (deltaAngle <= 0) {
      deltaAngle += 2 * Math.PI;
    }

    const totalRotationDistance = (FULL_ROTATIONS * 2 * Math.PI) + deltaAngle;
    const startRotation = currentRotation;
    const endRotation = startRotation + totalRotationDistance;

    const startTime = performance.now();

    function step(timestamp) {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / SPIN_DURATION_MS, 1);
      const easedProgress = easeOutQuart(progress);

      currentRotation = startRotation + totalRotationDistance * easedProgress;
      drawWheel(currentRotation);

      const currentItem = getNumberAtPointer(currentRotation);
      if (hudValue) hudValue.textContent = currentItem.label;

      if (currentItem.index !== lastTickIndex) {
        lastTickIndex = currentItem.index;
        playTickSound();
        triggerNeedleTick();
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        currentRotation = endRotation;
        drawWheel(currentRotation);

        const finalItem = getNumberAtPointer(currentRotation);
        if (hudValue) hudValue.textContent = finalItem.label;

        if (wheelContainer) wheelContainer.classList.remove('spinning');
        isSpinning = false;

        setTimeout(() => {
          showResult(targetNumberLabel, isWinner, turnNumber);
        }, 300);
      }
    }

    requestAnimationFrame(step);
  }

  // ================= CONEXIÓN SSE EN TIEMPO REAL CON EL SERVIDOR =================
  let eventSource = null;

  function connectToServer() {
    try {
      eventSource = new EventSource('/events');

      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'spin') {
            executeSpin(data.targetIndex, data.targetLabel, data.isWinner, data.turn);
          } else if (data.type === 'reset') {
            closeModal();
            spectatorStatusContainer.classList.remove('spinning', 'winner');
            spectatorStatus.textContent = 'EN ESPERA DEL SORTEO';
          }
        } catch (err) {}
      };

      eventSource.onerror = () => {
        // En caso de caída de conexión, reintenta automáticamente
      };
    } catch (e) {
      console.log('Modo offline / standalone');
    }
  }

  // ================= CONTROL MANUAL CON TECLA 'ENTER' =================
  // Si estás en la PC/laptop de transmisión, pulsar 'Enter' envía la orden al servidor
  window.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (isSpinning) return;

      try {
        const res = await fetch('/api/spin', { method: 'POST' });
        if (!res.ok) {
          // Si el servidor responde con error o no está disponible, fallback local
          runLocalSpinFallback();
        }
      } catch (err) {
        runLocalSpinFallback();
      }
    }
  });

  // Fallback si se ejecuta de forma standalone sin servidor activo
  function runLocalSpinFallback() {
    if (isSpinning) return;
    if (localSpinCount >= 3) {
      localSpinCount = 0;
    }
    localSpinCount++;

    let targetIndex;
    let isWinner = false;

    if (localSpinCount <= 2) {
      const allowed = [];
      for (let i = 0; i < TOTAL_NUMBERS; i++) {
        if (i !== WINNER_INDEX) allowed.push(i);
      }
      targetIndex = allowed[Math.floor(Math.random() * allowed.length)];
      isWinner = false;
    } else {
      // Vuelta 3: SIEMPRE 51
      targetIndex = WINNER_INDEX;
      isWinner = true;
    }

    executeSpin(targetIndex, items[targetIndex], isWinner, localSpinCount);
  }

  // ================= INICIALIZACIÓN =================
  function init() {
    renderWheelTexture();
    drawWheel(0);
    const initialItem = getNumberAtPointer(0);
    if (hudValue) hudValue.textContent = initialItem.label;
    connectToServer();
  }

  init();
})();
