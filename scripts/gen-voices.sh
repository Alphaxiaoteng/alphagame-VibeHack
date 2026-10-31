#!/usr/bin/env bash
# 离线生成语音，不播放声音、不读取 API Key。现有文件默认保留；--force 可重新生成。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/assets/audio/voices"
FFMPEG="${FFMPEG:-$(command -v ffmpeg || true)}"
FFPROBE="${FFPROBE:-$(command -v ffprobe || true)}"
FEMALE='Flo (中文（中国大陆）)'
MALE='Eddy (中文（中国大陆）)'
FORCE="${1:-}"

if [[ ! -x /usr/bin/say || ! -x "$FFMPEG" || ! -x "$FFPROBE" ]]; then
  echo '需要 macOS /usr/bin/say、ffmpeg 与 ffprobe；已生成的 MP3 无需这些工具即可游玩。' >&2
  exit 1
fi
if [[ -n "$FORCE" && "$FORCE" != '--force' ]]; then
  echo '用法：bash scripts/gen-voices.sh [--force]' >&2
  exit 1
fi
VOICES="$(/usr/bin/say -v '?')"
for voice in "$FEMALE" "$MALE"; do
  if ! grep -Fq "$voice" <<< "$VOICES"; then
    echo "缺少中文音色：$voice；请在 macOS 辅助功能的朗读语音中安装。" >&2
    exit 1
  fi
done
mkdir -p "$OUT"
TEMP_BASE="${TMPDIR:-/private/var/folders/g4/f2zymj_n43g4848ccjbv4ggw0000gn/T/opencode}"
TEMP="$(mktemp -d "${TEMP_BASE%/}/rounds-voices.XXXXXX")"
cleanup() {
  rm -f "$TEMP"/*.aiff "$TEMP"/*.mp3
  rmdir "$TEMP"
}
trap cleanup EXIT

clip() {
  local name="$1" voice="$2" text="$3"
  if [[ -s "$OUT/$name.mp3" && "$FORCE" != '--force' ]]; then
    echo "保留：$name.mp3"
    return
  fi
  /usr/bin/say -v "$voice" -r 175 -o "$TEMP/$name.aiff" "$text"
  "$FFMPEG" -hide_banner -loglevel error -y -i "$TEMP/$name.aiff" \
    -af 'highpass=f=300,lowpass=f=3200,acompressor=threshold=0.125:ratio=2:attack=5:release=80,alimiter=limit=0.85' \
    -ar 44100 -ac 1 -c:a libmp3lame -b:a 128k "$TEMP/$name.mp3"
  local duration
  duration="$("$FFPROBE" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TEMP/$name.mp3")"
  if ! awk -v value="$duration" 'BEGIN { exit !(value > 0.5) }'; then
    echo "生成失败（音频过短）：$name" >&2
    exit 1
  fi
  mv "$TEMP/$name.mp3" "$OUT/$name.mp3"
  printf '生成：%-24s %s 秒\n' "$name.mp3" "$duration"
}

clip pa_shift_start "$FEMALE" '主电源中断，备用照明已启动。请值班人员按路线巡查。'
clip pa_door_closing "$FEMALE" '注意，走廊防火门正在落下，请绕行其他通道。'
clip pa_30s_left "$FEMALE" '备用电源充能中，距离安全门解锁还有三十秒。'
clip pa_10s_left "$FEMALE" '安全门即将通电，请做好撤离准备。'
clip pa_exit_unlocked "$FEMALE" '东侧安全门已解锁，请立即沿绿灯撤离。'
clip pa_ward_call "$FEMALE" '呼叫值班员，请前往病房核查呼叫信号。'
clip pa_lights_on "$FEMALE" '全院备用照明已开启，强光透视已接通。'
clip pa_lockdown "$FEMALE" '紧急通报，防火卷帘门已强制降下，通道封锁。'
clip warden_patrol_01 "$MALE" '走廊还没查完，谁在那边？'
clip warden_chase "$MALE" '站住！夜间巡查，不许跑！'
clip warden_catch "$MALE" '抓到你了，今晚谁也别想擅自离岗。'
