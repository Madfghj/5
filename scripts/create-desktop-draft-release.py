"""Create a draft only after all three native artifact reports verify."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise SystemExit('A plain semantic version is required')
commit = os.environ['GITHUB_SHA']
if not re.fullmatch(r'[0-9a-f]{40}', commit):
    raise SystemExit('A full immutable source commit is required')
directory = Path(sys.argv[1]).resolve()
reports = ['macOS-native-verification.json', 'windows-native-verification.json', 'linux-native-verification.json']
verified = set(reports)
for name in reports:
    report = json.loads((directory / name).read_text())
    if report.get('version') != version or report.get('bundleId') != 'space.opencalendar.app':
        raise SystemExit('Native artifact identity/version differs: ' + name)
    if report.get('storePublished') is not False:
        raise SystemExit('Expected an explicitly labelled test build: ' + name)
    if report.get('sourceCommit') != commit:
        raise SystemExit('Native report was built from a different source commit: ' + name)
    if len(report.get('files', [])) != 2:
        raise SystemExit('Each platform must provide exactly two verified downloads')
    for item in report['files']:
        filename = item['name']
        if Path(filename).name != filename or filename in verified:
            raise SystemExit('Unsafe or duplicate release filename')
        asset = directory / filename
        if asset.stat().st_size != item['bytes'] or hashlib.sha256(asset.read_bytes()).hexdigest() != item['sha256']:
            raise SystemExit('A native download does not match its verification report: ' + filename)
        verified.add(filename)
actual = {path.name for path in directory.iterdir() if path.is_file()}
if actual != verified:
    raise SystemExit('Unexpected or missing files in the release asset directory')
checksums = directory / 'SHA256SUMS-desktop.txt'
checksums.write_text(''.join(f'{hashlib.sha256((directory / name).read_bytes()).hexdigest()}  {name}\n'
                             for name in sorted(verified)), encoding='utf-8')
tag = 'v' + version
repo = os.environ['GH_REPO']
if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
    raise SystemExit('Unexpected repository name')
# Refuse to retarget or overwrite an existing version. Never force-push a tag.
for endpoint in [f'git/ref/tags/{tag}', f'releases/tags/{tag}']:
    request = urllib.request.Request(f'https://api.github.com/repos/{repo}/{endpoint}', headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'OpenCalendar-release-verifier',
    })
    try:
        with urllib.request.urlopen(request, timeout=30):
            raise SystemExit('This version already exists. Inspect it manually; no files were overwritten.')
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise SystemExit('Could not safely check the existing release: HTTP ' + str(error.code)) from None
notes = root / 'desktop-draft-notes.md'
notes.write_text(f'''OpenCalendar {version} — test downloads

Native desktop packages built from `{commit}`. SHA-256 checksums and native package verification reports are attached.

- **macOS 12+**: universal Intel/Apple silicon DMG or app ZIP. Ad-hoc signed; not notarized. Monterey runtime testing is still pending.
- **Windows 10/11 x64**: unsigned setup EXE (recommended) or portable ZIP. Uses Microsoft Edge WebView2. The installer registers browser sign-in callbacks.
- **Linux x64**: Debian package or AppImage, built on Ubuntu 22.04 with WebKitGTK 4.1. Other distributions have not been runtime-tested.

These are test builds, not App Store, Google Play, or Microsoft Store publications.

Android APK will be attached separately after its existing update-signing key is verified. No physical-iPhone IPA is included: that requires Apple Developer signing. An iOS simulator build, if added, must be labelled as simulator-only.
''', encoding='utf-8')
subprocess.run(['gh', 'release', 'create', tag, '--repo', repo, '--target', commit,
                '--draft', '--prerelease', '--title', f'OpenCalendar {version} — test builds',
                '--notes-file', str(notes), *[str(directory / name) for name in sorted(verified)], str(checksums)], check=True)
print('Created a draft prerelease with verified desktop downloads. It has not been published.')
