/** Expo 在打包时内联公开的构建渠道标记；正式版本默认 production。 */
export type BuildChannel = 'production' | 'rc';
export const BUILD_CHANNEL: BuildChannel = process.env.EXPO_PUBLIC_BUILD_CHANNEL === 'rc' ? 'rc' : 'production';
export const IS_RC_BUILD: boolean = BUILD_CHANNEL === ('rc' as BuildChannel);
