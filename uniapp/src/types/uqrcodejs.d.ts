/**
 * uqrcodejs 无官方类型声明，按 README 用法声明本项目用到的 API 面。
 * 真值源：node_modules/uqrcodejs/README.md（new UQRCode → data/size → make →
 * canvasContext → drawCanvas，老版 uni canvas 上下文三端通用）。
 */
declare module 'uqrcodejs' {
  export default class UQRCode {
    data: string;
    size: number;
    canvasContext: unknown;
    constructor();
    make(): void;
    drawCanvas(): void;
  }
}
