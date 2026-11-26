import { calculateBodyComposition, round1 } from './bia.js';
import {
  connectScaleGatt,
  startAdvertisementScan,
  isWebBluetoothSupported
} from './ble.js';

const STORAGE_PROFILE = 'okok_scale_profile_v1';
const STORAGE_RECORDS = 'okok_scale_records_v1';

const DEFAULT_PROFILE = {
  sex: 'male',
  heightCm: 175,
  age: 32,
  goalWeightKg: 70
};

let profile = loadProfile();
let records = loadRecords();
let activeChartMetric = 'weightKg';
let activeGattConn = null;
let activeScan = null;
let deferredPrompt = null;

// Service Worker 등록
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// PWA 설치 프롬프트
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add('hidden');
});

// 탭 전환
const navButtons = document.querySelectorAll('.nav-btn');
const panels = document.querySelectorAll('.tab-panel');
navButtons.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tabName) {
  navButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
  panels.forEach((p) => p.classList.toggle('active', p.id === `tab-${tabName}`));
  if (tabName === 'report') renderReport();
  if (tabName === 'history') renderHistory();
}

// 로그 & 상태 표시
const bleLogEl = document.getElementById('bleLog');
const bleStatusBadge = document.getElementById('bleStatusBadge');
const liveWeightEl = document.getElementById('liveWeight');
const liveSubInfoEl = document.getElementById('liveSubInfo');
const lastMeasuredAtEl = document.getElementById('lastMeasuredAt');

function appendLog(msg) {
  const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  const prev = bleLogEl.textContent === '아직 수신된 신호가 없어요.' ? '' : bleLogEl.textContent + '\n';
  bleLogEl.textContent = prev + `[${time}] ${msg}`;
  bleLogEl.scrollTop = bleLogEl.scrollHeight;
}

function setStatus(text, type = 'idle') {
  bleStatusBadge.textContent = text;
  bleStatusBadge.className = `badge badge-${type}`;
}

// 블루투스 GATT 연결
const connectGattBtn = document.getElementById('connectGattBtn');
const connectAllBtn = document.getElementById('connectAllBtn');

async function handleGattConnect(btn, defaultLabel, filterOnly) {
  if (activeGattConn) {
    activeGattConn.disconnect();
    activeGattConn = null;
    connectGattBtn.textContent = '체중계만 골라서 연결 (추천)';
    connectAllBtn.textContent = '전체 블루투스 기기에서 찾기';
    setStatus('대기 중', 'idle');
    return;
  }

  try {
    setStatus('연결 중...', 'scanning');
    activeGattConn = await connectScaleGatt({
      filterOnly,
      onLog: appendLog,
      onMeasurement: handleIncomingMeasurement,
      onDisconnect: () => {
        activeGattConn = null;
        connectGattBtn.textContent = '체중계만 골라서 연결 (추천)';
        connectAllBtn.textContent = '전체 블루투스 기기에서 찾기';
        setStatus('연결 종료', 'idle');
      }
    });
    btn.textContent = `연결 끊기 (${activeGattConn.deviceName})`;
    setStatus('연결됨', 'connected');
    liveSubInfoEl.textContent = '체중계에 맨발로 올라가면 측정값이 자동으로 들어옵니다.';
  } catch (err) {
    if (err.name === 'NotFoundError') {
      appendLog('기기 선택을 취소했거나 일치하는 체중계가 아직 깨어나지 않았습니다.');
      setStatus('대기 중', 'idle');
      return;
    }
    appendLog(`오류: ${err.message}`);
    setStatus('연결 안 됨', 'error');
    alert(err.message);
  }
}

connectGattBtn.addEventListener('click', () =>
  handleGattConnect(connectGattBtn, '체중계만 골라서 연결 (추천)', true)
);
connectAllBtn.addEventListener('click', () =>
  handleGattConnect(connectAllBtn, '전체 블루투스 기기에서 찾기', false)
);

// 블루투스 광고 스캔 모드
const scanBleBtn = document.getElementById('scanBleBtn');
scanBleBtn.addEventListener('click', async () => {
  if (activeScan) {
    activeScan.stop();
    activeScan = null;
    scanBleBtn.textContent = '신호 스캔 모드 (자동 방송형)';
    setStatus('대기 중', 'idle');
    return;
  }

  try {
    setStatus('신호 스캔 중...', 'scanning');
    activeScan = await startAdvertisementScan({
      onLog: appendLog,
      onMeasurement: handleIncomingMeasurement
    });
    scanBleBtn.textContent = '신호 스캔 중지';
    liveSubInfoEl.textContent = '주변 체중계 신호를 기다리는 중입니다. 체중계에 올라가 주세요.';
  } catch (err) {
    appendLog(`스캔 안내: ${err.message}`);
    setStatus('지원 확인 필요', 'idle');
    alert(err.message);
  }
});

let lastSavedStamp = 0;
function handleIncomingMeasurement({ weightKg, impedanceOhm, stable, source }) {
  liveWeightEl.textContent = round1(weightKg).toFixed(1);
  liveSubInfoEl.textContent = impedanceOhm
    ? `수신 완료 (${source}) · 저항 ${impedanceOhm}Ω`
    : `수신 완료 (${source}) · 체중 측정됨`;

  // 안정화된 값이면 5초 중복 저장 방지 후 자동 저장
  const now = Date.now();
  if (stable && now - lastSavedStamp > 5000) {
    lastSavedStamp = now;
    saveMeasurement(weightKg, impedanceOhm);
  }
}

// 직접 입력 폼
document.getElementById('manualForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const w = parseFloat(document.getElementById('manualWeight').value);
  const imp = parseFloat(document.getElementById('manualImpedance').value || '0');
  if (!Number.isFinite(w) || w < 10 || w > 250) return;

  saveMeasurement(w, Number.isFinite(imp) ? imp : 0);
  liveWeightEl.textContent = round1(w).toFixed(1);
  liveSubInfoEl.textContent = '직접 입력한 수치가 저장되었습니다. 「신체 분석」 탭을 확인해 보세요.';
  e.target.reset();
});

function saveMeasurement(weightKg, impedanceOhm = 0) {
  const comp = calculateBodyComposition({
    weightKg,
    impedanceOhm,
    heightCm: profile.heightCm,
    age: profile.age,
    sex: profile.sex
  });
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    timestamp: new Date().toISOString(),
    ...comp
  };
  records.unshift(entry);
  persistRecords();
  updateMeasureTimestamp();
  renderReport();
}

function updateMeasureTimestamp() {
  if (records.length === 0) {
    lastMeasuredAtEl.textContent = '최근 측정 없음';
    return;
  }
  lastMeasuredAtEl.textContent = `최근: ${formatDateShort(records[0].timestamp)}`;
  liveWeightEl.textContent = records[0].weightKg.toFixed(1);
}

// 신체 분석 리포트 렌더링
function renderReport() {
  const emptyEl = document.getElementById('reportEmpty');
  const contentEl = document.getElementById('reportContent');
  if (records.length === 0) {
    emptyEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  contentEl.classList.remove('hidden');

  // 현재 프로필 기준으로 최신 기록 재계산
  const latest = records[0];
  const comp = calculateBodyComposition({
    weightKg: latest.weightKg,
    impedanceOhm: latest.impedanceOhm || 0,
    heightCm: profile.heightCm,
    age: profile.age,
    sex: profile.sex
  });

  document.getElementById('repWeight').textContent = comp.weightKg.toFixed(1);
  const diff = round1(comp.weightKg - profile.goalWeightKg);
  const diffText =
    diff === 0
      ? '목표 달성 🎉'
      : diff > 0
      ? `목표보다 +${diff}kg`
      : `목표보다 ${diff}kg`;
  document.getElementById('repGoalDiff').textContent = diffText;
  document.getElementById('repBodyAge').textContent = `${comp.bodyAge} 세`;
  document.getElementById('repBmr').textContent = `${comp.bmr} kcal`;
  document.getElementById('repDate').textContent = formatDateShort(latest.timestamp);

  const noteEl = document.getElementById('repImpedanceNote');
  if (!comp.hasImpedance) {
    noteEl.textContent = 'ℹ️ 저항값(임피던스) 신호가 없어 체중·키·나이 기준으로 추정한 체성분입니다.';
    noteEl.classList.remove('hidden');
  } else {
    noteEl.classList.add('hidden');
  }

  const cards = [
    { name: 'BMI (체질량지수)', val: comp.bmi.toFixed(1), eval: comp.evaluations.bmi },
    { name: '체지방률', val: `${comp.bodyFatPct.toFixed(1)}%`, eval: comp.evaluations.bodyFatPct },
    { name: '골격근량', val: `${comp.muscleMassKg.toFixed(1)} kg`, eval: comp.evaluations.musclePct },
    { name: '체수분율', val: `${comp.waterPct.toFixed(1)}%`, eval: comp.evaluations.waterPct },
    { name: '내장지방 지수', val: `${comp.visceralFat}`, eval: comp.evaluations.visceralFat },
    { name: '체지방량', val: `${comp.fatMassKg.toFixed(1)} kg`, eval: null },
    { name: '추정 골량', val: `${comp.boneMassKg.toFixed(1)} kg`, eval: null },
    { name: '근육 비율', val: `${comp.musclePct.toFixed(1)}%`, eval: comp.evaluations.musclePct }
  ];

  const grid = document.getElementById('metricsGrid');
  grid.innerHTML = cards
    .map(
      (c) => `
      <div class="metric-card">
        <div class="metric-top">
          <span>${c.name}</span>
          ${c.eval ? `<span class="pill pill-${c.eval.level}">${c.eval.label}</span>` : ''}
        </div>
        <div class="metric-val">${c.val}</div>
      </div>`
    )
    .join('');
}

// 변화 그래프 & 기록 렌더링
document.getElementById('chartMetricSwitch').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-metric]');
  if (!btn) return;
  activeChartMetric = btn.dataset.metric;
  document.querySelectorAll('#chartMetricSwitch button').forEach((b) => {
    b.classList.toggle('active', b === btn);
  });
  renderChart();
});

function renderHistory() {
  document.getElementById('historyCount').textContent = records.length;
  renderChart();

  const listEl = document.getElementById('historyList');
  if (records.length === 0) {
    listEl.innerHTML = '<li class="muted-text" style="text-align:center;padding:16px 0;">아직 기록이 없어요.</li>';
    return;
  }

  listEl.innerHTML = records
    .map(
      (r) => `
      <li class="history-item">
        <div>
          <strong>${r.weightKg.toFixed(1)} kg</strong>
          <div class="history-sub">${formatDateFull(r.timestamp)} · 체지방 ${r.bodyFatPct.toFixed(1)}% · 근육 ${r.muscleMassKg.toFixed(1)}kg</div>
        </div>
        <button class="delete-btn" data-id="${r.id}" type="button" aria-label="삭제">✕</button>
      </li>`
    )
    .join('');
}

document.getElementById('historyList').addEventListener('click', (e) => {
  const del = e.target.closest('.delete-btn');
  if (!del) return;
  records = records.filter((r) => r.id !== del.dataset.id);
  persistRecords();
  renderHistory();
  updateMeasureTimestamp();
});

function renderChart() {
  const container = document.getElementById('chartContainer');
  if (records.length < 2) {
    container.innerHTML = '<p class="muted-text">2개 이상의 기록이 쌓이면 변화 그래프가 표시됩니다.</p>';
    return;
  }

  const ordered = [...records].slice(0, 20).reverse();
  const values = ordered.map((r) => r[activeChartMetric]);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad = Math.max(0.5, (maxVal - minVal) * 0.2);
  const yMin = minVal - pad;
  const yMax = maxVal + pad;

  const W = 440;
  const H = 170;
  const px = 26;
  const py = 20;

  const pts = ordered.map((r, i) => {
    const x = px + (i / (ordered.length - 1)) * (W - px * 2);
    const y = H - py - ((r[activeChartMetric] - yMin) / (yMax - yMin || 1)) * (H - py * 2);
    return { x, y, val: r[activeChartMetric], date: formatDateShort(r.timestamp) };
  });

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="170" role="img" aria-label="변화 추이 그래프">
      <line x1="${px}" y1="${H - py}" x2="${W - px}" y2="${H - py}" stroke="#e2e8f0" stroke-width="1" />
      <path d="${pathD}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${pts
        .map(
          (p) => `
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#0f766e" stroke="#fff" stroke-width="2" />
        <text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#334155">${p.val.toFixed(1)}</text>`
        )
        .join('')}
    </svg>`;
}

// CSV 내보내기
document.getElementById('exportCsvBtn').addEventListener('click', () => {
  if (records.length === 0) {
    alert('내보낼 기록이 아직 없어요.');
    return;
  }
  const header = ['측정일시', '체중(kg)', 'BMI', '체지방률(%)', '골격근량(kg)', '체수분(%)', '기초대사량(kcal)', '내장지방지수'];
  const rows = records.map((r) => [
    formatDateFull(r.timestamp),
    r.weightKg,
    r.bmi,
    r.bodyFatPct,
    r.muscleMassKg,
    r.waterPct,
    r.bmr,
    r.visceralFat
  ]);
  const csv = '\uFEFF' + [header, ...rows].map((row) => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `체중계_기록_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// 샘플 데이터 넣기 & 전체 삭제
document.getElementById('seedSampleBtn').addEventListener('click', () => {
  const sampleWeights = [72.4, 72.1, 71.8, 71.9, 71.4, 71.0];
  const now = Date.now();
  sampleWeights.forEach((w, idx) => {
    const comp = calculateBodyComposition({
      weightKg: w,
      impedanceOhm: 515 - idx * 3,
      heightCm: profile.heightCm,
      age: profile.age,
      sex: profile.sex
    });
    records.push({
      id: `sample-${now}-${idx}`,
      timestamp: new Date(now - (sampleWeights.length - idx) * 86400000).toISOString(),
      ...comp
    });
  });
  records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  persistRecords();
  renderHistory();
  updateMeasureTimestamp();
});

document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  if (records.length === 0) return;
  if (!confirm('저장된 모든 측정 기록을 삭제할까요?')) return;
  records = [];
  persistRecords();
  renderHistory();
  updateMeasureTimestamp();
});

// 내 정보 폼
const profSexEl = document.getElementById('profSex');
const profHeightEl = document.getElementById('profHeight');
const profAgeEl = document.getElementById('profAge');
const profGoalEl = document.getElementById('profGoal');
const profileSavedMsg = document.getElementById('profileSavedMsg');

function syncProfileForm() {
  profSexEl.value = profile.sex;
  profHeightEl.value = profile.heightCm;
  profAgeEl.value = profile.age;
  profGoalEl.value = profile.goalWeightKg;
}

document.getElementById('profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  profile = {
    sex: profSexEl.value,
    heightCm: parseFloat(profHeightEl.value),
    age: parseInt(profAgeEl.value, 10),
    goalWeightKg: parseFloat(profGoalEl.value)
  };
  localStorage.setItem(STORAGE_PROFILE, JSON.stringify(profile));
  profileSavedMsg.classList.remove('hidden');
  setTimeout(() => profileSavedMsg.classList.add('hidden'), 2500);
  renderReport();
});

// 저장소 유틸
function loadProfile() {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(STORAGE_PROFILE) || '{}') };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_RECORDS) || '[]');
  } catch {
    return [];
  }
}

function persistRecords() {
  localStorage.setItem(STORAGE_RECORDS, JSON.stringify(records));
}

function formatDateShort(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateFull(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// 초기 실행
syncProfileForm();
updateMeasureTimestamp();
if (!isWebBluetoothSupported()) {
  appendLog('참고: 현재 브라우저는 Web Bluetooth를 지원하지 않습니다. 갤럭시 Chrome에서 열면 블루투스 연결이 활성화됩니다.');
}
