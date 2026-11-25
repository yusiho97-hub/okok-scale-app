/**
 * OKOK 호환 블루투스(Web Bluetooth) 통신 모듈
 * - 표준 GATT 연결 모드 (Weight Scale 0x181D, Body Composition 0x181B, Chipsea/OKOK 0xFFF0 / 0xFFE0)
 * - BLE 광고 패킷 스캔 모드 (requestLEScan 지원 브라우저용)
 */

const SCALE_SERVICE_UUIDS = [
  0x181d, // Weight Scale
  0x181b, // Body Composition
  0xfff0, // Chipsea / OKOK common
  0xffe0, // Generic BLE UART / OKOK variant
  0xffb0, // Scale vendor service
  0xfef5,
  0x180f,
  0x180a
];

export function isWebBluetoothSupported() {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export function isLEScanSupported() {
  return isWebBluetoothSupported() && typeof navigator.bluetooth.requestLEScan === 'function';
}

export function toHex(dataViewOrBuffer) {
  const bytes = dataViewOrBuffer instanceof DataView
    ? new Uint8Array(dataViewOrBuffer.buffer, dataViewOrBuffer.byteOffset, dataViewOrBuffer.byteLength)
    : new Uint8Array(dataViewOrBuffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

/**
 * 다양한 OKOK/표준 체중계 패킷에서 체중(kg)과 임피던스(Ω)를 추출합니다.
 */
export function parseScaleBytes(dataView, uuid = '') {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  if (bytes.length < 2) return null;

  const lowerUuid = String(uuid).toLowerCase();

  // 1) 표준 Bluetooth Weight Scale (0x2A9D)
  if (lowerUuid.includes('2a9d') && bytes.length >= 3) {
    const flags = bytes[0];
    const isImperial = (flags & 0x01) !== 0;
    const rawWeight = dataView.getUint16(1, true);
    const weightKg = isImperial ? rawWeight * 0.01 * 0.453592 : rawWeight * 0.005;
    if (weightKg >= 5 && weightKg <= 250) {
      return { weightKg, impedanceOhm: 0, stable: true, source: 'SIG-2A9D' };
    }
  }

  // 2) 표준 Bluetooth Body Composition (0x2A9C)
  if (lowerUuid.includes('2a9c') && bytes.length >= 4) {
    const flags = dataView.getUint16(0, true);
    const isImperial = (flags & 0x0001) !== 0;
    const rawWeight = dataView.getUint16(bytes.length - 2, true);
    const weightKg = isImperial ? rawWeight * 0.01 * 0.453592 : rawWeight * 0.005;
    if (weightKg >= 5 && weightKg <= 250) {
      return { weightKg, impedanceOhm: 0, stable: true, source: 'SIG-2A9C' };
    }
  }

  // 3) OKOK / Chipsea 0xCA 헤더 프레임
  if (bytes[0] === 0xca && bytes.length >= 6) {
    const rawWeight = (bytes[3] << 8) | bytes[4];
    const weightKg = rawWeight / 100;
    let impedanceOhm = 0;
    if (bytes.length >= 10) {
      const imp = (bytes[7] << 8) | bytes[8];
      if (imp >= 100 && imp <= 1500) impedanceOhm = imp;
    }
    if (weightKg >= 5 && weightKg <= 250) {
      const stable = (bytes[1] & 0x01) !== 0 || bytes.length >= 8;
      return { weightKg, impedanceOhm, stable, source: 'OKOK-CA' };
    }
  }

  // 4) OKOK 광고 패킷 일반 형식 (앞 2바이트 빅엔디안 체중 / 100 또는 / 10)
  if (bytes.length >= 6) {
    const w100 = ((bytes[0] << 8) | bytes[1]) / 100;
    if (w100 >= 15 && w100 <= 220) {
      let impedanceOhm = 0;
      if (bytes.length >= 4) {
        const impCandidate = (bytes[2] << 8) | bytes[3];
        if (impCandidate >= 150 && impCandidate <= 1200) {
          impedanceOhm = impCandidate;
        }
      }
      return { weightKg: w100, impedanceOhm, stable: true, source: 'OKOK-BE100' };
    }

    // 리틀엔디안 후보
    const wLE = (bytes[0] | (bytes[1] << 8)) / 100;
    if (wLE >= 15 && wLE <= 220) {
      return { weightKg: wLE, impedanceOhm: 0, stable: true, source: 'OKOK-LE100' };
    }
  }

  return null;
}

export async function connectScaleGatt({ onLog, onMeasurement, onDisconnect }) {
  if (!isWebBluetoothSupported()) {
    throw new Error('이 브라우저는 블루투스 연결을 지원하지 않아요. 안드로이드 Chrome을 사용해 주세요.');
  }

  onLog('체중계 선택 창을 여는 중...');
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: SCALE_SERVICE_UUIDS
  });

  onLog(`기기 선택됨: ${device.name || '이름 없는 체중계'}`);
  device.addEventListener('gattserverdisconnected', () => {
    onLog('체중계 연결이 종료되었습니다.');
    onDisconnect?.();
  });

  const server = await device.gatt.connect();
  onLog('GATT 서버 연결 완료, 데이터 채널 찾는 중...');

  const services = await server.getPrimaryServices();
  let subscribedCount = 0;

  for (const service of services) {
    const chars = await service.getCharacteristics();
    for (const ch of chars) {
      if (ch.properties.notify || ch.properties.indicate) {
        await ch.startNotifications();
        ch.addEventListener('characteristicvaluechanged', (ev) => {
          const dv = ev.target.value;
          const hex = toHex(dv);
          onLog(`[수신 ${ch.uuid.slice(4, 8)}] ${hex}`);
          const parsed = parseScaleBytes(dv, ch.uuid);
          if (parsed) {
            onMeasurement(parsed);
          }
        });
        subscribedCount++;
        onLog(`수신 대기 시작: ${ch.uuid.slice(4, 8)}`);
      }
    }
  }

  if (subscribedCount === 0) {
    onLog('알림 채널이 없는 체중계입니다. 아래 "신호 스캔 모드"를 시도해 보세요.');
  }

  return {
    deviceName: device.name || 'OKOK 체중계',
    disconnect: () => {
      if (device.gatt?.connected) device.gatt.disconnect();
    }
  };
}

export async function startAdvertisementScan({ onLog, onMeasurement }) {
  if (!isLEScanSupported()) {
    throw new Error(
      '현재 Chrome에서 신호 스캔 기능이 꺼져 있어요. 주소창에 chrome://flags/#enable-experimental-web-platform-features 를 열어 Enabled로 바꾼 뒤 다시 시도해 주세요.'
    );
  }

  onLog('주변 체중계 신호 스캔을 시작합니다. 체중계에 올라가 주세요...');
  const scan = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });

  const handler = (event) => {
    const name = event.device?.name || '';
    if (event.manufacturerData && event.manufacturerData.size > 0) {
      for (const [companyId, dv] of event.manufacturerData.entries()) {
        const hex = toHex(dv);
        const parsed = parseScaleBytes(dv);
        if (parsed || /okok|scale|chipsea|cs/i.test(name)) {
          onLog(`[광고 ${name || '무명'} / 0x${companyId.toString(16)}] ${hex}`);
          if (parsed) onMeasurement(parsed);
        }
      }
    }
  };

  navigator.bluetooth.addEventListener('advertisementreceived', handler);

  return {
    stop: () => {
      navigator.bluetooth.removeEventListener('advertisementreceived', handler);
      scan.stop();
      onLog('신호 스캔을 중지했습니다.');
    }
  };
}
