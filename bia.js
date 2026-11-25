/**
 * 체성분(BIA) 계산 모듈
 * 체중(kg), 임피던스(Ω), 키(cm), 나이, 성별을 기반으로 주요 신체 지표를 계산합니다.
 */

export function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

export function round1(val) {
  return Math.round(val * 10) / 10;
}

export function calculateBodyComposition({ weightKg, impedanceOhm = 0, heightCm, age, sex }) {
  const hM = heightCm / 100;
  const bmi = weightKg / (hM * hM);
  const isMale = sex === 'male';
  const hasImpedance = Number.isFinite(impedanceOhm) && impedanceOhm > 100 && impedanceOhm < 1500;

  let bodyFatPct;
  if (hasImpedance) {
    // BIA 임피던스 기반 제지방량(LBM) 추정
    const ri = (heightCm * heightCm) / impedanceOhm;
    const lbm = isMale
      ? 0.485 * ri + 0.338 * weightKg + 5.32 - 0.08 * age
      : 0.474 * ri + 0.180 * weightKg + 5.03 - 0.05 * age;
    const safeLbm = clamp(lbm, weightKg * 0.45, weightKg * 0.94);
    bodyFatPct = ((weightKg - safeLbm) / weightKg) * 100;
  } else {
    // 임피던스 미수신 시 Deurenberg BMI 기반 추정
    bodyFatPct = 1.2 * bmi + 0.23 * age - 10.8 * (isMale ? 1 : 0) - 5.4;
  }

  bodyFatPct = clamp(bodyFatPct, 5, 55);
  const fatMassKg = weightKg * (bodyFatPct / 100);
  const leanMassKg = weightKg - fatMassKg;

  // 골격근량(전체 제지방의 약 55~58%)
  const muscleRatio = isMale ? 0.575 : 0.545;
  const muscleMassKg = clamp(leanMassKg * muscleRatio, weightKg * 0.22, weightKg * 0.65);
  const musclePct = (muscleMassKg / weightKg) * 100;

  // 체수분율 (제지방의 약 73%)
  const waterPct = clamp((leanMassKg * 0.732 / weightKg) * 100, 35, 72);

  // 추정 골량 (kg)
  const boneMassKg = clamp(leanMassKg * (isMale ? 0.058 : 0.052), 1.2, 5.5);

  // 기초대사량 (Mifflin-St Jeor)
  const bmr = Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + (isMale ? 5 : -161));

  // 내장지방 지수 (1~30)
  const visceralBase = (bmi - 18) * 0.65 + (bodyFatPct - (isMale ? 15 : 22)) * 0.22 + age * 0.06;
  const visceralFat = Math.round(clamp(visceralBase, 1, 30));

  // 신체 나이 추정
  const fatMid = isMale ? 18 : 25;
  const ageDelta = (bmi - 22) * 0.7 + (bodyFatPct - fatMid) * 0.35;
  const bodyAge = Math.round(clamp(age + ageDelta, 15, 85));

  return {
    weightKg: round1(weightKg),
    impedanceOhm: hasImpedance ? Math.round(impedanceOhm) : 0,
    hasImpedance,
    bmi: round1(bmi),
    bodyFatPct: round1(bodyFatPct),
    fatMassKg: round1(fatMassKg),
    muscleMassKg: round1(muscleMassKg),
    musclePct: round1(musclePct),
    waterPct: round1(waterPct),
    boneMassKg: round1(boneMassKg),
    bmr,
    visceralFat,
    bodyAge,
    evaluations: {
      bmi: evaluateRange(bmi, 18.5, 23.0, 25.0),
      bodyFatPct: isMale
        ? evaluateRange(bodyFatPct, 10, 20, 25)
        : evaluateRange(bodyFatPct, 18, 28, 33),
      musclePct: isMale
        ? evaluateHigherBetter(musclePct, 36, 42)
        : evaluateHigherBetter(musclePct, 30, 35),
      waterPct: isMale
        ? evaluateRange(waterPct, 50, 65, 70)
        : evaluateRange(waterPct, 45, 60, 65),
      visceralFat: evaluateLowerBetter(visceralFat, 9, 14)
    }
  };
}

function evaluateRange(val, low, normalMax, warnMax) {
  if (val < low) return { level: 'low', label: '낮음' };
  if (val <= normalMax) return { level: 'normal', label: '적정' };
  if (val <= warnMax) return { level: 'warn', label: '주의' };
  return { level: 'high', label: '높음' };
}

function evaluateHigherBetter(val, low, good) {
  if (val < low) return { level: 'low', label: '부족' };
  if (val < good) return { level: 'normal', label: '보통' };
  return { level: 'normal', label: '우수' };
}

function evaluateLowerBetter(val, normalMax, warnMax) {
  if (val <= normalMax) return { level: 'normal', label: '적정' };
  if (val <= warnMax) return { level: 'warn', label: '주의' };
  return { level: 'high', label: '높음' };
}
