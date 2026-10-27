// CDP 스크린캐스트로 프레임(JPEG)을 받아 타임스탬프대로 이어 붙여 30fps H.264 클립을 만든다.
// Playwright recordVideo(VP8, 낮은 비트율)보다 글자가 선명하다. 모듈 하나 = 클립 하나.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

class Recorder {
  constructor(page, outDir, name, { quality = 90, width = 1920, height = 1080, crf = 17 } = {}) {
    this.page = page;
    this.name = name;
    this.outDir = outDir;
    this.dir = path.join(outDir, `${name}.frames`);
    this.quality = quality;
    this.width = width;
    this.height = height;
    this.crf = crf;
    this.frames = [];
    this.markers = [];
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }

  // 정지 화면에서도 프레임이 오도록 1픽셀짜리 심장박동 요소를 깜빡인다 (20fps 바닥)
  async heartbeat(on) {
    await this.page.evaluate((on) => {
      let d = document.getElementById('__hb');
      if (!on) {
        if (window.__hbTimer) clearInterval(window.__hbTimer);
        if (d) d.remove();
        return;
      }
      if (!d) {
        d = document.createElement('div');
        d.id = '__hb';
        d.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.02;z-index:2147483647;pointer-events:none;';
        document.documentElement.appendChild(d);
      }
      let i = 0;
      window.__hbTimer = setInterval(() => {
        i += 1;
        d.style.backgroundColor = i % 2 ? '#000001' : '#000002';
      }, 50);
    }, on);
  }

  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const idx = this.frames.length;
      const file = path.join(this.dir, `f${String(idx).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      this.frames.push({ file, t: metadata.timestamp });
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await this.heartbeat(true);
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: this.quality, maxWidth: this.width, maxHeight: this.height, everyNthFrame: 1,
    });
    this.startedAt = Date.now() / 1000;
  }

  // 비트 경계 표시(벽시계). stop() 에서 첫 프레임 기준 초로 바꾼다
  mark(label) {
    this.markers.push({ label, wall: Date.now() / 1000 });
  }

  async stop({ tail = 0.1 } = {}) {
    await this.page.waitForTimeout(150);
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    await this.heartbeat(false).catch(() => {});
    await this.cdp.detach().catch(() => {});
    if (this.frames.length < 2) throw new Error(`frames too few: ${this.frames.length}`);
    const t0 = this.frames[0].t;
    const lines = ['ffconcat version 1.0'];
    for (let i = 0; i < this.frames.length; i += 1) {
      const d = i < this.frames.length - 1 ? this.frames[i + 1].t - this.frames[i].t : tail;
      lines.push(`file '${path.basename(this.frames[i].file)}'`);
      lines.push(`duration ${Math.max(0.001, d).toFixed(4)}`);
    }
    lines.push(`file '${path.basename(this.frames[this.frames.length - 1].file)}'`); // concat demuxer 규칙
    const listFile = path.join(this.dir, 'list.txt');
    fs.writeFileSync(listFile, lines.join('\n') + '\n');
    const out = path.join(this.outDir, `${this.name}.mp4`);
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', `scale=${this.width}:${this.height}:flags=lanczos,fps=30,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(this.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
    ], { stdio: 'inherit' });
    const duration = this.frames[this.frames.length - 1].t - t0 + tail;
    const markers = this.markers.map((m) => ({ label: m.label, t: Math.max(0, m.wall - t0) }));
    const meta = { file: out, duration, frames: this.frames.length, markers };
    fs.rmSync(this.dir, { recursive: true, force: true }); // 프레임은 용량이 커서 인코딩 후 지운다
    return meta;
  }
}

module.exports = { Recorder };
