import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Run after build:mobile and cap sync. This rejects a demo-only native build,
// mismatched signing identities and a missing OAuth return route before compiling.
const target=process.argv[2];
assert(['android','ios'].includes(target),'Expected platform argument: android or ios');
const mobileConfig=JSON.parse(await readFile('mobile.config.json','utf8').catch(()=>'{}'));
const raw=process.env.VITE_API_URL||mobileConfig.apiOrigin;
assert(raw,'VITE_API_URL is required for a native build');
const api=new URL(raw);
assert.equal(api.protocol,'https:','The mobile API must use HTTPS');
assert(!api.username&&!api.password&&!api.search&&!api.hash,'The API origin must not contain credentials, a query or a fragment');
assert(api.pathname==='/'||api.pathname==='','Use the API origin without /api');
assert(!['localhost','127.0.0.1','0.0.0.0','::1'].includes(api.hostname),'A physical phone cannot use this computer\'s loopback address');
const origin=api.origin;
const pkg=JSON.parse(await readFile('package.json','utf8'));
const capSource=await readFile('capacitor.config.ts','utf8');
const appId=capSource.match(/appId:\s*['"]([^'"]+)['"]/)?.[1];
assert(appId&&/^[a-z][\w]*(?:\.[a-z][\w]*){2,}$/.test(appId),'A stable reverse-DNS Capacitor appId is required');
assert(/webDir:\s*(['"])dist-mobile\1/.test(capSource),'Native builds must use the generated dist-mobile assets');
assert(!/\burl\s*:\s*['"]https?:\/\//.test(capSource),'Native release must bundle its UI, without a development server.url');

const assets=await readdir('dist-mobile/assets');
const javascript=await Promise.all(assets.filter(name=>name.endsWith('.js')).map(name=>readFile(resolve('dist-mobile/assets',name),'utf8')));
assert(javascript.some(content=>content.includes(origin)),'The mobile bundle does not contain the configured online API origin');
const html=await readFile('dist-mobile/index.html','utf8');
assert(/<html\s+lang="en"/.test(html),'First launch document must start in English');

if(target==='android'){
  const gradle=await readFile('android/app/build.gradle','utf8');
  const manifest=await readFile('android/app/src/main/AndroidManifest.xml','utf8');
  assert.equal(gradle.match(/applicationId\s+"([^"]+)"/)?.[1],appId,'Android applicationId differs from Capacitor appId');
  assert.equal(gradle.match(/versionName\s+"([^"]+)"/)?.[1],pkg.version,'Android versionName differs from package version');
  assert(manifest.includes(`android:scheme="${appId}" android:host="auth"`),'Android OAuth return route is missing');
  assert(manifest.includes('android:usesCleartextTraffic="false"'),'Android release must keep cleartext HTTP disabled');
  assert(manifest.includes('android:allowBackup="false"'),'Guest/session storage must not be copied through Android backup');
  const synced=JSON.parse(await readFile('android/app/src/main/assets/capacitor.config.json','utf8'));
  assert.equal(synced.appId,appId,'Run cap sync after changing Capacitor configuration');
}else{
  const project=await readFile('ios/App/App.xcodeproj/project.pbxproj','utf8');
  const plist=await readFile('ios/App/App/Info.plist','utf8');
  const identifiers=[...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)].map(match=>match[1].trim());
  assert(identifiers.length>0&&identifiers.every(value=>value===appId),'iOS bundle identifiers differ from Capacitor appId');
  const versions=[...project.matchAll(/MARKETING_VERSION\s*=\s*([^;]+);/g)].map(match=>match[1].trim());
  assert(versions.length>0&&versions.every(value=>value===pkg.version),'iOS marketing version differs from package version');
  const deviceFamilies=[...project.matchAll(/TARGETED_DEVICE_FAMILY\s*=\s*"([^"]+)";/g)].map(match=>match[1].split(',').map(value=>value.trim()).sort().join(','));
  assert(deviceFamilies.length>0&&deviceFamilies.every(value=>value==='1,2'),'The iOS app must support both iPhone and iPad');
  const plistStrings=(key)=>{
    const content=plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1];
    assert(content,`iOS ${key} array is missing`);
    return [...content.matchAll(/<string>([^<]+)<\/string>/g)].map(match=>match[1]);
  };
  assert.deepEqual(plistStrings('UIRequiredDeviceCapabilities'),['arm64'],'The iOS 15+ app requires arm64, without unnecessary phone-only hardware restrictions');
  assert(/<key>CFBundleDevelopmentRegion<\/key>\s*<string>en<\/string>/.test(plist),'Native iOS development language must be English');
  assert.deepEqual(plistStrings('CFBundleLocalizations').sort(),['de','en','fr','ru'],'Declare all four supported native iOS localizations');
  const iconDirectory='ios/App/App/Assets.xcassets/AppIcon.appiconset';
  const iconCatalog=JSON.parse(await readFile(`${iconDirectory}/Contents.json`,'utf8'));
  const icon=iconCatalog.images?.find(image=>image.idiom==='universal'&&image.platform==='ios'&&image.size==='1024x1024');
  assert(icon&&/^[\w.@-]+\.png$/.test(icon.filename),'The iOS asset catalog needs a bundled universal 1024px PNG icon');
  const iconData=await readFile(`${iconDirectory}/${icon.filename}`);
  assert(iconData.length>=26&&iconData.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'The iOS app icon must be a PNG file');
  assert.equal(iconData.readUInt32BE(16),1024,'The iOS icon width must be 1024px');
  assert.equal(iconData.readUInt32BE(20),1024,'The iOS icon height must be 1024px');
  assert.equal(iconData[25],2,'Export the iOS icon as opaque RGB PNG without an alpha channel');
  assert(plist.includes(`<string>${appId}</string>`),'iOS OAuth URL scheme is missing');
  assert(!plist.includes('NSAllowsArbitraryLoads'),'iOS release must not weaken App Transport Security');
  const synced=JSON.parse(await readFile('ios/App/App/capacitor.config.json','utf8'));
  assert.equal(synced.appId,appId,'Run cap sync after changing Capacitor configuration');
}
console.log(`Native preflight passed: ${target}, ${appId}, version ${pkg.version}, API ${origin}`);
