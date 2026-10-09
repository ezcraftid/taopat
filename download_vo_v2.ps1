# Jalankan dari root repo taotap-game, SETELAH membuat urls.txt dari browser:
#   powershell -ExecutionPolicy Bypass -File .\download_vo_v2.ps1
# Butuh: ffmpeg di PATH (cek: ffmpeg -version).
# urls.txt berisi baris "NamaFile.ogg|https://static.wikia.nocookie.net/..." (dibuat oleh snippet di console browser).

$ProgressPreference = "SilentlyContinue"

$out     = "public\assets\audio"
$raw     = "vo_raw"
$urlFile = "urls.txt"
$ua      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

if (-not (Test-Path $urlFile)) {
    Write-Host "urls.txt tidak ditemukan di folder ini. Buat dulu dari browser (lihat langkah 1-3)."
    exit 1
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "ffmpeg tidak ditemukan di PATH. Install dulu, mis: winget install Gyan.FFmpeg (lalu buka terminal baru)."
    exit 1
}

New-Item -ItemType Directory -Force -Path $out, $raw | Out-Null

# Baca urls.txt -> tabel nama file -> URL
$urls = @{}
Get-Content $urlFile | ForEach-Object {
    $p = $_ -split '\|', 2
    if ($p.Count -eq 2 -and $p[0].Trim() -ne "") {
        $urls[$p[0].Trim()] = $p[1].Trim()
    }
}
Write-Host ("urls.txt berisi {0} file." -f $urls.Count)

# slot -> nama file di wiki
$fixed = [ordered]@{
    "tap-01"   = "VO_JA_Hu_Tao_Mid_Attack_01.ogg"
    "tap-02"   = "VO_JA_Hu_Tao_Mid_Attack_02.ogg"
    "tap-03"   = "VO_JA_Hu_Tao_Mid_Attack_03.ogg"
    "tap-04"   = "VO_JA_Hu_Tao_Jumping_01.ogg"
    "tap-05"   = "VO_JA_Hu_Tao_Jumping_02.ogg"
    "tap-06"   = "VO_JA_Hu_Tao_Jumping_03.ogg"
    "hello-01" = "VO_JA_Hu_Tao_Hello.ogg"
    "idle-01"  = "VO_JA_Hu_Tao_Standby_01.ogg"
    "idle-02"  = "VO_JA_Hu_Tao_Standby_02.ogg"
    "lowhp-01" = "VO_JA_Hu_Tao_Fallen_03.ogg"
}

$jobs = @()
foreach ($slot in $fixed.Keys) {
    $jobs += ,@($slot, $fixed[$slot])
}

# Milestone: ambil 3 file Elemental Burst pertama yang BENAR-BENAR ada di urls.txt
$bursts = @($urls.Keys | Where-Object { $_ -like "VO_JA_Hu_Tao_Elemental_Burst*" } | Sort-Object | Select-Object -First 3)
for ($i = 0; $i -lt $bursts.Count; $i++) {
    $jobs += ,@(("milestone-{0:D2}" -f ($i + 1)), $bursts[$i])
}
if ($bursts.Count -eq 0) {
    Write-Host "Peringatan: tidak ada file Elemental Burst di urls.txt, slot milestone dilewati."
}

foreach ($job in $jobs) {
    $slot = $job[0]
    $file = $job[1]

    if (-not $urls.ContainsKey($file)) {
        Write-Host "TIDAK ADA di urls.txt  $slot ($file)"
        continue
    }

    $dest = Join-Path $raw $file
    try {
        Invoke-WebRequest -Uri $urls[$file] -OutFile $dest -UserAgent $ua -ErrorAction Stop
    }
    catch {
        Write-Host "FAIL unduh  $slot ($file): $($_.Exception.Message)"
        continue
    }

    ffmpeg -nostdin -y -loglevel error -i $dest -ac 1 -ar 44100 -b:a 64k `
        -af "silenceremove=start_periods=1:start_threshold=-50dB,loudnorm=I=-18:TP=-1.5" `
        (Join-Path $out "$slot.mp3")

    if ($LASTEXITCODE -eq 0) {
        Write-Host "OK    $slot"
    } else {
        Write-Host "FFMPEG GAGAL  $slot ($file)"
    }
}

Write-Host ""
Write-Host "Selesai. File mentah ada di $raw\ (boleh dihapus). Hasil MP3 ada di $out\"
