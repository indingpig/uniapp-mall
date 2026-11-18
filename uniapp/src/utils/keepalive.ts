/**
 * 后台保活（Android 前台服务 + 电池优化白名单 + 厂商自启动引导）
 *
 * 分层：前台服务本体在 uts-keepalive UTS 插件（Kotlin 层，改插件需重打自定义
 * 基座）；本文件是业务侧封装——插件的启停转发、电池优化白名单申请、厂商自启动
 * 页跳转，全部只在 APP 端生效，H5/小程序端为无副作用空实现，设置页与 App.vue
 * 无需再做平台判断（分区显隐用 isKeepAliveAvailable）。
 *
 * plus.android 桥接可靠性结论（2026-11-17 真机，详见 saveWav.ts）：
 * - 类名 importClass + new 出来的对象方法表齐全，可放心调用
 * - 桥接返回实例（runtimeMainActivity 的 Activity 除外）的方法调用不保证可用，
 *   一律 try/catch 兜底，失败降级为引导文案
 */

// #ifdef APP-PLUS
import { isRunning, start, stop } from '@/uni_modules/uts-keepalive';
// #endif
import { loadMonitorSettings } from '@/utils/monitorSettings';

/* plus 官方类型未覆盖 android 桥的动态成员，按运行时真实能力做结构化断言（同 saveWav.ts） */
interface AndroidBridge {
  runtimeMainActivity: () => {
    getPackageName: () => string;
    startActivity: (intent: unknown) => void;
    /** Context 方法：saveWav 真机已验证 Activity 实例方法编组可靠（getPackageName 同类） */
    getSystemService: (name: string) => unknown;
  };
  /** 入参可为类名（返回类包装）或实例（注册该方法表，不保证生效，需 try/catch） */
  importClass: (o: unknown) => unknown;
}

/** Intent 的可用方法子集（方法表齐全的场景：类名 importClass + new） */
interface IntentLike {
  setAction: (action: string) => IntentLike;
  setData: (uri: unknown) => IntentLike;
  setClassName: (pkg: string, cls: string) => IntentLike;
}

/** Settings 类的静态常量子集 */
interface SettingsClass {
  ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: string;
  ACTION_APPLICATION_DETAILS_SETTINGS: string;
}

/** Uri 类的静态方法子集 */
interface UriClass {
  parse: (s: string) => unknown;
}

/** Build 类的静态字段子集 */
interface BuildClass {
  MANUFACTURER: string;
}

/**
 * 厂商自启动管理页的已知组件（各家 ROM 版本易变，逐个尝试，全失败兜底应用
 * 详情页）。MANUFACTURER 为小写匹配键；Redmi 归属 Xiaomi、iQOO 归属 vivo。
 */
const AUTO_START_TARGETS: Record<string, Array<[string, string]>> = {
  xiaomi: [
    ['com.miui.securitycenter', 'com.miui.permcenter.autostart.AutoStartManagementActivity'],
  ],
  huawei: [
    ['com.huawei.systemmanager', 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity'],
    ['com.huawei.systemmanager', 'com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity'],
  ],
  honor: [
    ['com.hihonor.systemmanager', 'com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity'],
  ],
  oppo: [
    ['com.coloros.safecenter', 'com.coloros.safecenter.permission.startup.StartupAppListActivity'],
    ['com.oppo.safe', 'com.oppo.safe.permission.startup.StartupAppListActivity'],
    ['com.coloros.oppoguardelf', 'com.coloros.oppoguardelf.permission.startup.StartupAppListActivity'],
  ],
  oneplus: [
    ['com.coloros.safecenter', 'com.coloros.safecenter.permission.startup.StartupAppListActivity'],
  ],
  vivo: [
    ['com.vivo.permissionmanager', 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity'],
    ['com.iqoo.secure', 'com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity'],
  ],
};

/* ------------------------------------------------------------------ */
/*  前台服务转发                                                        */
/* ------------------------------------------------------------------ */

/** 后台保活 UI/逻辑是否可用（仅 Android 端；iOS 无前台服务概念，设置页据此显隐分区） */
export function isKeepAliveAvailable(): boolean {
  // #ifdef APP-PLUS
  try {
    return uni.getSystemInfoSync().platform === 'android';
  }
  catch { return false; }
  // #endif

  // #ifndef APP-PLUS
  return false;
  // #endif
}

/** keepAlive 偏好是否要求启用保活链路（返回键拦截/App 启动拉起共用判定） */
export function isKeepAliveEnabled(): boolean {
  // #ifdef APP-PLUS
  try {
    return isKeepAliveAvailable() && loadMonitorSettings().keepAlive;
  }
  catch { return false; }
  // #endif

  // #ifndef APP-PLUS
  return false;
  // #endif
}

/**
 * 返回键拦截的执行体：把任务退到后台而不销毁 Activity（Android 主页返回键
 * 默认 finish 主 Activity → webview/JS 死亡 → 前台服务也保不住 WebSocket）。
 * 失败时返回 false，调用方回退默认返回行为（App 退出，由 ntfy 兜底推送接管）。
 */
export function moveTaskToBack(): boolean {
  // #ifdef APP-PLUS
  try {
    const bridge = plus.android as unknown as AndroidBridge;
    const main = bridge.runtimeMainActivity() as unknown as { moveTaskToBack: (goHome: boolean) => boolean };
    return !!main.moveTaskToBack(true);
  }
  catch (e) {
    console.warn('[keepalive] moveTaskToBack 失败:', e);
    return false;
  }
  // #endif

  // #ifndef APP-PLUS
  return false;
  // #endif
}

export function isKeepAliveRunning(): boolean {
  // #ifdef APP-PLUS
  try {
    return isRunning();
  }
  catch { return false; }
  // #endif

  // #ifndef APP-PLUS
  return false;
  // #endif
}

/** 启动前台服务（插件内幂等）；失败只记日志不阻塞 UI */
export function startKeepAlive(): void {
  // #ifdef APP-PLUS
  try {
    start();
  }
  catch (e) {
    console.warn('[keepalive] 启动前台服务失败:', e);
  }
  // #endif
}

export function stopKeepAlive(): void {
  // #ifdef APP-PLUS
  try {
    stop();
  }
  catch (e) {
    console.warn('[keepalive] 停止前台服务失败:', e);
  }
  // #endif
}

/* ------------------------------------------------------------------ */
/*  电池优化白名单                                                      */
/* ------------------------------------------------------------------ */

/**
 * 是否已豁免电池优化。桥接实例方法不保证可用，尽力查询。
 * 失败按「未豁免」返回（监护场景 fail-safe：查询失败显示已豁免会让用户误以为
 * 设置完成，实际锁屏即被杀）——设置页会引导用户点行重新检查，重复申请无害
 * （已豁免时系统弹窗直接返回）。
 */
export function isIgnoringBatteryOptimizations(): boolean {
  // #ifdef APP-PLUS
  try {
    const bridge = plus.android as unknown as AndroidBridge;
    const main = bridge.runtimeMainActivity();
    bridge.importClass('android.os.PowerManager'); // 类名注册先行
    const powerManager = bridge.importClass(main.getSystemService('power')) as {
      isIgnoringBatteryOptimizations: (pkg: string) => boolean;
    };
    return !!powerManager.isIgnoringBatteryOptimizations(main.getPackageName());
  }
  catch (e) {
    console.warn('[keepalive] 电池优化状态查询失败（按未豁免处理）:', e);
    return false;
  }
  // #endif

  // #ifndef APP-PLUS
  return false;
  // #endif
}

/**
 * 弹出系统「忽略电池优化」确认框（REQUEST_IGNORE_BATTERY_OPTIMIZATIONS）。
 * 已豁免时系统不弹框直接返回；这里只负责发起，结果由设置页 onShow 重查状态。
 */
export function requestIgnoreBatteryOptimizations(): boolean {
  // #ifdef APP-PLUS
  try {
    const bridge = plus.android as unknown as AndroidBridge;
    const main = bridge.runtimeMainActivity();
    const Intent = bridge.importClass('android.content.Intent') as unknown as new () => IntentLike;
    const Settings = bridge.importClass('android.provider.Settings') as unknown as SettingsClass;
    const Uri = bridge.importClass('android.net.Uri') as unknown as UriClass;
    const intent = new Intent();
    intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
    intent.setData(Uri.parse(`package:${main.getPackageName()}`));
    main.startActivity(intent);
    return true;
  }
  catch (e) {
    console.warn('[keepalive] 发起电池优化白名单申请失败:', e);
    return false;
  }
  // #endif

  // #ifndef APP-PLUS
  return false;
  // #endif
}

/* ------------------------------------------------------------------ */
/*  厂商自启动页跳转                                                    */
/* ------------------------------------------------------------------ */

/** 兜底：应用详情页（用户可从「电池/自启动」入口自行寻找） */
function openAppDetails(): void {
  // #ifdef APP-PLUS
  try {
    const bridge = plus.android as unknown as AndroidBridge;
    const main = bridge.runtimeMainActivity();
    const Intent = bridge.importClass('android.content.Intent') as unknown as new () => IntentLike;
    const Settings = bridge.importClass('android.provider.Settings') as unknown as SettingsClass;
    const Uri = bridge.importClass('android.net.Uri') as unknown as UriClass;
    const intent = new Intent();
    intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
    intent.setData(Uri.parse(`package:${main.getPackageName()}`));
    main.startActivity(intent);
  }
  catch (e) {
    console.warn('[keepalive] 打开应用详情页失败:', e);
  }
  // #endif
}

/**
 * 尝试跳转当前厂商的自启动管理页（小米手机管家/华为启动管理/OV 自启动等）。
 * 组件名随 ROM 版本漂移，逐个尝试；全部失败跳应用详情页降级。
 */
export function openAutoStartSettings(): void {
  // #ifdef APP-PLUS
  let jumped = false;
  try {
    const bridge = plus.android as unknown as AndroidBridge;
    const main = bridge.runtimeMainActivity();
    const Build = bridge.importClass('android.os.Build') as unknown as BuildClass;
    const brand = (Build.MANUFACTURER || '').toLowerCase();
    const Intent = bridge.importClass('android.content.Intent') as unknown as new () => IntentLike;
    for (const [pkg, cls] of AUTO_START_TARGETS[brand] ?? []) {
      try {
        const intent = new Intent();
        intent.setClassName(pkg, cls);
        main.startActivity(intent);
        jumped = true;
        break;
      }
      catch { /* 该组件在当前 ROM 上不存在，尝试下一个 */ }
    }
  }
  catch (e) {
    console.warn('[keepalive] 自启动页跳转失败:', e);
  }
  if (!jumped)
    openAppDetails();
  // #endif
}
