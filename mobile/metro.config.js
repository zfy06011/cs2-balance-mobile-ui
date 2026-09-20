/**
 * metro.config.js —— Expo 默认配置 + Web 调试支持补丁（v1.8.6-web）。
 *
 * 两个补丁：
 * 1. .wasm 加入 assetExts —— expo-sqlite 自带 Web 实现（wa-sqlite + WASM），
 *    Metro 默认不认识 .wasm，打包 web 会报 "Unable to resolve ./wa-sqlite/wa-sqlite.wasm"。
 * 2. 把两个纯原生模块在 Web 平台重定向到 src/shims/ 下的打桩实现：
 *    - @preeternal/react-native-cookie-manager（抓 Steam cookie，浏览器无此能力）
 *    - react-native-webview（内嵌登录页，浏览器无此组件）
 *    只在 platform === 'web' 时生效，手机端行为完全不变。
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

const WEB_SHIMS = {
  '@preeternal/react-native-cookie-manager': path.resolve(__dirname, 'src/shims/CookieManager.web.ts'),
  'react-native-webview': path.resolve(__dirname, 'src/shims/WebView.web.tsx'),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return { filePath: WEB_SHIMS[moduleName], type: 'sourceFile' };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
