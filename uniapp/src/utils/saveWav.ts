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
            writer.onwrite = () =>
              cb.onSaved(isAndroid ? '下载目录/BabyCry/' : 'App 文档目录/audio/');
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
