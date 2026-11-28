import { createSSRApp } from 'vue';
import App from './App.vue';

// #ifdef H5
// uni-h5 缺陷：同一页面链式 uni.showModal（success 回调里同步再开第二个）第二个永不显示。
// 根因：确认/取消时组件 close 只复位本地 visible，但 createRootApp 的 onClose 随后把
// showModalState.visible 置回 false；同步链式时 API 内部又立刻置 true——true→false→true
// 塌缩在同一次 Vue flush 里，watch(props.visible) 判定无变化不触发，本地 visible 永远停在
// false（display:none，不自愈）。跨导航/延迟调用正常，因为 false 已独自过完一次 flush。
// 兼容补丁：推迟一个宏任务调原始 API，让上一次 close 的 false 先单独过 flush；args 再多带
// visible:false 兜底。App/小程序端不受此影响，不包装。
type ShowModalArgs = Parameters<typeof uni.showModal>[0];
const rawShowModal = uni.showModal.bind(uni);
uni.showModal = ((opts: ShowModalArgs = {} as ShowModalArgs) =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        Promise.resolve(rawShowModal({ visible: false, ...opts } as ShowModalArgs)).then(resolve, reject);
      }
      catch (err) {
        reject(err);
      }
    }, 0);
  })) as typeof uni.showModal;
// #endif

export function createApp() {
  const app = createSSRApp(App);
  return {
    app,
  };
}
