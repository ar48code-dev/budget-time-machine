import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";

const outputDir = "deliverables";
const rawVideo = `${outputDir}/the-line-hackathon-demo-raw.mp4`;
const finalVideo = `${outputDir}/the-line-hackathon-demo.mp4`;
const srtPath = `${outputDir}/the-line-hackathon-demo.srt`;
const devUrl = `https://${process.env.REPLIT_DEV_DOMAIN}/`;
const fps = 12;
const durationSeconds = 180;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:9222${path}`, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve(JSON.parse(body)));
      })
      .on("error", reject);
  });
}

async function connectDebugger() {
  const tabs = await getJson("/json");
  const tab = tabs.find(
    (item) => item.type === "page" && item.url.includes("replit.dev"),
  ) ?? tabs.find((item) => item.type === "page");
  if (!tab) throw new Error("No Chromium page is available for recording.");

  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolver = pending.get(message.id);
    if (!resolver) return;
    pending.delete(message.id);
    if (message.error) resolver.reject(new Error(message.error.message));
    else resolver.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1920,
    screenHeight: 1080,
  });
  return { socket, command };
}

async function evaluate(command, expression, awaitPromise = false) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed.");
  }
  return result.result?.value;
}

async function waitForText(command, text, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const present = await evaluate(
      command,
      `document.body.innerText.includes(${JSON.stringify(text)})`,
    );
    if (present) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for visible text: ${text}`);
}

async function waitForSelector(command, selector, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const present = await evaluate(
      command,
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    );
    if (present) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for selector: ${selector}`);
}

async function elementRect(command, selector) {
  return evaluate(
    command,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`,
  );
}

async function moveCursor(command, selector) {
  await evaluate(
    command,
    `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center", inline: "center" })`,
  );
  await sleep(180);
  const rect = await elementRect(command, selector);
  if (!rect) throw new Error(`Could not find cursor target: ${selector}`);
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height / 2);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await evaluate(
    command,
    `window.__lineRecordingCursor?.(${x}, ${y})`,
  );
  return { x, y };
}

async function click(command, selector) {
  const { x, y } = await moveCursor(command, selector);
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await sleep(350);
}

async function selectValue(command, selector, value) {
  const { x, y } = await moveCursor(command, selector);
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await evaluate(
    command,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Missing select");
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
  );
  await sleep(400);
}

async function writeText(command, text) {
  for (const character of text) {
    await command("Input.dispatchKeyEvent", {
      type: "char",
      text: character,
    });
  }
}

async function addRecordingCursor(command) {
  await evaluate(
    command,
    `(() => {
      const cursor = document.createElement("div");
      cursor.id = "line-recording-cursor";
      cursor.style.cssText = [
        "position:fixed",
        "z-index:2147483647",
        "width:18px",
        "height:24px",
        "pointer-events:none",
        "transform:translate(-2px,-2px) rotate(-18deg)",
        "filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))",
        "clip-path:polygon(0 0, 0 100%, 28% 72%, 47% 100%, 60% 92%, 43% 65%, 100% 65%)",
        "background:#ffffff",
        "border:2px solid #243047",
      ].join(";");
      document.body.appendChild(cursor);
      window.__lineRecordingCursor = (x, y) => {
        cursor.style.left = x + "px";
        cursor.style.top = y + "px";
      };
    })()`,
  );
}

async function recordFrames(command) {
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-framerate",
      String(fps),
      "-i",
      "-",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      "-movflags",
      "+faststart",
      rawVideo,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let ffmpegError = "";
  ffmpeg.stderr.on("data", (chunk) => (ffmpegError += chunk.toString()));
  ffmpeg.stdin.on("error", (error) => {
    if (error.code !== "EPIPE") throw error;
  });

  const started = Date.now();
  let frames = 0;
  while (Date.now() - started < durationSeconds * 1000) {
    const shot = await command("Page.captureScreenshot", {
      format: "jpeg",
      quality: 92,
      captureBeyondViewport: false,
    });
    if (!ffmpeg.stdin.destroyed) {
      ffmpeg.stdin.write(Buffer.from(shot.data, "base64"));
    } else {
      throw new Error(`ffmpeg stopped while recording: ${ffmpegError}`);
    }
    frames += 1;
    const nextFrameAt = started + (frames * 1000) / fps;
    const wait = nextFrameAt - Date.now();
    if (wait > 0) await sleep(wait);
  }
  ffmpeg.stdin.end();
  await new Promise((resolve, reject) => {
    ffmpeg.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg capture failed (${code}): ${ffmpegError}`));
    });
  });
}

const captions = `1
00:00:00,000 --> 00:00:12,000
Move the line.
See the consequences before the call sheet changes.

2
00:00:12,000 --> 00:00:25,000
Deterministic demo seed: Coldwater Creek

3
00:00:25,000 --> 00:00:35,000
Schedule graph + budget position

4
00:00:35,000 --> 00:00:50,000
What-if / no changes applied

5
00:00:50,000 --> 00:01:15,000
Cascade effects + deterministic financial impact

6
00:01:15,000 --> 00:01:35,000
Agent reasoning is visible.
Financial deltas stay deterministic.

7
00:01:35,000 --> 00:01:48,000
Explicit confirmation required

8
00:01:48,000 --> 00:02:05,000
Confirmed and logged
Producer handoff artifacts

9
00:02:05,000 --> 00:02:06,000
Decision log + export pack
`;

async function finishVideo() {
  await writeFile(srtPath, captions);
  const filter = `subtitles=${srtPath}:force_style='FontName=DejaVu Sans,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&HCC243047,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=28'`;
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-i",
        rawVideo,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=196:sample_rate=48000:duration=166",
        "-filter_complex",
        `[0:v]${filter}[v];[1:a]volume=0.025,afade=t=in:st=0:d=3,afade=t=out:st=158:d=8[a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        "-movflags",
        "+faststart",
        finalVideo,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    ffmpeg.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    ffmpeg.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg finalization failed (${code}): ${stderr}`));
    });
  });
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const { socket, command } = await connectDebugger();
  await command("Network.clearBrowserCookies");
  await evaluate(
    command,
    "localStorage.clear(); sessionStorage.clear();",
  );
  await command("Page.navigate", { url: devUrl });
  await sleep(2500);
  await waitForText(command, "Load sample production", 30000);
  if (await evaluate(command, 'Boolean(document.querySelector(\'button[aria-label="Close banner"]\'))')) {
    await click(command, 'button[aria-label="Close banner"]');
  }
  await addRecordingCursor(command);

  const interaction = (async () => {
    await sleep(9500);
    await click(command, '[data-testid="button-load-sample"]');
    await waitForText(command, "Coldwater Creek", 30000);
    await sleep(14000);

    await click(command, '[data-testid="button-simulate"]');
    await waitForText(command, "Simulation desk", 20000);
    await sleep(3000);

    await selectValue(command, '[data-testid="select-simulation-day"]', "day_13");
    await selectValue(
      command,
      '[data-testid="select-simulation-change"]',
      "convert_to_day_for_night",
    );
    await click(command, '[data-testid="button-run-simulation"]');
    await waitForText(command, "Review before commit", 90000);
    await sleep(12000);
    await click(command, '[data-testid="button-confirm-apply"]');
    await waitForText(command, "Applied plan", 90000);
    await sleep(10000);

    await click(command, '[data-testid="nav-decision-log"]');
    await waitForText(command, "Decision log", 20000);
    await sleep(8000);
    await click(command, '[data-testid="button-close-overlay"]');
    await sleep(1000);
    await click(command, '[data-testid="nav-export-pack"]');
    await waitForText(command, "Export production pack", 20000);
    await sleep(8000);
    await click(command, '[data-testid="button-download-export"]');
  })();

  await Promise.all([recordFrames(command), interaction]);
  socket.close();
  await finishVideo();
  console.log(finalVideo);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});