/**
 * WAV 文件保存（平台差异逻辑）
 *
 * 独立成 .ts 的原因: 平台条件编译指令（#ifdef APP-PLUS 等）写在页面 .vue 里
 * 会被 vite-plugin-uni-pages 扫描成"页面平台限制"，生成 pages.json 时把页面
 * 包进 #ifdef H5，导致 App 端不注册该页面（collect 页踩坑实录）。
 * 指令只允许出现在非页面文件里。
 */

export interface SaveWavCallbacks {
  /** 保存成功，where 为可读的位置描述 */
  onSaved: (where: string) => void;
  /** 保存失败或写文件异常 */
  onError: (msg: string) => void;
}

export function saveWavFile(wav: ArrayBuffer, name: string, cb: SaveWavCallbacks): void {
  // #ifdef APP-PLUS
  const isAndroid = uni.getSystemInfoSync().platform === 'android';

  /**
   * EMUI 原生直写: plus.io 的 Blob 写在 EMUI 上静默 0 字节（2026-11-17 真机，
   * 整块/分片双路均失败），改走 plus.android FileOutputStream 直写。
   * base64 字符串过桥，byte[] 全程留在 Java 内部，规避 JS/Java 数组编组。
   * 成功返回「路径 (字节数)」，失败返回空串。
   */
  function saveWavAndroidNative(): string {
    // plus 官方类型未覆盖 android 桥的动态成员, 按运行时真实能力做结构化断言
    const androidBridge = plus.android as unknown as {
      runtimeMainActivity: () => { getPackageName: () => string };
      importClass: (o: unknown) => unknown;
    };
    try {
      const bytes = new Uint8Array(wav);
      let bin = '';
      const STEP = 8192;
      for (let i = 0; i < bytes.length; i += STEP)
        bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
      const b64 = btoa(bin);

      const main = androidBridge.runtimeMainActivity() as { getPackageName: () => string };
      // 注意: 对桥接返回的实例 importClass 不保证注册方法表 (2026-11-17 真机:
      // dir.mkdirs is not a function) —— 类名 importClass + new 出来的对象才
      // 方法齐全。目录 Java 侧 getExternalFilesDir 已自动创建, mkdirs 兜底;
      // 路径用包名拼, getPackageName 返回 String, 编组可靠
      const pkg = main.getPackageName();
      const JFileCls = androidBridge.importClass('java.io.File') as new (
        path: string,
      ) => { mkdirs: () => boolean; getAbsolutePath: () => string };
      const dir = new JFileCls(`/storage/emulated/0/Android/data/${pkg}/files/BabyCry`);
      dir.mkdirs();
      const path = `${dir.getAbsolutePath()}/${name}`;

      const Base64 = androidBridge.importClass('android.util.Base64') as {
        decode: (str: string, flags: number) => unknown;
      };
      const data = Base64.decode(b64, 0); // Base64.DEFAULT
      const FOS = androidBridge.importClass('java.io.FileOutputStream') as new (
        path: string,
      ) => { write: (data: unknown) => void; flush: () => void; close: () => void };
      const fos = new FOS(path);
      fos.write(data);
      fos.flush();
      fos.close();

      const JFile = androidBridge.importClass('java.io.File') as new (
        path: string,
      ) => { length: () => number };
      const jf = new JFile(path);
      const len = Number(jf.length());
      if (len > 0)
        return `${path} (${len}B)`;
      console.warn('[saveWav] 原生直写后仍为 0 字节:', path);
      return '';
    }
    catch (e) {
      console.warn('[saveWav] 原生直写失败:', e);
      return '';
    }
  }

  if (isAndroid) {
    const nativePath = saveWavAndroidNative();
    if (nativePath) {
      cb.onSaved(nativePath);
      return;
    }
    console.warn('[saveWav] 原生直写失败, 回退 plus.io 级联');
    // 回退: 下方 plus.io 级联（Blob 整块 → 回读校验 → 分片），iOS 或
    // plus.android 不可用的极端情况仍有一条路
  }

  plus.io.requestFileSystem(
    isAndroid ? plus.io.PUBLIC_DOWNLOADS : plus.io.PUBLIC_DOCUMENTS,
    (fs) => {
      const root = fs.root;
      if (!root)
        return;
      const dirName = isAndroid ? 'BabyCry' : 'audio';
      root.getDirectory(dirName, { create: true }, (dir) => {
        dir.getFile(name, { create: true }, (fe) => {
          fe.createWriter((writer) => {
            // 真实落盘绝对路径: EMUI 上 PUBLIC_DOWNLOADS 实际映射到应用外部
            // 目录 (Android/data/...), 硬编码「下载目录」文案会骗人
            const fullPath = fe.fullPath ?? '';
            let realPath: string = fullPath;
            try {
              realPath = plus.io.convertLocalFileSystemURL(fullPath) ?? fullPath;
            }
            catch { /* 保持 fullPath */ }

            // 写后回读校验: EMUI 上整块 Blob 写会触发 onwrite 却静默 0 字节
            // (2026-11-16 真机), 必须读回大小确认, 0 字节则降级分片写
            function verifyOrFallback(chunkedTried: boolean) {
              fe.file((f) => {
                const size = (f as unknown as { size?: number }).size ?? 0;
                if (size > 0) {
                  cb.onSaved(`${realPath} (${size}B)`);
                  return;
                }
                if (chunkedTried) {
                  cb.onError(`写入后文件为 0 字节, 路径: ${realPath}`);
                  return;
                }
                chunkedWrite();
              }, () => {
                if (chunkedTried)
                  cb.onError(`写入校验失败, 路径: ${realPath}`);
                else
                  chunkedWrite();
              });
            }

            function chunkedWrite() {
              const blob = new Blob([wav], { type: 'audio/wav' });
              const CHUNK = 32768;
              let pos = 0;
              const step = () => {
                if (pos >= blob.size) {
                  verifyOrFallback(true);
                  return;
                }
                writer.seek(pos);
                writer.write(blob.slice(pos, pos + CHUNK) as unknown as string);
                pos += CHUNK;
              };
              writer.onwrite = step;
              writer.onerror = () => cb.onError('分片写入失败');
              step();
            }

            writer.onwrite = () => verifyOrFallback(false);
            writer.onerror = () => cb.onError(`写入文件失败: ${name}`);
            // plus 类型声明只标了 string 入参, 运行时接受 Blob (官方写法)
            writer.write(new Blob([wav], { type: 'audio/wav' }) as unknown as string);
          }, () => cb.onError('创建写入器失败'));
        }, () => cb.onError(`创建文件失败: ${name}`));
      }, () => cb.onError('创建目录失败'));
    },
    e => cb.onError(`保存失败(目录不可写): ${JSON.stringify(e)}`),
  );
  // #endif
  // #ifndef APP-PLUS
  const blob = new Blob([wav], { type: 'audio/wav' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  cb.onSaved('浏览器下载目录');
  // #endif
}
