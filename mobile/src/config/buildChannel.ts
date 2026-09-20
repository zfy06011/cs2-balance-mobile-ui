/** 编译期渠道；正式源码保持 production，内部 RC 构建时临时切为 rc。 */
export type BuildChannel = 'production' | 'rc';
export const BUILD_CHANNEL: BuildChannel = 'production';
export const IS_RC_BUILD: boolean = BUILD_CHANNEL === ('rc' as BuildChannel);
