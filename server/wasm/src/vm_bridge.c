#include <emscripten.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "quickjs.h"
#include "vm_antidbg.h"
#include "vm_crypto.h"
#include "vm_exports.h"
#include "vm_inference.h"
#include "vm_keys.h"

extern const unsigned char AGE_MODEL_DATA[];
extern const int AGE_MODEL_DATA_LEN;

static AgeModel g_age_model;
static int g_model_ready;

#define MAGIC_BC 0x564d4243
#define MAGIC_RESP 0x564d5250
#define NONCE_LEN 12
#define MAC_LEN 32
#define MIN_BRIGHTNESS 55.0f
#define MAX_BRIGHTNESS 205.0f
#define MIN_CONTRAST 20.0f
#define MIN_SHARPNESS 3.0f

static void wipe(volatile uint8_t *p, size_t n) {
	for (size_t i = 0; i < n; i++)
		p[i] = 0;
}

static JSRuntime *g_rt;
static JSContext *g_ctx;
static char g_last_error[256];

static void set_last_error(const char *msg) {
	if (!msg) {
		g_last_error[0] = '\0';
		return;
	}
	snprintf(g_last_error, sizeof(g_last_error), "%s", msg);
	EM_ASM({ console.error(UTF8ToString($0)); }, g_last_error);
}

static void set_last_js_error(const char *prefix) {
	JSValue exc = JS_GetException(g_ctx);
	const char *msg = JS_ToCString(g_ctx, exc);
	char buf[256];
	if (msg)
		snprintf(buf, sizeof(buf), "%s: %s", prefix, msg);
	else
		snprintf(buf, sizeof(buf), "%s", prefix);
	set_last_error(buf);
	if (msg)
		JS_FreeCString(g_ctx, msg);
	JS_FreeValue(g_ctx, exc);
}

static void parse_box_values(const char *arg, float *bx, float *by, float *bw,
							 float *bh) {
	float parsed_x;
	float parsed_y;
	float parsed_w;
	float parsed_h;

	if (!arg)
		return;

	if (sscanf(arg, "%f,%f,%f,%f", &parsed_x, &parsed_y, &parsed_w,
			   &parsed_h) != 4)
		return;

	*bx = parsed_x;
	*by = parsed_y;
	*bw = parsed_w;
	*bh = parsed_h;
}

static JSValue js_vm_ts(JSContext *ctx, JSValueConst this_val, int argc,
						JSValueConst *argv) {
	double t = EM_ASM_DOUBLE({ return Date.now(); });
	return JS_NewFloat64(ctx, t);
}

static JSValue js_vm_integrity(JSContext *ctx, JSValueConst this_val, int argc,
							   JSValueConst *argv) {
	uint32_t s = antidbg_state();
	return JS_NewUint32(ctx, s);
}

static JSValue js_vm_check(JSContext *ctx, JSValueConst this_val, int argc,
						   JSValueConst *argv) {
	int r = antidbg_check();
	return JS_NewInt32(ctx, r);
}

static JSValue js_console_log(JSContext *ctx, JSValueConst this_val, int argc,
							  JSValueConst *argv) {
	for (int i = 0; i < argc; i++) {
		const char *s = JS_ToCString(ctx, argv[i]);
		if (s) {
			EM_ASM({ console.log(UTF8ToString($0)); }, s);
			JS_FreeCString(ctx, s);
		}
	}
	return JS_UNDEFINED;
}

static char *read_browser_global(const char *name) {
	return (char *)EM_ASM_INT(
		{
			var key = UTF8ToString($0);
			var obj = window[key] || {};
			var str = JSON.stringify(obj);
			var len = lengthBytesUTF8(str) + 1;
			var ptr = _malloc(len);
			if (!ptr)
				return 0;
			stringToUTF8(str, ptr, len);
			return ptr;
		},
		name);
}

static JSValue js_vm_get_face_data(JSContext *ctx, JSValueConst this_val,
								   int argc, JSValueConst *argv) {
	char *json = read_browser_global("__vmFaceData");
	JSValue ret = JS_NewString(ctx, json ? json : "{}");
	free(json);
	return ret;
}

static JSValue js_vm_get_challenge(JSContext *ctx, JSValueConst this_val,
								   int argc, JSValueConst *argv) {
	char *json = read_browser_global("__vmChallenge");
	JSValue ret = JS_NewString(ctx, json ? json : "{}");
	free(json);
	return ret;
}

static char *call_browser_fn(const char *fn_name, const char *arg) {
	// clang-format off
    return (char *)EM_ASM_INT(
        {
            var name = UTF8ToString($0);
            var param = UTF8ToString($1);
            var fn = window.__vmBridge && window.__vmBridge[name];
            if (!fn)
                return 0;
            var result = fn(param);
            if (typeof result !== "string")
                return 0;
            var len = lengthBytesUTF8(result) + 1;
            var ptr = _malloc(len);
			if (!ptr)
				return 0;
            stringToUTF8(result, ptr, len);
            return ptr;
        },
        fn_name, arg);
	// clang-format on
}

static JSValue js_vm_estimate_age(JSContext *ctx, JSValueConst this_val,
								  int argc, JSValueConst *argv) {
	char *json = call_browser_fn("estimateAge", "");
	JSValue ret = JS_NewString(ctx, json ? json : "null");
	if (json)
		free(json);
	return ret;
}

static JSValue js_vm_track_face(JSContext *ctx, JSValueConst this_val, int argc,
								JSValueConst *argv) {
	char *json = call_browser_fn("trackFace", "");
	JSValue ret = JS_NewString(ctx, json ? json : "null");
	if (json)
		free(json);
	return ret;
}

static JSValue js_vm_capture_frame(JSContext *ctx, JSValueConst this_val,
								   int argc, JSValueConst *argv) {
	char *json = call_browser_fn("captureFrame", "");
	JSValue ret = JS_NewString(ctx, json ? json : "null");
	if (json)
		free(json);
	return ret;
}

static void clamp_box(float *bx, float *by, float *bw, float *bh) {
	if (*bx < 0)
		*bx = 0;
	if (*bx > 1)
		*bx = 1;
	if (*by < 0)
		*by = 0;
	if (*by > 1)
		*by = 1;
	if (*bw < 0.01f)
		*bw = 0.01f;
	if (*bw > 1)
		*bw = 1;
	if (*bh < 0.01f)
		*bh = 0.01f;
	if (*bh > 1)
		*bh = 1;
	if (*bx + *bw > 1)
		*bw = 1 - *bx;
	if (*by + *bh > 1)
		*bh = 1 - *by;
}

static int capture_video_frame(uint8_t **pixels, int *video_width,
							   int *video_height) {
	if (!pixels || !video_width || !video_height)
		return 0;

	*pixels = NULL;
	*video_width = 0;
	*video_height = 0;

	int vw = EM_ASM_INT({
		var v = document.querySelector('video');
		return v ? v.videoWidth : 0;
	});
	int vh = EM_ASM_INT({
		var v = document.querySelector('video');
		return v ? v.videoHeight : 0;
	});

	if (vw <= 0 || vh <= 0)
		return 0;
	if ((size_t)vw > ((size_t)INT_MAX / 4) / (size_t)vh)
		return 0;

	size_t frame_size = (size_t)vw * (size_t)vh * 4u;
	uint8_t *buffer = (uint8_t *)malloc(frame_size);
	if (!buffer)
		return 0;

	int copied = EM_ASM_INT(
		{
			var v = document.querySelector('video');
			if (!v)
				return 0;
			var c = document.createElement('canvas');
			c.width = $1;
			c.height = $2;
			var g = c.getContext('2d');
			if (!g)
				return 0;
			g.drawImage(v, 0, 0, $1, $2);
			var d = g.getImageData(0, 0, $1, $2);
			HEAPU8.set(d.data, $0);
			return 1;
		},
		buffer, vw, vh);
	if (!copied) {
		free(buffer);
		return 0;
	}

	*pixels = buffer;
	*video_width = vw;
	*video_height = vh;
	return 1;
}

static float pixel_luma(const uint8_t *rgba, int width, int x, int y) {
	int idx = (y * width + x) * 4;
	return 0.299f * rgba[idx] + 0.587f * rgba[idx + 1] + 0.114f * rgba[idx + 2];
}

static int evaluate_frame_quality(const uint8_t *rgba, int width, int height,
								  float bx, float by, float bw, float bh,
								  const char **reason) {
	int x0 = (int)floorf(bx * width);
	int y0 = (int)floorf(by * height);
	int x1 = (int)ceilf((bx + bw) * width);
	int y1 = (int)ceilf((by + bh) * height);

	if (x0 < 1)
		x0 = 1;
	if (y0 < 1)
		y0 = 1;
	if (x1 > width - 1)
		x1 = width - 1;
	if (y1 > height - 1)
		y1 = height - 1;
	if (x1 - x0 < 16 || y1 - y0 < 16) {
		*reason = "quality_unavailable";
		return 0;
	}

	double sum = 0;
	double sum_sq = 0;
	double laplacian_sum = 0;
	int count = 0;

	for (int y = y0; y < y1; y += 3) {
		for (int x = x0; x < x1; x += 3) {
			float center = pixel_luma(rgba, width, x, y);
			float left = pixel_luma(rgba, width, x - 1, y);
			float right = pixel_luma(rgba, width, x + 1, y);
			float top = pixel_luma(rgba, width, x, y - 1);
			float bottom = pixel_luma(rgba, width, x, y + 1);
			sum += center;
			sum_sq += center * center;
			laplacian_sum += fabsf(4 * center - left - right - top - bottom);
			count++;
		}
	}

	if (count == 0) {
		*reason = "quality_unavailable";
		return 0;
	}

	float brightness = (float)(sum / count);
	float variance = (float)(sum_sq / count - brightness * brightness);
	if (variance < 0)
		variance = 0;
	float contrast = sqrtf(variance);
	float sharpness = (float)(laplacian_sum / count / 3.0);

	if (brightness < MIN_BRIGHTNESS) {
		*reason = "too_dark";
		return 0;
	}
	if (brightness > MAX_BRIGHTNESS) {
		*reason = "too_bright";
		return 0;
	}
	if (contrast < MIN_CONTRAST) {
		*reason = "low_contrast";
		return 0;
	}
	if (sharpness < MIN_SHARPNESS) {
		*reason = "image_blurry";
		return 0;
	}

	return 1;
}

static JSValue js_vm_check_frame_quality(JSContext *ctx, JSValueConst this_val,
										 int argc, JSValueConst *argv) {
	float bx = 0, by = 0, bw = 1, bh = 1;
	if (argc > 0) {
		const char *arg = JS_ToCString(ctx, argv[0]);
		if (arg) {
			parse_box_values(arg, &bx, &by, &bw, &bh);
			JS_FreeCString(ctx, arg);
		}
	}

	clamp_box(&bx, &by, &bw, &bh);

	uint8_t *pixels = NULL;
	int width = 0;
	int height = 0;
	if (!capture_video_frame(&pixels, &width, &height)) {
		return JS_NewString(
			ctx, "{\"ok\":false,\"reason\":\"quality_unavailable\"}");
	}

	const char *reason = NULL;
	int ok =
		evaluate_frame_quality(pixels, width, height, bx, by, bw, bh, &reason);
	free(pixels);

	if (ok)
		return JS_NewString(ctx, "{\"ok\":true}");

	char buffer[96];
	snprintf(buffer, sizeof(buffer), "{\"ok\":false,\"reason\":\"%s\"}",
			 reason ? reason : "quality_unavailable");
	return JS_NewString(ctx, buffer);
}

static void ensure_age_model(void) {
	if (g_model_ready)
		return;
	g_model_ready = age_model_load(&g_age_model, (const float *)AGE_MODEL_DATA,
								   AGE_MODEL_DATA_LEN / (int)sizeof(float)) == 0
						? 1
						: -1;
}

static JSValue js_vm_infer_age(JSContext *ctx, JSValueConst this_val, int argc,
							   JSValueConst *argv) {
	ensure_age_model();
	if (g_model_ready != 1)
		return JS_NewString(ctx, "{\"age\":null}");

	float bx = 0, by = 0, bw = 1, bh = 1;
	if (argc > 0) {
		const char *arg = JS_ToCString(ctx, argv[0]);
		if (arg) {
			parse_box_values(arg, &bx, &by, &bw, &bh);
			JS_FreeCString(ctx, arg);
		}
	}
	clamp_box(&bx, &by, &bw, &bh);

	uint8_t *px = NULL;
	int vw = 0;
	int vh = 0;
	if (!capture_video_frame(&px, &vw, &vh))
		return JS_NewString(ctx, "{\"age\":null}");

	float age = age_model_infer(&g_age_model, px, vw, vh, bx, by, bw, bh);
	free(px);

	char buf[64];
	snprintf(buf, sizeof(buf), "{\"age\":%.1f}", age);
	return JS_NewString(ctx, buf);
}

static void register_intrinsics(JSContext *ctx) {
	JSValue g = JS_GetGlobalObject(ctx);

	JS_SetPropertyStr(ctx, g, "__vm_ts",
					  JS_NewCFunction(ctx, js_vm_ts, "__vm_ts", 0));
	JS_SetPropertyStr(
		ctx, g, "__vm_integrity",
		JS_NewCFunction(ctx, js_vm_integrity, "__vm_integrity", 0));
	JS_SetPropertyStr(ctx, g, "__vm_check",
					  JS_NewCFunction(ctx, js_vm_check, "__vm_check", 0));
	JS_SetPropertyStr(
		ctx, g, "__vm_get_face_data",
		JS_NewCFunction(ctx, js_vm_get_face_data, "__vm_get_face_data", 0));
	JS_SetPropertyStr(
		ctx, g, "__vm_get_challenge",
		JS_NewCFunction(ctx, js_vm_get_challenge, "__vm_get_challenge", 0));
	JS_SetPropertyStr(
		ctx, g, "__vm_estimate_age",
		JS_NewCFunction(ctx, js_vm_estimate_age, "__vm_estimate_age", 0));
	JS_SetPropertyStr(
		ctx, g, "__vm_track_face",
		JS_NewCFunction(ctx, js_vm_track_face, "__vm_track_face", 0));
	JS_SetPropertyStr(
		ctx, g, "__vm_capture_frame",
		JS_NewCFunction(ctx, js_vm_capture_frame, "__vm_capture_frame", 0));
	JS_SetPropertyStr(ctx, g, "__vm_check_frame_quality",
					  JS_NewCFunction(ctx, js_vm_check_frame_quality,
									  "__vm_check_frame_quality", 1));
	JS_SetPropertyStr(
		ctx, g, "__vm_infer_age",
		JS_NewCFunction(ctx, js_vm_infer_age, "__vm_infer_age", 1));

	JSValue console = JS_NewObject(ctx);
	JS_SetPropertyStr(ctx, console, "log",
					  JS_NewCFunction(ctx, js_console_log, "log", 1));
	JS_SetPropertyStr(ctx, g, "console", console);

	JS_FreeValue(ctx, g);
}

EMSCRIPTEN_KEEPALIVE
int vm_init(void) {
	antidbg_init();
	set_last_error(NULL);

	g_rt = JS_NewRuntime();
	if (!g_rt)
		return -1;

	JS_SetMemoryLimit(g_rt, 32 * 1024 * 1024);
	JS_SetMaxStackSize(g_rt, 256 * 1024);

	g_ctx = JS_NewContext(g_rt);
	if (!g_ctx) {
		JS_FreeRuntime(g_rt);
		g_rt = NULL;
		return -1;
	}

	register_intrinsics(g_ctx);
	return 0;
}

EMSCRIPTEN_KEEPALIVE
void vm_destroy(void) {
	if (g_ctx) {
		JS_FreeContext(g_ctx);
		g_ctx = NULL;
	}
	if (g_rt) {
		JS_FreeRuntime(g_rt);
		g_rt = NULL;
	}
}

static uint32_t read_u32_le(const uint8_t *p) {
	return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
		   ((uint32_t)p[3] << 24);
}

static void write_u32_le(uint8_t *out, uint32_t v) {
	out[0] = (uint8_t)(v);
	out[1] = (uint8_t)(v >> 8);
	out[2] = (uint8_t)(v >> 16);
	out[3] = (uint8_t)(v >> 24);
}

EMSCRIPTEN_KEEPALIVE
uint8_t *vm_decrypt_blob(const uint8_t *input, int input_len, int *out_len) {
	if (!input || !out_len)
		return NULL;

	*out_len = 0;

	if (input_len < 20)
		return NULL;

	uint32_t plain_len = read_u32_le(input);
	uint32_t ct_len = read_u32_le(input + 4);
	size_t header_len = 8u + NONCE_LEN;

	if (plain_len != ct_len)
		return NULL;
	if ((size_t)ct_len > (size_t)input_len - header_len)
		return NULL;
	if (plain_len > (uint32_t)INT_MAX)
		return NULL;

	const uint8_t *nonce = input + 8;
	const uint8_t *ct = input + 8 + NONCE_LEN;

	size_t output_len = (size_t)plain_len;
	uint8_t *out = (uint8_t *)malloc(output_len == 0 ? 1 : output_len);
	if (!out)
		return NULL;

	uint8_t dk[32];
	VM_DERIVE_KEY(VM_KEY_ID_DECRYPT, dk);
	chacha20(out, ct, output_len, dk, nonce, 1);
	wipe((volatile uint8_t *)dk, 32);

	*out_len = (int)output_len;
	return out;
}

EMSCRIPTEN_KEEPALIVE
const char *vm_last_error(void) { return g_last_error; }

static uint8_t *encrypt_and_sign(const char *str, size_t str_len,
								 int *out_len) {
	if (!str || !out_len)
		return NULL;
	if (str_len > SIZE_MAX - (8u + NONCE_LEN + MAC_LEN))
		return NULL;

	*out_len = 0;
	uint8_t resp_nonce[NONCE_LEN];
	double ts = EM_ASM_DOUBLE({ return Date.now(); });
	uint64_t ts_u = (uint64_t)ts;
	memcpy(resp_nonce, &ts_u, 8);
	uint32_t ctr = antidbg_state();
	memcpy(resp_nonce + 8, &ctr, 4);

	uint8_t *resp_ct = NULL;
	if (str_len > 0) {
		resp_ct = (uint8_t *)malloc(str_len);
		if (!resp_ct)
			return NULL;
	}

	if (str_len > 0) {
		uint8_t ek[32];
		VM_DERIVE_KEY(VM_KEY_ID_ENCRYPT, ek);
		chacha20(resp_ct, (const uint8_t *)str, str_len, ek, resp_nonce, 1);
		wipe((volatile uint8_t *)ek, 32);
	}

	size_t total = 8u + NONCE_LEN + str_len + MAC_LEN;
	if (total > (size_t)INT_MAX) {
		free(resp_ct);
		return NULL;
	}

	uint8_t *resp = (uint8_t *)malloc(total);
	if (!resp) {
		free(resp_ct);
		return NULL;
	}

	write_u32_le(resp, MAGIC_RESP);
	write_u32_le(resp + 4, (uint32_t)total);
	memcpy(resp + 8, resp_nonce, NONCE_LEN);
	if (str_len > 0)
		memcpy(resp + 8 + NONCE_LEN, resp_ct, str_len);
	free(resp_ct);

	uint8_t sk[32];
	VM_DERIVE_KEY(VM_KEY_ID_SIGN, sk);
	int sign_result = hmac_sha256(resp + 8 + NONCE_LEN + str_len, sk, 32,
								  resp + 8, NONCE_LEN + str_len);
	wipe((volatile uint8_t *)sk, 32);
	if (sign_result != 0) {
		free(resp);
		return NULL;
	}

	*out_len = (int)total;
	return resp;
}

EMSCRIPTEN_KEEPALIVE
uint8_t *vm_exec_bytecode(const uint8_t *bundle, int bundle_len, int *out_len) {
	if (!out_len)
		return NULL;

	*out_len = 0;
	set_last_error(NULL);
	if (!bundle) {
		set_last_error("bundle missing");
		return NULL;
	}
	if (!g_rt || !g_ctx) {
		set_last_error("vm not initialized");
		return NULL;
	}

	antidbg_on_exec();
	if (antidbg_check() != 0) {
		set_last_error("anti-debug check failed");
		return NULL;
	}

	if (bundle_len < 20) {
		set_last_error("bundle too short");
		return NULL;
	}

	uint32_t magic = read_u32_le(bundle);
	if (magic != MAGIC_BC) {
		set_last_error("bundle magic mismatch");
		return NULL;
	}

	uint32_t bc_len = read_u32_le(bundle + 4);
	if ((size_t)bc_len > (size_t)bundle_len - (8u + NONCE_LEN)) {
		set_last_error("bundle length mismatch");
		return NULL;
	}

	const uint8_t *nonce_in = bundle + 8;
	const uint8_t *ct_in = bundle + 8 + NONCE_LEN;

	uint8_t *bc = (uint8_t *)malloc(bc_len == 0 ? 1 : (size_t)bc_len);
	if (!bc) {
		set_last_error("bytecode allocation failed");
		return NULL;
	}

	uint8_t dk[32];
	VM_DERIVE_KEY(VM_KEY_ID_DECRYPT, dk);
	chacha20(bc, ct_in, (size_t)bc_len, dk, nonce_in, 1);
	wipe((volatile uint8_t *)dk, 32);

	JSValue val = JS_ReadObject(g_ctx, bc, bc_len, JS_READ_OBJ_BYTECODE);
	free(bc);

	if (JS_IsException(val)) {
		set_last_js_error("JS_ReadObject failed");
		JS_FreeValue(g_ctx, val);
		return NULL;
	}

	JSValue result = JS_EvalFunction(g_ctx, val);
	if (JS_IsException(result)) {
		set_last_js_error("JS_EvalFunction failed");
		JS_FreeValue(g_ctx, result);
		return NULL;
	}

	const char *str = JS_ToCString(g_ctx, result);
	JS_FreeValue(g_ctx, result);
	if (!str) {
		set_last_error("result serialization failed");
		return NULL;
	}

	uint8_t *resp = encrypt_and_sign(str, strlen(str), out_len);
	JS_FreeCString(g_ctx, str);
	if (!resp)
		set_last_error("response sealing failed");
	return resp;
}

EMSCRIPTEN_KEEPALIVE
void vm_free(void *ptr) { free(ptr); }
