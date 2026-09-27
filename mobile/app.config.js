module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'rc') return config;
  if (!config.android?.package) throw new Error('Android package is required for RC builds');

  return {
    ...config,
    name: `${config.name} RC`,
    version: `${config.version}-rc`,
    android: {
      ...config.android,
      package: `${config.android.package}.rc`,
    },
  };
};
