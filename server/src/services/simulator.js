let timer = null;

export function startSimulator(detector, dataStore) {
  let count = 0;

  timer = setInterval(() => {
    count++;

    // 模拟不同场景的 RMS 值
    let rms, peak;
    if (count > 0 && count <= 30) {
      // 第一阶段：安静（睡觉）—— 低音量
      rms = 30 + Math.random() * 30;
      peak = rms * 1.5;
    } else if (count > 30 && count <= 45) {
      // 第二阶段：逐渐醒来 —— 中等音量
      rms = 60 + Math.random() * 80;
      peak = rms * 1.8;
    } else if (count > 45 && count <= 55) {
      // 第三阶段：开始哭闹 —— 高音量
      rms = 180 + Math.random() * 120;
      peak = rms * 2.0;
    } else if (count > 55 && count <= 65) {
      // 第四阶段：哭闹持续
      rms = 200 + Math.random() * 150;
      peak = rms * 2.5;
    } else if (count > 65 && count <= 75) {
      // 第五阶段：哭声减弱
      rms = 100 + Math.random() * 100;
      peak = rms * 2.0;
    } else if (count > 75 && count <= 100) {
      // 第六阶段：逐渐安静
      rms = 40 + Math.random() * 40;
      peak = rms * 1.5;
    } else {
      // 循环
      count = 0;
      rms = 30 + Math.random() * 30;
      peak = rms * 1.5;
    }

    rms = Math.round(rms);
    peak = Math.round(peak);

    detector.feed(rms, peak);
    dataStore.addRecord(rms, peak, detector.status);

    console.log(`[Simulator] RMS=${rms} Peak=${peak} Status=${detector.status}`);
  }, 500);
}

export function stopSimulator() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
