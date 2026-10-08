const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

module.exports = function withReportNetwork(config) {
  config = withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/report_network_security';
    return mod;
  });
  return withDangerousMod(config, ['android', (mod) => {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'report_network_security.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">bfzks.xueqingroom.cn</domain>
  </domain-config>
  <debug-overrides><trust-anchors><certificates src="user" /></trust-anchors></debug-overrides>
</network-security-config>
`);
    return mod;
  }]);
};
