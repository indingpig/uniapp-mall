import { defineManifestConfig } from '@uni-helper/vite-plugin-uni-manifest';

export default defineManifestConfig({
  'name': '宝宝监护器',
  'appid': '__UNI__F18597F',
  'description': '婴儿监护器 - 实时监测宝宝状态',
  'versionName': '1.0.0',
  'versionCode': '100',
  'transformPx': false,
  // 应用默认语言：固定 zh-Hans，H5 端内置组件文案（ActionSheet 取消、Modal 按钮等）不随浏览器语言漂移
  'locale': 'zh-Hans',
  /* 5+App特有相关 */
  'app-plus': {
    usingComponents: true,
    nvueStyleCompiler: 'uni-app',
    compilerVersion: 3,
    splashscreen: {
      alwaysShowBeforeRender: true,
      waiting: true,
      autoclose: true,
      delay: 0,
    },
    /* 模块配置 */
    modules: {
      // 开启蓝牙模块（key 必须小写）
      bluetooth: {
        description: '用于扫描并连接宝宝监护器设备',
      },
    },
    /* 应用发布信息 */
    distribute: {
      /* android打包配置 */
      android: {
        permissions: [
          '<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE"/>',
          '<uses-permission android:name="android.permission.MOUNT_UNMOUNT_FILESYSTEMS"/>',
          '<uses-permission android:name="android.permission.VIBRATE"/>',
          '<uses-permission android:name="android.permission.ACCESS_WIFI_STATE"/>',
          '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>',
          '<uses-permission android:name="android.permission.CHANGE_WIFI_STATE"/>',
          '<uses-permission android:name="android.permission.WAKE_LOCK"/>',
          '<uses-permission android:name="android.permission.WRITE_SETTINGS"/>',
          // 蓝牙权限（用于设备配对）
          '<uses-permission android:name="android.permission.BLUETOOTH"/>',
          '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN"/>',
          // BLE 扫描需要定位权限（Android 6+）
          '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>',
          '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>',
          // Android 12+ 蓝牙权限
          '<uses-permission android:name="android.permission.BLUETOOTH_SCAN"/>',
          '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>',
          // 声明使用 BLE 功能（Google Play 要求，普通 BLE 设备不需要硬件过滤）
          '<uses-feature android:name="android.hardware.bluetooth_le" android:required="true"/>',
        ],
        // <uses-permission android:name="android.permission.BLUETOOTH"/> <uses-permission android:name="android.permission.BLUETOOTH_ADMIN"/> <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" /> <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/> <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
      },
      /* ios打包配置 */
      ios: {
        // Apple Developer 后台创建的 Bundle ID，如 com.sheldon.babycry
        appid: '',
        // 证书密码（创建 .p12 时设置的）
        password: '',
        // 证书文件路径（放在 uniapp/ 根目录下）
        p12: 'ios_distribution.p12',
        // 描述文件路径
        mobileprovision: 'ios_distribution.mobileprovision',
        // 隐私权限描述（麦克风权限必须，因为涉及录音功能）
        privacyDescription: {
          NSPhotoLibraryUsageDescription: '用于保存宝宝状态截图',
          NSMicrophoneUsageDescription: '用于监测宝宝哭声',
          NSBluetoothAlwaysUsageDescription: '用于蓝牙扫描并连接宝宝监护器设备',
          NSBluetoothPeripheralUsageDescription: '用于与宝宝监护器设备通信',
          // 局域网直连开发板（采集页连 ws://babycry.local 或板子 IP）
          NSLocalNetworkUsageDescription: '用于连接同一局域网内的宝宝监护器设备进行数据采集',
        },
      },
      /* 应用图标：路径相对「HBuilderX 导入的项目根」（uniapp/）解析，不是 src/；
         图标在 uniapp/icons/app/（设计源图在 src/design/appIcon/） */
      icons: {
        android: {
          hdpi: 'icons/app/icon-72x72.png',
          xhdpi: 'icons/app/icon-96x96.png',
          xxhdpi: 'icons/app/icon-144x144.png',
          xxxhdpi: 'icons/app/icon-192x192.png',
        },
        ios: {
          appstore: 'icons/app/icon-1024x1024.png',
          iphone: {
            'app@2x': 'icons/app/icon-120x120.png',
            'app@3x': 'icons/app/icon-180x180.png',
            'spotlight@2x': 'icons/app/icon-80x80.png',
            'spotlight@3x': 'icons/app/icon-120x120.png',
            'settings@2x': 'icons/app/icon-58x58.png',
            'settings@3x': 'icons/app/icon-87x87.png',
            'notification@2x': 'icons/app/icon-40x40.png',
            'notification@3x': 'icons/app/icon-60x60.png',
          },
        },
      },
      /* SDK配置 */
      sdkConfigs: {},
    },
  },
  /* 快应用特有相关 */
  'quickapp': {},
  /* 小程序特有相关 */
  'mp-weixin': {
    appid: '',
    setting: {
      urlCheck: false,
    },
    usingComponents: true,
    darkmode: true,
    themeLocation: 'theme.json',
    permission: {
      'scope.bluetooth': {
        desc: '用于扫描并连接宝宝监护器设备',
      },
    },
  },
  'mp-alipay': {
    usingComponents: true,
  },
  'mp-baidu': {
    usingComponents: true,
  },
  'mp-toutiao': {
    usingComponents: true,
  },
  'h5': {
    darkmode: true,
    themeLocation: 'theme.json',
  },
  'uniStatistics': {
    enable: false,
  },
  'vueVersion': '3',
});
