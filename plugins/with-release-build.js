const { withGradleProperties, withMainApplication } = require('@expo/config-plugins');

module.exports = function withReleaseBuild(config) {
  config = withMainApplication(config, (mod) => {
    const source = mod.modResults.contents;
    if (!source.includes('useDevSupport = BuildConfig.DEBUG')) {
      const anchor = 'context = applicationContext,';
      if (source.split(anchor).length !== 2) {
        throw new Error('Cannot locate the Expo ReactHost context in MainApplication.');
      }
      mod.modResults.contents = source.replace(
        anchor,
        `${anchor}\n      useDevSupport = BuildConfig.DEBUG,`,
      );
    }
    return mod;
  });
  return withGradleProperties(config, (mod) => {
    const properties = {
      'android.enableMinifyInReleaseBuilds': 'true',
      'android.enableShrinkResourcesInReleaseBuilds': 'true',
      reactNativeArchitectures: 'arm64-v8a',
    };
    mod.modResults = mod.modResults.filter(
      (item) => item.type !== 'property' || !(item.key in properties),
    );
    mod.modResults.push(
      ...Object.entries(properties).map(([key, value]) => ({ type: 'property', key, value })),
    );
    return mod;
  });
};
