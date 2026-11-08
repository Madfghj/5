"""Inspect native packages without launching their graphical user interfaces."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
OUTPUT = Path(os.environ['RUNNER_TEMP']) / 'OpenCalendar-desktop-artifacts'
OUTPUT.mkdir(parents=True, exist_ok=True)


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def exactly_one(paths, description):
    paths = list(paths)
    if len(paths) != 1:
        raise SystemExit(f'Expected exactly one {description}; found {len(paths)}')
    return paths[0]


def pe_machine(path):
    with path.open('rb') as stream:
        header = stream.read(64)
        if len(header) != 64 or header[:2] != b'MZ':
            raise SystemExit(f'Invalid Windows executable: {path.name}')
        stream.seek(struct.unpack_from('<I', header, 60)[0])
        header = stream.read(6)
        if len(header) != 6 or header[:4] != b'PE\0\0':
            raise SystemExit(f'Missing PE header: {path.name}')
        return struct.unpack_from('<H', header, 4)[0]


def elf_machine(path):
    with path.open('rb') as stream:
        header = stream.read(20)
    if len(header) < 20 or header[:6] != b'\x7fELF\x02\x01':
        raise SystemExit(f'Expected a 64-bit little-endian Linux executable: {path.name}')
    return struct.unpack_from('<H', header, 18)[0]


platform = sys.argv[1]
files = []
report = {
    'schemaVersion': 1,
    'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'version': VERSION,
    'bundleId': 'space.opencalendar.app',
    'platform': platform,
    'architectures': ['x86_64'],
    'storePublished': False,
    'runtimeTested': False,
    'sourceCommit': os.environ.get('GITHUB_SHA'),
}

if platform == 'windows':
    release = ROOT / 'src-tauri/target/x86_64-pc-windows-msvc/release'
    binary = release / 'opencalendar-desktop.exe'
    if pe_machine(binary) != 0x8664:
        raise SystemExit('The Windows application binary must be x86_64')
    installer = exactly_one((release / 'bundle/nsis').glob('*.exe'), 'NSIS installer')
    # NSIS uses a 32-bit bootstrap executable even when its payload is x64.
    if pe_machine(installer) not in (0x14C, 0x8664):
        raise SystemExit('The Windows installer has an unexpected executable architecture')
    # Only a path, never a signing secret, is transferred into PowerShell's environment.
    verification_env = {**os.environ, 'OPEN_CALENDAR_VERIFY_EXE': str(binary)}
    metadata = json.loads(subprocess.check_output([
        'pwsh', '-NoProfile', '-NonInteractive', '-Command',
        "$item = Get-Item -LiteralPath $env:OPEN_CALENDAR_VERIFY_EXE; "
        "$signature = Get-AuthenticodeSignature -LiteralPath $item.FullName; "
        "@{ productVersion = $item.VersionInfo.ProductVersion; "
        "signatureStatus = [string]$signature.Status } | ConvertTo-Json -Compress"
    ], text=True, env=verification_env))
    actual = metadata['productVersion'].split('+')[0]
    if actual not in (VERSION, VERSION + '.0'):
        raise SystemExit(f'Windows executable version differs: {actual}')
    setup = OUTPUT / f'OpenCalendar-{VERSION}-Windows-x64-setup-test.exe'
    shutil.copyfile(installer, setup)
    portable = OUTPUT / f'OpenCalendar-{VERSION}-Windows-x64-portable-test.zip'
    with zipfile.ZipFile(portable, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.write(binary, 'OpenCalendar.exe')
        archive.writestr('README.txt', 'OpenCalendar test build for Windows 10/11 x64.\n'
            'Microsoft Edge WebView2 Runtime must be installed.\n'
            'This ZIP contains an unsigned executable. The setup EXE can install the runtime.\n'
            'The installer is recommended for browser sign-in callback registration.\n')
    files = [setup, portable]
    report.update({'signature': metadata['signatureStatus'], 'developerIdentityVerified': False,
                   'minimumSystem': 'Windows 10 x64', 'webview': 'Microsoft Edge WebView2'})
elif platform == 'linux':
    release = ROOT / 'src-tauri/target/x86_64-unknown-linux-gnu/release'
    binary = release / 'opencalendar-desktop'
    if elf_machine(binary) != 62:
        raise SystemExit('The Linux application must be x86_64')
    linked = command('ldd', str(binary))
    if 'not found' in linked:
        raise SystemExit('A Linux shared library is missing:\n' + linked)
    deb = exactly_one((release / 'bundle/deb').glob('*.deb'), 'Debian package')
    deb_version = command('dpkg-deb', '--field', str(deb), 'Version')
    architecture = command('dpkg-deb', '--field', str(deb), 'Architecture')
    if deb_version != VERSION or architecture != 'amd64':
        raise SystemExit('The Debian package version or architecture differs')
    dependencies = command('dpkg-deb', '--field', str(deb), 'Depends')
    if 'libwebkit2gtk-4.1' not in dependencies:
        raise SystemExit('The Debian package must declare its WebKitGTK 4.1 dependency')
    with tempfile.TemporaryDirectory(prefix='opencalendar-deb-') as temporary:
        extraction = Path(temporary)
        subprocess.run(['dpkg-deb', '--extract', str(deb), str(extraction)], check=True)
        packaged = extraction / 'usr/bin/opencalendar-desktop'
        if packaged.read_bytes() != binary.read_bytes():
            raise SystemExit('The Debian package binary differs from the compiled binary')
        entry = exactly_one((extraction / 'usr/share/applications').glob('*.desktop'), 'desktop entry')
        if 'x-scheme-handler/space.opencalendar.app' not in entry.read_text():
            raise SystemExit('The Debian package lacks the browser sign-in return scheme')
    appimage = exactly_one((release / 'bundle/appimage').glob('*.AppImage'), 'AppImage')
    with appimage.open('rb') as stream:
        header = stream.read(12)
    if header[:4] != b'\x7fELF' or header[8:11] != b'AI\x02':
        raise SystemExit('The AppImage does not have a type-2 AppImage header')
    package = OUTPUT / f'OpenCalendar-{VERSION}-Linux-x64-test.deb'
    image = OUTPUT / f'OpenCalendar-{VERSION}-Linux-x64-test.AppImage'
    shutil.copyfile(deb, package)
    shutil.copyfile(appimage, image)
    image.chmod(0o755)
    files = [package, image]
    report.update({'signature': 'unsigned', 'builtOn': 'Ubuntu 22.04',
                   'runtimeTestedOnOtherDistributions': False, 'debianDependencies': dependencies,
                   'webview': 'WebKitGTK 4.1', 'sharedLibrariesResolvedOnBuildRunner': True})
else:
    raise SystemExit('Expected windows or linux')

report['files'] = [{'name': path.name, 'bytes': path.stat().st_size,
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in files]
(OUTPUT / f'{platform}-native-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
