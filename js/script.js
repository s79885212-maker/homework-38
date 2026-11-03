'use strict';

// ============================================================
//  Настройки сцены (доли от высоты экрана)
// ============================================================
const HORIZON = 0.558;  // линия горизонта
const RING = 0.355;     // радиус кольца

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


// ============================================================
//  Шейдеры: небо, звёзды, кольцо и вода с отражением
// ============================================================
const VERTEX_SHADER = `
  attribute vec2 aPos;
  void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  uniform vec2  uRes;      // размер холста в пикселях
  uniform float uTime;
  uniform float uDpr;
  uniform float uHorizon;  // y горизонта (сверху вниз)
  uniform float uRing;     // радиус кольца
  uniform vec4  uCard;     // left, top, right, bottom карты

  // --- Шум ---
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p *= 2.07;
      a *= 0.5;
    }
    return v;
  }

  // --- Небо (p в пикселях, y вниз) ---
  vec3 sky(vec2 p) {
    float H = uRes.y;
    float cx = uRes.x * 0.5;
    float up = clamp((uHorizon - p.y) / uHorizon, 0.0, 1.0); // 0 у горизонта, 1 вверху

    // Градиент
    vec3 col = mix(vec3(0.48, 0.36, 0.64), vec3(0.32, 0.23, 0.53), smoothstep(0.0, 0.4, up));
    col = mix(col, vec3(0.14, 0.11, 0.32), smoothstep(0.4, 1.0, up));

    // Туманность
    vec2 q = p / H;
    float n = fbm(q * 2.5 + vec2(uTime * 0.01, 0.0));
    float n2 = fbm(q * 5.0 - n + vec2(0.0, uTime * 0.008));
    col += vec3(0.28, 0.22, 0.45) * smoothstep(0.45, 0.85, n2) * 0.35 * (0.4 + up);
    col -= vec3(0.06, 0.05, 0.10) * smoothstep(0.5, 0.2, n);

    // Звёзды
    float cell = 7.0 * uDpr;
    vec2 id = floor(p / cell);
    vec2 gv = fract(p / cell) - 0.5;
    float h = hash(id);
    if (h > 0.86) {
      vec2 offs = vec2(hash(id + 7.1), hash(id + 3.7)) - 0.5;
      float d = length((gv - offs * 0.7) * cell);
      float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
      col += vec3(0.95, 0.9, 1.0) * smoothstep(0.9 * uDpr, 0.0, d) * tw * smoothstep(0.05, 0.4, up) * 0.8;
    }

    // Розовое свечение на горизонте за картой
    vec2 g1 = vec2((p.x - cx) / (uRes.x * 0.26), (p.y - uHorizon) / (H * 0.32));
    vec2 g2 = vec2((p.x - cx) / (uRes.x * 0.17), (p.y - uHorizon) / (H * 0.12));
    col += vec3(0.85, 0.45, 0.72) * exp(-dot(g1, g1) * 1.2) * 0.55;
    col += vec3(1.0, 0.75, 0.82) * exp(-dot(g2, g2)) * 0.85;

    // Кольцо: тёмная линия с тонким светлым краем
    float r = length(p - vec2(cx, uHorizon));
    float dr = r - uRing;
    float w = 2.6 * uDpr;
    col = mix(col, vec3(0.22, 0.13, 0.36), smoothstep(w, w * 0.3, abs(dr)) * 0.85);
    col += vec3(0.95, 0.78, 0.98) * smoothstep(1.3 * uDpr, 0.0, abs(dr + w)) * 0.35 * smoothstep(0.0, 0.5, up);
    col += vec3(0.7, 0.4, 0.9) * exp(-abs(dr) / (22.0 * uDpr)) * 0.07;

    return col;
  }

  // --- Высота волн в координатах плоскости воды ---
  float waveHeight(vec2 wp, vec2 center) {
    float t = uTime;
    float rd = length(wp - center);
    float ripple = sin(rd * 16.0 - t * 2.4) * exp(-rd * 0.3);
    float swell = sin(wp.y * 7.0 + wp.x * 0.8 - t * 1.3) * 0.3
                + sin(wp.y * 4.3 - wp.x * 1.3 + t * 0.9) * 0.25;
    float n = fbm3(wp * vec2(0.6, 2.4) + vec2(t * 0.1, -t * 0.15));
    return ripple * 0.8 + swell + (n - 0.5) * 0.9;
  }

  // --- Вода ---
  vec3 water(vec2 p) {
    float H = uRes.y;
    float cx = uRes.x * 0.5;
    float dy = p.y - uHorizon;
    float depth = clamp(dy / (H - uHorizon), 0.0, 1.0); // 0 у горизонта, 1 внизу

    // Перспектива: точка экрана -> точка на плоскости воды
    float z = 1.0 / max(depth, 0.004);
    vec2 wp = vec2((p.x - cx) / H * z * 1.5, z);

    float cardDepth = clamp((uCard.w - uHorizon) / (H - uHorizon), 0.05, 1.0);
    vec2 center = vec2(0.0, 1.0 / cardDepth);

    float h = waveHeight(wp, center);
    float e = 0.02;
    vec2 grad = vec2(
      waveHeight(wp + vec2(e, 0.0), center) - h,
      waveHeight(wp + vec2(0.0, e), center) - h
    ) / e;

    // Сдвиг отражения (у горизонта слабый, ближе к зрителю сильный)
    vec2 offs = grad * (0.2 + 2.2 * depth) * uDpr;
    offs.y *= 2.0;

    // Отражение неба
    // Рябь вытягивает отражение по вертикали
    float my = min(uHorizon - dy * 0.5 + offs.y, uHorizon - 1.0);
    vec2 rp = vec2(p.x + offs.x, max(my, 0.0));
    vec3 refl = sky(rp);

    vec3 col = mix(vec3(0.08, 0.05, 0.18), refl * 0.9, mix(0.85, 0.5, depth));

    // Яркие розовые блики на гребнях волн под картой
    float cx2 = (p.x + offs.x - cx) / (uRes.x * 0.2);
    float spec = smoothstep(0.4, 1.1, grad.y * 0.12 + 0.5) * exp(-cx2 * cx2) * (1.0 - depth * 0.6);
    col += vec3(1.0, 0.72, 0.86) * spec * 0.8;

    // Отражение карты
    float cw = uCard.z - uCard.x;
    float ch = uCard.w - uCard.y;
    vec2 cp = vec2(p.x + offs.x, p.y + offs.y * 0.6);
    float soft = 0.06 * cw;
    float inX = smoothstep(uCard.x, uCard.x + soft, cp.x) * smoothstep(uCard.z, uCard.z - soft, cp.x);
    float ty = (cp.y - uCard.w) / (ch * 0.45);
    float inY = step(0.0, ty) * (1.0 - smoothstep(0.0, 1.0, ty));
    col = mix(col, vec3(0.22, 0.14, 0.5), inX * inY * 0.3);

    // Тёмные линии ряби
    float line = 1.0 - smoothstep(0.0, 0.06, abs(h - 0.15));
    col *= 1.0 - line * 0.3 * smoothstep(0.03, 0.3, depth);

    // Ближе к зрителю вода темнее
    col *= mix(0.95, 0.7, depth);
    return col;
  }

  void main() {
    vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
    vec3 col = p.y < uHorizon ? sky(p) : water(p);

    // Тонкая линия горизонта
    float hx = abs(p.x / uRes.x - 0.5);
    col += vec3(1.0, 0.86, 0.95) * exp(-abs(p.y - uHorizon) / (0.9 * uDpr)) * 0.15 * (1.0 - hx);

    // Виньетка
    vec2 uv = p / uRes - 0.5;
    col *= 1.0 - smoothstep(0.35, 0.95, length(uv * vec2(1.1, 1.0))) * 0.35;

    // Дизеринг против полос в градиентах
    col += (hash(p + fract(uTime)) - 0.5) / 255.0;

    gl_FragColor = vec4(col, 1.0);
  }
`;


// ============================================================
//  WebGL
// ============================================================
const canvas = document.getElementById('scene');
const card = document.getElementById('card');
const gl = canvas.getContext('webgl', { antialias: false, alpha: false });

function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram() {
  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

let uniforms = null;
let dpr = 1;

function initScene() {
  const program = createProgram();
  gl.useProgram(program);

  // Один треугольник на весь экран
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  uniforms = {};
  for (const name of ['uRes', 'uTime', 'uDpr', 'uHorizon', 'uRing', 'uCard']) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }
}

function resize() {
  // Ограничиваем плотность пикселей: шейдер тяжёлый
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
}

function renderScene(time) {
  const w = canvas.width;
  const h = canvas.height;
  const rect = card.getBoundingClientRect();

  gl.uniform2f(uniforms.uRes, w, h);
  gl.uniform1f(uniforms.uTime, time);
  gl.uniform1f(uniforms.uDpr, dpr);
  gl.uniform1f(uniforms.uHorizon, h * HORIZON);
  gl.uniform1f(uniforms.uRing, Math.min(h * RING, w * 0.45));
  gl.uniform4f(uniforms.uCard, rect.left * dpr, rect.top * dpr, rect.right * dpr, rect.bottom * dpr);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}


// ============================================================
//  Наклон карты за курсором (плавно)
// ============================================================
const tilt = { x: 0, y: 0, targetX: 0, targetY: 0 };

window.addEventListener('pointermove', (e) => {
  tilt.targetX = (e.clientX / window.innerWidth) * 2 - 1;
  tilt.targetY = (e.clientY / window.innerHeight) * 2 - 1;
});

document.addEventListener('mouseleave', () => {
  tilt.targetX = 0;
  tilt.targetY = 0;
});

function updateCard(time) {
  tilt.x += (tilt.targetX - tilt.x) * 0.06;
  tilt.y += (tilt.targetY - tilt.y) * 0.06;

  card.style.setProperty('--ry', `${tilt.x * 14}deg`);
  card.style.setProperty('--rx', `${-tilt.y * 8}deg`);
  card.style.setProperty('--shine', `${50 - tilt.x * 35 - tilt.y * 15}%`);
  card.style.setProperty('--float', `${Math.sin(time * 0.9) * 6}px`);
}


// ============================================================
//  Запуск
// ============================================================
let sceneReady = false;

function frame(ms) {
  const time = ms / 1000;
  updateCard(time);
  if (sceneReady) renderScene(time);
  requestAnimationFrame(frame);
}

try {
  if (!gl) throw new Error('WebGL недоступен');
  initScene();
  resize();
  window.addEventListener('resize', resize);
  sceneReady = true;
} catch (err) {
  console.warn(err);
  document.documentElement.classList.add('no-webgl');
}

if (reducedMotion) {
  // Без анимации: один статичный кадр
  if (sceneReady) {
    renderScene(0);
    window.addEventListener('resize', () => renderScene(0));
  }
} else {
  requestAnimationFrame(frame);
}
