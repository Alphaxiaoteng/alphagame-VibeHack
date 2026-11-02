#!/usr/bin/env python3
"""
生成工业级御用音频资源：
1. 微软顶级神经 TTS 语音 (Edge-TTS) + 医院广播 PA 频段与夜班值班员威慑音效
2. 纯正心理微恐背景音乐 (低频次声双耳节拍、荒废医院工频电流声、不协和三度音群、回环无缝衔接)
3. 真实硬质地砖脚步声 (脚跟冲击、鞋底贴地、硬地回响) 与全量高质感医院音效 (开锁、断路器、卷帘门等)
"""

import os
import subprocess
import tempfile
import numpy as np
import scipy.io.wavfile as wav
from scipy.signal import butter, lfilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICES_DIR = os.path.join(ROOT, 'assets', 'audio', 'voices')
SFX_DIR = os.path.join(ROOT, 'assets', 'audio', 'sfx')
BGM_DIR = os.path.join(ROOT, 'assets', 'audio', 'bgm')

os.makedirs(VOICES_DIR, exist_ok=True)
os.makedirs(SFX_DIR, exist_ok=True)
os.makedirs(BGM_DIR, exist_ok=True)

SR = 44100

def run(cmd):
    res = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Command failed ({res.returncode}): {cmd}\n{res.stderr}")
    return res.stdout

def write_wav_and_encode(path_mp3, audio_data, sample_rate=SR, bitrate='192k', volume_peak=0.92):
    audio_data = np.asarray(audio_data, dtype=np.float32)
    peak = np.max(np.abs(audio_data))
    if peak > 1e-6:
        audio_data = audio_data / peak * volume_peak
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
        wav_path = tf.name
    try:
        wav.write(wav_path, sample_rate, (audio_data * 32767).astype(np.int16))
        run(f"ffmpeg -hide_banner -loglevel error -y -i '{wav_path}' -ar {sample_rate} -c:a libmp3lame -b:a {bitrate} '{path_mp3}'")
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

def butter_bandpass(lowcut, highcut, fs, order=3):
    nyq = 0.5 * fs
    low = max(0.001, lowcut / nyq)
    high = min(0.999, highcut / nyq)
    return butter(order, [low, high], btype='band')

def butter_lowpass(cutoff, fs, order=4):
    nyq = 0.5 * fs
    cut = min(0.999, cutoff / nyq)
    return butter(order, cut, btype='low')

def butter_highpass(cutoff, fs, order=3):
    nyq = 0.5 * fs
    cut = min(0.999, cutoff / nyq)
    return butter(order, cut, btype='high')

# ==========================================
# 1. 神经 TTS 语音生成 (Edge-TTS)
# ==========================================
VOICE_SPECS = [
    # 医院内线广播 (晓晓 - 官方冷静微恐播音腔)
    ('pa_shift_start', 'zh-CN-XiaoxiaoNeural', '主电源中断，备用照明已启动。请值班人员按路线巡查。', 'pa'),
    ('pa_door_closing', 'zh-CN-XiaoxiaoNeural', '注意，走廊防火门正在落下，请绕行其他通道。', 'pa'),
    ('pa_30s_left', 'zh-CN-XiaoxiaoNeural', '备用电源充能中，距离安全门解锁还有三十秒。', 'pa'),
    ('pa_10s_left', 'zh-CN-XiaoxiaoNeural', '安全门即将通电，请做好撤离准备。', 'pa'),
    ('pa_exit_unlocked', 'zh-CN-XiaoxiaoNeural', '东侧安全门已解锁，门已打开，请立即沿绿灯撤离！', 'pa'),
    ('pa_ward_call', 'zh-CN-XiaoxiaoNeural', '呼叫值班员，请前往三号病房核查呼叫信号。', 'pa'),
    ('pa_lights_on', 'zh-CN-XiaoxiaoNeural', '全院备用照明已开启，强光透视已接通。', 'pa'),
    ('pa_lockdown', 'zh-CN-XiaoxiaoNeural', '紧急通报，防火卷帘门已强制降下，通道封锁！', 'pa'),
    # 夜间巡查值班员 (云健 - 低沉威慑守卫)
    ('warden_patrol_01', 'zh-CN-YunjianNeural', '走廊还没查完……谁在那边？！', 'warden'),
    ('warden_chase', 'zh-CN-YunjianNeural', '站住！夜间巡查，不许跑！！', 'warden'),
    ('warden_catch', 'zh-CN-YunjianNeural', '抓到你了！今晚谁也别想擅自离开病区！', 'warden'),
]

def generate_voices():
    print(">>> 正在生成神经网络 TTS 语音资源 (Edge-TTS)...")
    for name, voice, text, kind in VOICE_SPECS:
        target = os.path.join(VOICES_DIR, f"{name}.mp3")
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tf:
            raw_mp3 = tf.name
        try:
            cmd = f"uvx edge-tts --voice '{voice}' --text '{text}' --write-media '{raw_mp3}'"
            run(cmd)
            # 声学后处理滤镜
            if kind == 'pa':
                # 医院大厅走廊壁挂喇叭声学：带通滤波 260~3800Hz + 金属回廊空间混响 (aecho) + 动态压缩
                filter_chain = (
                    "highpass=f=260,lowpass=f=3800,"
                    "acompressor=threshold=0.1:ratio=3:attack=5:release=80,"
                    "aecho=0.8:0.7:30:0.25,"
                    "loudnorm=I=-16:TP=-1.5:LRA=7"
                )
            else:
                # 值班员威慑人声：近讲效应、深沉压迫感
                filter_chain = (
                    "highpass=f=80,lowpass=f=7500,"
                    "acompressor=threshold=0.15:ratio=2.5:attack=5:release=90,"
                    "aecho=0.7:0.5:20:0.18,"
                    "loudnorm=I=-14:TP=-1.0:LRA=6"
                )
            run(f"ffmpeg -hide_banner -loglevel error -y -i '{raw_mp3}' -af '{filter_chain}' -ar 44100 -ac 1 -c:a libmp3lame -b:a 128k '{target}'")
            print(f"  [OK] 语音已生成: {name}.mp3")
        finally:
            if os.path.exists(raw_mp3):
                os.remove(raw_mp3)

# ==========================================
# 2. 真实硬地砖脚步声与 SFX 生成
# ==========================================
def generate_sfx():
    print(">>> 正在合成高真实度硬质地砖脚步声与微恐 SFX 音效...")
    
    # --- A. 行走脚步声 (Linoleum Hard Tile Walk) ---
    dur_walk = 0.24
    t = np.linspace(0, dur_walk, int(SR * dur_walk), endpoint=False)
    # 脚跟接触瞬间 (70Hz 冲击)
    thud = np.sin(2 * np.pi * 75 * t) * np.exp(-t * 60) * 0.75
    # 鞋掌着地硬胶贴擦 (480Hz + 820Hz)
    slap = (np.sin(2 * np.pi * 480 * t) * 0.4 + np.sin(2 * np.pi * 820 * t) * 0.3) * np.exp(-np.maximum(0, t - 0.012) * 55)
    # 瓷砖摩擦颗粒高频 (3000~6000Hz)
    noise = np.random.normal(0, 1, len(t))
    b_hp, a_hp = butter_highpass(3000, SR)
    click = lfilter(b_hp, a_hp, noise) * (np.exp(-t * 85) + np.exp(-np.maximum(0, t - 0.015) * 80) * 0.5) * 0.4
    walk_sfx = thud + slap + click
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_footstep_walk.mp3'), walk_sfx, volume_peak=0.92)

    # --- B. 冲刺急促脚步声 (Linoleum Sprint) ---
    dur_sprint = 0.20
    t = np.linspace(0, dur_sprint, int(SR * dur_sprint), endpoint=False)
    thud_sp = np.sin(2 * np.pi * 95 * t) * np.exp(-t * 70) * 0.8
    slap_sp = (np.sin(2 * np.pi * 560 * t) * 0.5 + np.sin(2 * np.pi * 980 * t) * 0.35) * np.exp(-np.maximum(0, t - 0.008) * 65)
    click_sp = lfilter(b_hp, a_hp, np.random.normal(0, 1, len(t))) * np.exp(-t * 90) * 0.55
    sprint_sfx = thud_sp + slap_sp + click_sp
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_footstep_sprint.mp3'), sprint_sfx, volume_peak=0.95)

    # --- C. 值班员重靴脚步声 (Heavy Combat Boot Warden Step) ---
    dur_wstep = 0.32
    t = np.linspace(0, dur_wstep, int(SR * dur_wstep), endpoint=False)
    # 深沉厚底硬靴踏地 (48Hz)
    boot_sub = np.sin(2 * np.pi * 48 * t) * np.exp(-t * 35) * 0.95
    boot_mid = (np.sin(2 * np.pi * 220 * t) * 0.4 + np.sin(2 * np.pi * 380 * t) * 0.3) * np.exp(-t * 45)
    boot_crunch = lfilter(b_hp, a_hp, np.random.normal(0, 1, len(t))) * np.exp(-t * 60) * 0.35
    wstep_sfx = boot_sub + boot_mid + boot_crunch
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_warden_step.mp3'), wstep_sfx, volume_peak=0.95)

    # --- D. 值班员钥匙串碰撞声与铜铃 (Warden Key & Bell) ---
    dur_bell = 0.45
    t = np.linspace(0, dur_bell, int(SR * dur_bell), endpoint=False)
    # 悬挂钥匙与铜片清脆震颤 (1850Hz, 3200Hz, 4400Hz)
    bell = (
        np.sin(2 * np.pi * 1850 * t) * np.exp(-t * 18) * 0.45 +
        np.sin(2 * np.pi * 3200 * t) * np.exp(-t * 24) * 0.35 +
        np.sin(2 * np.pi * 4400 * t) * np.exp(-t * 32) * 0.25
    )
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_warden_bell.mp3'), bell, volume_peak=0.88)

    # --- E. 广播前置微恐失谐提示音 (PA Chime: Tritone F#5 to C5) ---
    dur_chime = 0.65
    t1 = np.linspace(0, 0.28, int(SR * 0.28), endpoint=False)
    t2 = np.linspace(0, 0.37, int(SR * 0.37), endpoint=False)
    tone1 = np.sin(2 * np.pi * 739.99 * t1) * np.exp(-t1 * 10) * 0.7  # F#5
    tone2 = np.sin(2 * np.pi * 523.25 * t2) * np.exp(-t2 * 8) * 0.8   # C5 (三全音恶魔音程)
    chime_sfx = np.concatenate([tone1, tone2])
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_pa_chime.mp3'), chime_sfx, volume_peak=0.90)

    # --- F. 防火门猛烈撞击闭锁 (Door Slam) ---
    dur_slam = 0.42
    t = np.linspace(0, dur_slam, int(SR * dur_slam), endpoint=False)
    slam_sub = np.sin(2 * np.pi * 65 * t) * np.exp(-t * 22) * 0.8
    slam_metal = (np.sin(2 * np.pi * 160 * t) * 0.5 + np.sin(2 * np.pi * 340 * t) * 0.3) * np.exp(-t * 28)
    slam_noise = np.random.normal(0, 1, len(t)) * np.exp(-t * 40) * 0.4
    door_slam = slam_sub + slam_metal + slam_noise
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_door_slam.mp3'), door_slam, volume_peak=0.92)

    # --- G. 电磁锁滑轨开启 (Door Open) ---
    dur_open = 0.38
    t = np.linspace(0, dur_open, int(SR * dur_open), endpoint=False)
    click = np.sin(2 * np.pi * 1200 * t) * np.exp(-t * 80) * 0.6
    slide = (np.sin(2 * np.pi * 280 * t) + np.sin(2 * np.pi * 420 * t) * 0.5) * np.exp(-t * 12) * 0.4
    door_open = click + slide
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_door_open.mp3'), door_open, volume_peak=0.88)

    # --- H. 工业卷帘门断电坠落 (Lockdown Slam) ---
    dur_lock = 0.65
    t = np.linspace(0, dur_lock, int(SR * dur_lock), endpoint=False)
    motor = np.sin(2 * np.pi * (180 - 100 * t / dur_lock) * t) * np.exp(-t * 6) * 0.5
    crash = (np.sin(2 * np.pi * 50 * t) * 0.7 + np.sin(2 * np.pi * 120 * t) * 0.5) * np.exp(-np.maximum(0, t - 0.25) * 20)
    lockdown = motor + crash
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_lockdown_slam.mp3'), lockdown, volume_peak=0.92)

    # --- I. 工业继电器开关 (Light Switch) ---
    dur_sw = 0.12
    t = np.linspace(0, dur_sw, int(SR * dur_sw), endpoint=False)
    snap = np.sin(2 * np.pi * 2100 * t) * np.exp(-t * 110) * 0.7 + np.sin(2 * np.pi * 1400 * t) * np.exp(-t * 90) * 0.5
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_light_switch.mp3'), snap, volume_peak=0.88)

    # --- J. 高压电弧与强光骤亮 (Lights Surge) ---
    dur_surge = 0.45
    t = np.linspace(0, dur_surge, int(SR * dur_surge), endpoint=False)
    arc = (np.sin(2 * np.pi * 100 * t) + 0.6 * np.sin(2 * np.pi * 300 * t)) * (0.6 + 0.4 * np.sin(2 * np.pi * 40 * t)) * np.exp(-t * 5)
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_lights_surge.mp3'), arc, volume_peak=0.90)

    # --- K. 惊悚突刺 (Danger Sting) ---
    dur_sting = 0.75
    t = np.linspace(0, dur_sting, int(SR * dur_sting), endpoint=False)
    # 不协和三和弦突刺 (D#4 311Hz, A4 440Hz, E5 659Hz)
    sting = (
        np.sin(2 * np.pi * 311.13 * t) * 0.4 +
        np.sin(2 * np.pi * 440.00 * t) * 0.4 +
        np.sin(2 * np.pi * 659.25 * t) * 0.35
    ) * np.exp(-t * 5.5)
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_danger_sting.mp3'), sting, volume_peak=0.92)

    # --- L. 成功脱险解脱钟鸣 (Escape Win) ---
    dur_win = 1.6
    t = np.linspace(0, dur_win, int(SR * dur_win), endpoint=False)
    # 明亮纯正和谐泛音群 (C大调低音与空灵泛音)
    win = (
        np.sin(2 * np.pi * 130.81 * t) * 0.45 * np.exp(-t * 2.5) +
        np.sin(2 * np.pi * 261.63 * t) * 0.35 * np.exp(-t * 2.8) +
        np.sin(2 * np.pi * 392.00 * t) * 0.25 * np.exp(-t * 3.2) +
        np.sin(2 * np.pi * 523.25 * t) * 0.20 * np.exp(-t * 3.6)
    )
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_escape_win.mp3'), win, volume_peak=0.88)

    # --- M. 体力耗尽急促喘息 (Breath Gasp) ---
    dur_breath = 0.42
    t = np.linspace(0, dur_breath, int(SR * dur_breath), endpoint=False)
    b_noise = np.random.normal(0, 1, len(t))
    b_bp, a_bp = butter_bandpass(400, 1800, SR)
    breath = lfilter(b_bp, a_bp, b_noise) * np.sin(np.pi * t / dur_breath) ** 1.5
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_breath_gasp.mp3'), breath, volume_peak=0.88)

    # --- N. 拒绝蜂鸣 (Buzz Denied) ---
    dur_buzz = 0.18
    t = np.linspace(0, dur_buzz, int(SR * dur_buzz), endpoint=False)
    buzz = (np.sign(np.sin(2 * np.pi * 130 * t)) * 0.5 + np.sign(np.sin(2 * np.pi * 175 * t)) * 0.5) * np.exp(-t * 12)
    write_wav_and_encode(os.path.join(SFX_DIR, 'sfx_buzz_denied.mp3'), buzz, volume_peak=0.88)

# ==========================================
# 3. 心理微恐背景音乐 (Psychological Horror BGM)
# ==========================================
def generate_horror_bgm():
    print(">>> 正在合成心理微恐背景音乐 (低频次声双耳节拍 + 荒废医院工频电流 + 不协和三全音群)...")
    
    # ── 1. 游戏内主氛围 (bgm_hospital_ambience.mp3, 60s 循环) ──
    dur_amb = 60.0
    n = int(SR * dur_amb)
    t = np.linspace(0, dur_amb, n, endpoint=False)

    # 次声生理压迫双耳节拍 (左耳 38Hz，右耳 41.5Hz，形成 3.5Hz 恐惧低频波动)
    sub_l = np.sin(2 * np.pi * 38.0 * t) * 0.45
    sub_r = np.sin(2 * np.pi * 41.5 * t) * 0.45
    lfo_sub = 0.75 + 0.25 * np.sin(2 * np.pi * 0.05 * t)
    sub_l *= lfo_sub
    sub_r *= lfo_sub

    # 医院旧式日光灯管工频微颤电流声 (100Hz + 200Hz + 300Hz 偶次谐波)
    hum = (np.sin(2 * np.pi * 100 * t) * 0.14 +
           np.sin(2 * np.pi * 200 * t) * 0.07 +
           np.sin(2 * np.pi * 300 * t) * 0.035)
    flicker = 0.85 + 0.15 * np.sin(2 * np.pi * 1.7 * t) * np.cos(2 * np.pi * 0.33 * t)
    hum *= flicker

    # 压迫感不协和三全音与小二度低沉音群 (110Hz A2, 155.56Hz Eb3 恶魔音程, 233.08Hz Bb3)
    dark_tones = (
        np.sin(2 * np.pi * 110.0 * t) * 0.24 +
        np.sin(2 * np.pi * 155.56 * t + 0.4) * 0.20 +
        np.sin(2 * np.pi * 233.08 * t + 1.1) * 0.15
    )
    b_lp, a_lp = butter_lowpass(620, SR)
    dark_filtered = lfilter(b_lp, a_lp, dark_tones)

    # 通风管道冷风与回廊背景风噪声
    noise = np.random.normal(0, 1, n)
    b_bp, a_bp = butter_bandpass(140, 750, SR)
    duct = lfilter(b_bp, a_bp, noise) * 0.11
    duct_lfo = 0.65 + 0.35 * np.sin(2 * np.pi * 0.07 * t + 1.8)
    duct *= duct_lfo

    # 偶发性金属水管低吟与远处滴水回响
    metallic = np.zeros(n)
    for strike_t in [4.5, 17.5, 31.0, 46.5]:
        idx = int(strike_t * SR)
        decay_len = int(4.2 * SR)
        if idx + decay_len < n:
            tt = np.linspace(0, 4.2, decay_len, endpoint=False)
            ring = (np.sin(2 * np.pi * 349.23 * tt) * 0.35 +
                    np.sin(2 * np.pi * 493.88 * tt) * 0.25) * np.exp(-tt * 1.1)
            metallic[idx:idx+decay_len] += ring * 0.22

    left = sub_l + hum * 0.5 + dark_filtered * 0.65 + duct * 0.5 + metallic * 0.7
    right = sub_r + hum * 0.5 + dark_filtered * 0.65 + duct * 0.5 + metallic * 0.4

    # 4秒无缝交叉淡化，保证单曲循环播放时 0 卡顿 0 咔哒声
    fade_len = int(4.0 * SR)
    fade_in = np.linspace(0, 1, fade_len)
    fade_out = np.linspace(1, 0, fade_len)
    left[:fade_len] = left[:fade_len] * fade_in + left[-fade_len:] * fade_out
    right[:fade_len] = right[:fade_len] * fade_in + right[-fade_len:] * fade_out
    left[-fade_len:] = left[:fade_len]
    right[-fade_len:] = right[:fade_len]

    stereo_amb = np.vstack([left, right]).T
    write_wav_and_encode(os.path.join(BGM_DIR, 'bgm_hospital_ambience.mp3'), stereo_amb, volume_peak=0.88)
    print("  [OK] 主游戏恐怖氛围 BGM 已生成: bgm_hospital_ambience.mp3")

    # ── 2. 菜单与暂停主题 (bgm_menu_theme.mp3, 45s 循环) ──
    dur_menu = 45.0
    nm = int(SR * dur_menu)
    tm = np.linspace(0, dur_menu, nm, endpoint=False)

    # 极低频虚空脉冲 (44Hz + 47Hz 双耳)
    menu_sub_l = np.sin(2 * np.pi * 44.0 * tm) * 0.42
    menu_sub_r = np.sin(2 * np.pi * 47.2 * tm) * 0.42
    menu_lfo = 0.7 + 0.3 * np.sin(2 * np.pi * 0.06 * tm)
    menu_sub_l *= menu_lfo
    menu_sub_r *= menu_lfo

    # 空灵荒凉小二度低音弦乐垫 (65.4Hz C2, 69.3Hz C#2 极紧密失谐)
    dissonant_pad = (
        np.sin(2 * np.pi * 65.41 * tm) * 0.35 +
        np.sin(2 * np.pi * 69.30 * tm + 0.8) * 0.30 +
        np.sin(2 * np.pi * 130.81 * tm + 1.4) * 0.18
    )
    b_mlp, a_mlp = butter_lowpass(450, SR)
    menu_pad = lfilter(b_mlp, a_mlp, dissonant_pad)

    m_noise = np.random.normal(0, 1, nm)
    b_mbp, a_mbp = butter_bandpass(200, 900, SR)
    wind = lfilter(b_mbp, a_mbp, m_noise) * 0.09 * (0.6 + 0.4 * np.cos(2 * np.pi * 0.08 * tm))

    m_left = menu_sub_l + menu_pad * 0.6 + wind * 0.5
    m_right = menu_sub_r + menu_pad * 0.6 + wind * 0.5

    # 3.5秒交叉淡化
    m_fade = int(3.5 * SR)
    m_fin = np.linspace(0, 1, m_fade)
    m_fout = np.linspace(1, 0, m_fade)
    m_left[:m_fade] = m_left[:m_fade] * m_fin + m_left[-m_fade:] * m_fout
    m_right[:m_fade] = m_right[:m_fade] * m_fin + m_right[-m_fade:] * m_fout
    m_left[-m_fade:] = m_left[:m_fade]
    m_right[-m_fade:] = m_right[:m_fade]

    stereo_menu = np.vstack([m_left, m_right]).T
    write_wav_and_encode(os.path.join(BGM_DIR, 'bgm_menu_theme.mp3'), stereo_menu, volume_peak=0.88)
    print("  [OK] 菜单微恐深邃 BGM 已生成: bgm_menu_theme.mp3")

if __name__ == '__main__':
    generate_voices()
    generate_sfx()
    generate_horror_bgm()
    print(">>> 全量工业级御用音频资源生成完毕！")
