import * as SecureStore from 'expo-secure-store';

export const SECURE_SETTING_KEYS = {
  c5AppKey: 'settings.c5AppKey',
  steamCookie: 'settings.steamCookie',
} as const;

type SecureSettingName = keyof typeof SECURE_SETTING_KEYS;

export async function readSecureSetting(name: SecureSettingName): Promise<string | null> {
  return SecureStore.getItemAsync(SECURE_SETTING_KEYS[name]);
}

export async function writeSecureSetting(name: SecureSettingName, value: string): Promise<void> {
  const key = SECURE_SETTING_KEYS[name];
  if (value) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
