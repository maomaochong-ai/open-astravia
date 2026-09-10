#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef Arch
  #error Arch is required
#endif

[Setup]
AppId={{A2B92798-AB76-4F6B-A9B9-C252DBCB617C}
AppName=ASTRAVIA
AppVerName=ASTRAVIA {#AppVersion}
AppVersion={#AppVersion}
AppPublisher=ASTRAVIA
DefaultDirName={localappdata}\Programs\ASTRAVIA
DefaultGroupName=ASTRAVIA
OutputDir={#OutputDir}
OutputBaseFilename=Astravia-{#AppVersion}-win-{#Arch}
SetupIconFile={#SourceDir}\versions\{#AppVersion}\resources\build\icon.ico
UninstallDisplayIcon={app}\ASTRAVIA.exe
Compression=lzma2/max
SolidCompression=no
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
AllowNoIcons=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no
MinVersion=10.0
VersionInfoVersion={#AppVersion}
Uninstallable=not IsBackgroundUpdate
CreateUninstallRegKey=not IsBackgroundUpdate

#if Arch == "x64"
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#else
  #error Unsupported architecture
#endif

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl,{#SourcePath}\installer.zh-cn.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Dirs]
Name: "{app}\versions"; Check: IsNotBackgroundUpdate

[Files]
Source: "{#SourceDir}\ASTRAVIA.exe"; DestDir: "{app}"; Flags: ignoreversion; Check: IsNotBackgroundUpdate
Source: "{#SourceDir}\current.json"; DestDir: "{app}"; Flags: ignoreversion; Check: IsNotBackgroundUpdate
; app.asar 在压缩段结束后由 nocompression 单独拷贝时，ISCC 实测报
; “The system cannot find the path specified.”（无行号、复现稳定、与源路径
; junction/真实路径无关）。改用默认压缩纳入递归 glob，全量更新不受影响
; （blockmap 仍对整个安装包计算）。
Source: "{#SourceDir}\versions\{#AppVersion}\*"; DestDir: "{app}\versions\{#AppVersion}"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: IsNotBackgroundUpdate
Source: "{#SourceDir}\versions\{#AppVersion}\*"; DestDir: "{code:GetUpdateVersionDirectory}"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: IsBackgroundUpdate

[Icons]
Name: "{group}\ASTRAVIA"; Filename: "{app}\ASTRAVIA.exe"; Check: IsNotBackgroundUpdate
Name: "{autodesktop}\ASTRAVIA"; Filename: "{app}\ASTRAVIA.exe"; Tasks: desktopicon; Check: IsNotBackgroundUpdate

[Registry]
Root: HKCU; Subkey: "Software\Classes\ASTRAVIA"; ValueType: string; ValueName: ""; ValueData: "URL:ASTRAVIA Protocol"; Flags: uninsdeletekey; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\ASTRAVIA"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\ASTRAVIA\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\ASTRAVIA.exe,0"; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\ASTRAVIA\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\ASTRAVIA.exe"" ""%1"""; Check: IsNotBackgroundUpdate

[Run]
Filename: "{app}\ASTRAVIA.exe"; Description: "{cm:LaunchProgram,ASTRAVIA}"; Flags: nowait postinstall skipifsilent; Check: IsNotBackgroundUpdate

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\ASTRAVIA\versions"
Type: filesandordirs; Name: "{localappdata}\ASTRAVIA\installer"
Type: filesandordirs; Name: "{localappdata}\ASTRAVIA\staging"
Type: files; Name: "{localappdata}\ASTRAVIA\current.json"

[Code]
function CreateHardLinkW(
  NewFileName: String;
  ExistingFileName: String;
  SecurityAttributes: LongWord
): Boolean;
  external 'CreateHardLinkW@kernel32.dll stdcall';

function IsBackgroundUpdate(): Boolean;
begin
  Result := CompareText(ExpandConstant('{param:ASTRAVIAUPDATE|false}'), 'true') = 0;
end;

function IsNotBackgroundUpdate(): Boolean;
begin
  Result := not IsBackgroundUpdate();
end;

function GetUpdateVersionDirectory(Value: String): String;
begin
  Result := AddBackslash(ExpandConstant('{param:ASTRAVIASTOREROOT}')) + 'versions\{#AppVersion}';
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if IsBackgroundUpdate() and (Trim(ExpandConstant('{param:ASTRAVIASTOREROOT}')) = '') then
  begin
    Log('ASTRAVIASTOREROOT is required for a background update.');
    Result := False;
  end;
end;

procedure SeedUpdaterDifferentialCache();
var
  CacheDirectory: String;
  CachedBlockmapPath: String;
  CachedInstallerPath: String;
  SourceInstallerPath: String;
  TemporaryInstallerPath: String;
begin
  CacheDirectory := ExpandConstant('{localappdata}\ASTRAVIA-updater');
  CachedBlockmapPath := AddBackslash(CacheDirectory) + 'current.blockmap';
  CachedInstallerPath := AddBackslash(CacheDirectory) + 'installer.exe';
  SourceInstallerPath := ExpandConstant('{srcexe}');
  TemporaryInstallerPath := AddBackslash(CacheDirectory) + 'installer.exe.installing';

  if not ForceDirectories(CacheDirectory) then
  begin
    Log('Unable to create updater cache directory: ' + CacheDirectory);
    exit;
  end;

  DeleteFile(TemporaryInstallerPath);
  if not CreateHardLinkW(TemporaryInstallerPath, SourceInstallerPath, 0) then
  begin
    if not FileCopy(SourceInstallerPath, TemporaryInstallerPath, False) then
    begin
      Log('Unable to stage updater installer cache: ' + SourceInstallerPath);
      exit;
    end;
  end;

  if FileExists(CachedInstallerPath) and not DeleteFile(CachedInstallerPath) then
  begin
    DeleteFile(TemporaryInstallerPath);
    Log('Unable to replace updater installer cache: ' + CachedInstallerPath);
    exit;
  end;

  if not RenameFile(TemporaryInstallerPath, CachedInstallerPath) then
  begin
    DeleteFile(TemporaryInstallerPath);
    Log('Unable to commit updater installer cache: ' + CachedInstallerPath);
    exit;
  end;

  { A manually installed version may replace an older cached installer. Remove
    the old blockmap so electron-updater fetches the matching versioned one. }
  DeleteFile(CachedBlockmapPath);
  Log('Updater differential cache seeded: ' + CachedInstallerPath);
end;

var
  LastReportedProgress: Integer;

procedure CurInstallProgressChanged(CurProgress, MaxProgress: Integer);
var
  CurrentProgress: Integer;
  ProgressFilePath: String;
begin
  if not IsBackgroundUpdate() then
    exit;

  ProgressFilePath := ExpandConstant('{param:ASTRAVIAPROGRESS}');
  if (ProgressFilePath = '') or (MaxProgress <= 0) then
    exit;

  CurrentProgress := (CurProgress * 100) div MaxProgress;
  if CurrentProgress <> LastReportedProgress then
  begin
    LastReportedProgress := CurrentProgress;
    SaveStringToFile(
      ProgressFilePath,
      IntToStr(CurProgress) + ',' + IntToStr(MaxProgress),
      False
    );
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if IsBackgroundUpdate() then
    begin
      if not SaveStringToFile(
        AddBackslash(GetUpdateVersionDirectory('')) + '.install-complete',
        '{#AppVersion}',
        False
      ) then
        RaiseException('Failed to write update completion marker.');
    end
    else
    begin
      SeedUpdaterDifferentialCache();
      DeleteFile(ExpandConstant('{localappdata}\ASTRAVIA\current.json'));
    end;
  end;
end;
