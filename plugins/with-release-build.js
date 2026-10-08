const { withGradleProperties } = require('@expo/config-plugins');

module.exports = function withReleaseBuild(config) {
  return withGradleProperties(config, (mod) => {
    const properties = {
      'android.enableMinifyInReleaseBuilds': 'true',
      'android.enableShrinkResourcesInReleaseBuilds': 'true',
      'reactNativeArchitectures': 'arm64-v8a',
    };
    mod.modResults = mod.modResults.filter((item) => item.type !== 'property' || !(item.key in properties));
    mod.modResults.push(...Object.entries(properties).map(([key, value]) => ({ type: 'property', key, value })));
    return mod;
  });
};
