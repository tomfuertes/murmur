/** GLSL shader sources for the ambient vibe visualization. */

export const vertexSource = /* glsl */ `#version 300 es
precision highp float;
const vec2 verts[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2( 3.0, -1.0),
  vec2(-1.0,  3.0)
);
out vec2 v_uv;
void main() {
  v_uv = verts[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}
`;

export const fragmentSource = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2  u_resolution;
uniform float u_speed;
uniform float u_hue_base;
uniform float u_hue_spread;
uniform float u_saturation;
uniform float u_blur;
uniform float u_echo_intensity;
uniform float u_detail;
uniform float u_warp_strength;
uniform float u_brightness;
uniform float u_layer_mask;
uniform float u_seed;
uniform sampler2D u_echo_tex;

// --- 3D Simplex-ish noise via hash-based gradients ---
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289((x * 34.0 + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g, l.zxy);
  vec3 i2 = max(g, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - 0.5;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  vec4 j = p - 49.0 * floor(p * (1.0 / 49.0));
  vec4 x_ = floor(j * (1.0 / 7.0));
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 ox = (x_ * 2.0 + 0.5) / 7.0 - 1.0;
  vec4 oy = (y_ * 2.0 + 0.5) / 7.0 - 1.0;
  vec4 gz = 1.0 - abs(ox) - abs(oy);
  vec4 sz = step(gz, vec4(0.0));
  ox -= sz * (step(vec4(0.0), ox) - 0.5);
  oy -= sz * (step(vec4(0.0), oy) - 0.5);
  vec3 g0 = vec3(ox.x, oy.x, gz.x);
  vec3 g1 = vec3(ox.y, oy.y, gz.y);
  vec3 g2 = vec3(ox.z, oy.z, gz.z);
  vec3 g3 = vec3(ox.w, oy.w, gz.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g0,g0),dot(g1,g1),dot(g2,g2),dot(g3,g3)));
  g0 *= norm.x; g1 *= norm.y; g2 *= norm.z; g3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(g0,x0),dot(g1,x1),dot(g2,x2),dot(g3,x3)));
}

// --- FBM with domain warping ---
float fbm(vec3 p, float detail, float lacunarity) {
  float value = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  int octaves = int(floor(detail));
  float frac = fract(detail);

  for (int i = 0; i < 3; i++) {
    if (i >= octaves + 1) break;
    float n = snoise(p * freq);
    float weight = (i == octaves) ? frac : 1.0;
    value += n * amp * weight;
    amp *= 0.5;
    freq *= lacunarity;
    p += vec3(3.123, 7.456, 1.789);
  }
  return value;
}

// --- HSV to RGB ---
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = v_uv;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspect;

  float t = u_time * u_speed * 0.1;

  // --- Milkdrop-style radial coordinates ---
  float r = length(p);
  float angle = atan(p.y, p.x) + 3.14159; // shift to 0..2PI, moves seam to 9 o'clock behind content

  // Kaleidoscope: mirror across N segments (controlled by layer mask)
  int mask = int(u_layer_mask);
  float segments = ((mask & 4) != 0) ? 6.0 : 4.0;
  float segSize = 6.28318 / segments;
  float kAngle = mod(angle, segSize);
  // Triangle-wave fold for seamless mirroring
  kAngle = segSize * 0.5 - abs(kAngle - segSize * 0.5);
  vec2 kp = vec2(cos(kAngle), sin(kAngle)) * r;

  // Domain warp — driven by density (u_warp_strength)
  float warpX = snoise(vec3(kp * 1.8 + u_seed, t * 0.7)) * u_warp_strength;
  float warpY = snoise(vec3(kp * 1.8 + u_seed + 50.0, t * 0.7 + 30.0)) * u_warp_strength;

  // Slow rotation driven by speed
  float rotAngle = t * 0.3;
  mat2 rot = mat2(cos(rotAngle), -sin(rotAngle), sin(rotAngle), cos(rotAngle));
  vec2 warped = rot * (kp + vec2(warpX, warpY));

  vec3 domain = vec3(warped, t);

  // u_blur affects lacunarity: lower blur = higher lacunarity (sharper detail)
  float lacunarity = mix(2.4, 1.6, u_blur);
  float n = fbm(domain, u_detail, lacunarity);

  // Remap noise to 0-1 range
  n = n * 0.5 + 0.5;

  // Secondary warped layer (toggle via mask bit 1)
  float layer2 = ((mask & 2) != 0) ? 1.0 : 0.0;
  float n2 = fbm(domain * 0.6 + vec3(10.0, 20.0, 0.0), max(u_detail - 1.0, 1.0), lacunarity);
  n2 = n2 * 0.5 + 0.5;
  n = mix(n, n * 0.6 + n2 * 0.4, layer2);

  // Radial glow — brighter toward center (Milkdrop-style focal point)
  float glow = 1.0 - smoothstep(0.0, 0.8, r);
  n = n * (0.7 + glow * 0.5);

  // Hue: noise-driven variation using kaleidoscope-folded coords (no angular seam)
  float hueShift = snoise(vec3(warped * 0.8, t * 0.3)) * u_hue_spread;
  float hue = fract(u_hue_base + hueShift + n * u_hue_spread * 0.5);
  float sat = u_saturation;
  float val = clamp(n * u_brightness, 0.0, 1.0);

  vec3 color = hsv2rgb(vec3(hue, sat, val));

  // --- Milkdrop-style zoom feedback ---
  // Sample echo texture with zoom toward center + slight rotation
  float zoomAmt = 1.0 - u_echo_intensity * 0.04;
  float echoRot = u_echo_intensity * 0.01;
  vec2 echoUV = uv - 0.5;
  mat2 echoMat = mat2(
    cos(echoRot) * zoomAmt, -sin(echoRot) * zoomAmt,
    sin(echoRot) * zoomAmt,  cos(echoRot) * zoomAmt
  );
  echoUV = echoMat * echoUV + 0.5;
  vec3 echo = texture(u_echo_tex, echoUV).rgb;

  // Slight color shift on the feedback for trail evolution
  echo = echo * vec3(0.98, 0.99, 1.01);

  color = mix(color, max(color, echo * 0.95), u_echo_intensity);

  fragColor = vec4(color, 1.0);
}
`;
