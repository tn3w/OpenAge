#include "vm_inference.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define IN AGE_INPUT
#define MB AGE_MAXBUF

static void conv2d_3x3(float *out, const float *in, const float *filt,
					   const float *bias, int h, int w, int ci, int co,
					   int stride) {
	int oh = (h + stride - 1) / stride;
	int ow = (w + stride - 1) / stride;
	int pad_h = (oh - 1) * stride + 3 - h;
	if (pad_h < 0)
		pad_h = 0;
	int pad_top = pad_h / 2;
	int pad_w = (ow - 1) * stride + 3 - w;
	if (pad_w < 0)
		pad_w = 0;
	int pad_left = pad_w / 2;

	for (int y = 0; y < oh; y++)
		for (int x = 0; x < ow; x++)
			for (int oc = 0; oc < co; oc++) {
				float v = bias[oc];
				for (int fy = 0; fy < 3; fy++) {
					int iy = y * stride - pad_top + fy;
					if (iy < 0 || iy >= h)
						continue;
					for (int fx = 0; fx < 3; fx++) {
						int ix = x * stride - pad_left + fx;
						if (ix < 0 || ix >= w)
							continue;
						const float *ip = in + (iy * w + ix) * ci;
						const float *fp = filt + ((fy * 3 + fx) * ci) * co + oc;
						for (int ic = 0; ic < ci; ic++)
							v += ip[ic] * fp[ic * co];
					}
				}
				out[(y * ow + x) * co + oc] = v;
			}
}

static void conv1x1(float *out, const float *in, const float *filt,
					const float *bias, int h, int w, int ci, int co,
					int stride) {
	int oh = h / stride;
	int ow = w / stride;

	for (int y = 0; y < oh; y++)
		for (int x = 0; x < ow; x++) {
			const float *ip = in + (y * stride * w + x * stride) * ci;
			float *op = out + (y * ow + x) * co;
			for (int oc = 0; oc < co; oc++) {
				float v = bias[oc];
				for (int ic = 0; ic < ci; ic++)
					v += ip[ic] * filt[ic * co + oc];
				op[oc] = v;
			}
		}
}

static void dw_conv3x3(float *out, const float *in, const float *filt, int h,
					   int w, int c) {
	for (int y = 0; y < h; y++)
		for (int x = 0; x < w; x++)
			for (int ch = 0; ch < c; ch++) {
				float v = 0;
				for (int fy = 0; fy < 3; fy++) {
					int iy = y + fy - 1;
					if (iy < 0 || iy >= h)
						continue;
					for (int fx = 0; fx < 3; fx++) {
						int ix = x + fx - 1;
						if (ix < 0 || ix >= w)
							continue;
						v += in[(iy * w + ix) * c + ch] *
							 filt[(fy * 3 + fx) * c + ch];
					}
				}
				out[(y * w + x) * c + ch] = v;
			}
}

static void pw_conv(float *out, const float *in, const float *filt,
					const float *bias, int h, int w, int ci, int co) {
	for (int y = 0; y < h; y++)
		for (int x = 0; x < w; x++) {
			const float *ip = in + (y * w + x) * ci;
			float *op = out + (y * w + x) * co;
			for (int oc = 0; oc < co; oc++) {
				float v = bias[oc];
				for (int ic = 0; ic < ci; ic++)
					v += ip[ic] * filt[ic * co + oc];
				op[oc] = v;
			}
		}
}

static void relu_ip(float *data, int n) {
	for (int i = 0; i < n; i++)
		if (data[i] < 0)
			data[i] = 0;
}

static void maxpool_3x3_s2(float *out, const float *in, int h, int w, int c) {
	int oh = (h + 1) / 2;
	int ow = (w + 1) / 2;
	int pad_h = (oh - 1) * 2 + 3 - h;
	if (pad_h < 0)
		pad_h = 0;
	int pad_top = pad_h / 2;
	int pad_w = (ow - 1) * 2 + 3 - w;
	if (pad_w < 0)
		pad_w = 0;
	int pad_left = pad_w / 2;

	for (int y = 0; y < oh; y++)
		for (int x = 0; x < ow; x++)
			for (int ch = 0; ch < c; ch++) {
				float mx = -1e30f;
				for (int fy = 0; fy < 3; fy++) {
					int iy = y * 2 - pad_top + fy;
					if (iy < 0 || iy >= h)
						continue;
					for (int fx = 0; fx < 3; fx++) {
						int ix = x * 2 - pad_left + fx;
						if (ix < 0 || ix >= w)
							continue;
						float v = in[(iy * w + ix) * c + ch];
						if (v > mx)
							mx = v;
					}
				}
				out[(y * ow + x) * c + ch] = mx;
			}
}

static void gap(float *out, const float *in, int h, int w, int c) {
	float inv = 1.0f / (float)(h * w);
	for (int ch = 0; ch < c; ch++) {
		float s = 0;
		for (int y = 0; y < h; y++)
			for (int x = 0; x < w; x++)
				s += in[(y * w + x) * c + ch];
		out[ch] = s * inv;
	}
}

static void fc(float *out, const float *in, const float *weights,
			   const float *bias, int ni, int no) {
	for (int o = 0; o < no; o++) {
		float v = bias[o];
		for (int i = 0; i < ni; i++)
			v += in[i] * weights[i * no + o];
		out[o] = v;
	}
}

static void add_ip(float *dst, const float *src, int n) {
	for (int i = 0; i < n; i++)
		dst[i] += src[i];
}

static float sample_padded(const uint8_t *rgba, int src_w, int crop_x,
						   int crop_y, int crop_w, int crop_h, int pad_left,
						   int pad_top, int side, int px, int py, int c) {
	if (px < 0)
		px = 0;
	if (py < 0)
		py = 0;
	if (px >= side)
		px = side - 1;
	if (py >= side)
		py = side - 1;

	int fx = px - pad_left;
	int fy = py - pad_top;
	if (fx < 0 || fx >= crop_w || fy < 0 || fy >= crop_h)
		return 0;

	return (float)rgba[((crop_y + fy) * src_w + crop_x + fx) * 4 + c];
}

static void preprocess(float *out, const uint8_t *rgba, int src_w, int src_h,
					   float box_x, float box_y, float box_w, float box_h) {
	int crop_x = (int)floorf(box_x * src_w);
	int crop_y = (int)floorf(box_y * src_h);
	int crop_w = (int)floorf(box_w * src_w);
	int crop_h = (int)floorf(box_h * src_h);

	if (crop_x < 0) {
		crop_w += crop_x;
		crop_x = 0;
	}
	if (crop_y < 0) {
		crop_h += crop_y;
		crop_y = 0;
	}
	if (crop_x + crop_w > src_w)
		crop_w = src_w - crop_x;
	if (crop_y + crop_h > src_h)
		crop_h = src_h - crop_y;
	if (crop_w < 1)
		crop_w = 1;
	if (crop_h < 1)
		crop_h = 1;

	int side = crop_w > crop_h ? crop_w : crop_h;
	int diff_w = side - crop_w;
	int diff_h = side - crop_h;
	int pad_left = diff_w - (int)roundf(diff_w * 0.5f);
	int pad_top = diff_h - (int)roundf(diff_h * 0.5f);

	float scale = (float)side / IN;
	static const float mean_rgb[3] = {122.782f, 117.001f, 104.298f};

	for (int y = 0; y < IN; y++) {
		float sy = y * scale;
		int sy0 = (int)floorf(sy);
		int sy1 = sy0 + 1;
		float fy = sy - sy0;

		for (int x = 0; x < IN; x++) {
			float sx = x * scale;
			int sx0 = (int)floorf(sx);
			int sx1 = sx0 + 1;
			float fx = sx - sx0;

			for (int c = 0; c < 3; c++) {
				float v00 =
					sample_padded(rgba, src_w, crop_x, crop_y, crop_w, crop_h,
								  pad_left, pad_top, side, sx0, sy0, c);
				float v01 =
					sample_padded(rgba, src_w, crop_x, crop_y, crop_w, crop_h,
								  pad_left, pad_top, side, sx1, sy0, c);
				float v10 =
					sample_padded(rgba, src_w, crop_x, crop_y, crop_w, crop_h,
								  pad_left, pad_top, side, sx0, sy1, c);
				float v11 =
					sample_padded(rgba, src_w, crop_x, crop_y, crop_w, crop_h,
								  pad_left, pad_top, side, sx1, sy1, c);
				float v = v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) +
						  v10 * (1 - fx) * fy + v11 * fx * fy;
				out[(y * IN + x) * 3 + c] = (v - mean_rgb[c]) / 256.0f;
			}
		}
	}
}

#define LOAD(ptr, n)                                                           \
	do {                                                                       \
		(ptr) = cursor;                                                        \
		cursor += (n);                                                         \
	} while (0)

int age_model_load(AgeModel *m, const float *data, int count) {
	memset(m, 0, sizeof(*m));
	const float *cursor = data;

	LOAD(m->conv_in_w, 3 * 3 * 3 * 32);
	LOAD(m->conv_in_b, 32);

	LOAD(m->rb0_sc0_dw, 3 * 3 * 32);
	LOAD(m->rb0_sc0_pw, 32 * 64);
	LOAD(m->rb0_sc0_b, 64);
	LOAD(m->rb0_sc1_dw, 3 * 3 * 64);
	LOAD(m->rb0_sc1_pw, 64 * 64);
	LOAD(m->rb0_sc1_b, 64);
	LOAD(m->rb0_exp_w, 32 * 64);
	LOAD(m->rb0_exp_b, 64);

	LOAD(m->rb1_sc0_dw, 3 * 3 * 64);
	LOAD(m->rb1_sc0_pw, 64 * 128);
	LOAD(m->rb1_sc0_b, 128);
	LOAD(m->rb1_sc1_dw, 3 * 3 * 128);
	LOAD(m->rb1_sc1_pw, 128 * 128);
	LOAD(m->rb1_sc1_b, 128);
	LOAD(m->rb1_exp_w, 64 * 128);
	LOAD(m->rb1_exp_b, 128);

	LOAD(m->mb0_sc0_dw, 3 * 3 * 128);
	LOAD(m->mb0_sc0_pw, 128 * 128);
	LOAD(m->mb0_sc0_b, 128);
	LOAD(m->mb0_sc1_dw, 3 * 3 * 128);
	LOAD(m->mb0_sc1_pw, 128 * 128);
	LOAD(m->mb0_sc1_b, 128);
	LOAD(m->mb0_sc2_dw, 3 * 3 * 128);
	LOAD(m->mb0_sc2_pw, 128 * 128);
	LOAD(m->mb0_sc2_b, 128);

	LOAD(m->mb1_sc0_dw, 3 * 3 * 128);
	LOAD(m->mb1_sc0_pw, 128 * 128);
	LOAD(m->mb1_sc0_b, 128);
	LOAD(m->mb1_sc1_dw, 3 * 3 * 128);
	LOAD(m->mb1_sc1_pw, 128 * 128);
	LOAD(m->mb1_sc1_b, 128);
	LOAD(m->mb1_sc2_dw, 3 * 3 * 128);
	LOAD(m->mb1_sc2_pw, 128 * 128);
	LOAD(m->mb1_sc2_b, 128);

	LOAD(m->exit_rb_sc0_dw, 3 * 3 * 128);
	LOAD(m->exit_rb_sc0_pw, 128 * 256);
	LOAD(m->exit_rb_sc0_b, 256);
	LOAD(m->exit_rb_sc1_dw, 3 * 3 * 256);
	LOAD(m->exit_rb_sc1_pw, 256 * 256);
	LOAD(m->exit_rb_sc1_b, 256);
	LOAD(m->exit_rb_exp_w, 128 * 256);
	LOAD(m->exit_rb_exp_b, 256);

	LOAD(m->exit_sc_dw, 3 * 3 * 256);
	LOAD(m->exit_sc_pw, 256 * 512);
	LOAD(m->exit_sc_b, 512);

	LOAD(m->fc_age_w, 512);
	LOAD(m->fc_age_b, 1);
	LOAD(m->fc_gender_w, 512 * 2);
	LOAD(m->fc_gender_b, 2);

	int consumed = (int)(cursor - data);
	if (consumed > count)
		return -1;

	for (int i = 0; i < 4; i++) {
		m->buf[i] = (float *)malloc(MB * sizeof(float));
		if (!m->buf[i]) {
			age_model_free(m);
			return -1;
		}
	}

	m->loaded = 1;
	return 0;
}

void age_model_free(AgeModel *m) {
	for (int i = 0; i < 4; i++) {
		free(m->buf[i]);
		m->buf[i] = NULL;
	}
	m->loaded = 0;
}

#define SC(out, tmp, in, dw, pw, b, h, w, ci, co)                              \
	do {                                                                       \
		dw_conv3x3((tmp), (in), (dw), (h), (w), (ci));                         \
		pw_conv((out), (tmp), (pw), (b), (h), (w), (ci), (co));                \
	} while (0)

float age_model_infer(AgeModel *m, const uint8_t *rgba, int width, int height,
					  float box_x, float box_y, float box_w, float box_h) {
	if (!m->loaded)
		return -1.0f;

	float *input = (float *)malloc(IN * IN * 3 * sizeof(float));
	if (!input)
		return -1.0f;

	preprocess(input, rgba, width, height, box_x, box_y, box_w, box_h);

	float *a = m->buf[0];
	float *b = m->buf[1];
	float *skip = m->buf[2];
	float *tmp = m->buf[3];

	conv2d_3x3(a, input, m->conv_in_w, m->conv_in_b, IN, IN, 3, 32, 2);
	relu_ip(a, 56 * 56 * 32);
	free(input);

	conv1x1(skip, a, m->rb0_exp_w, m->rb0_exp_b, 56, 56, 32, 64, 2);
	SC(b, tmp, a, m->rb0_sc0_dw, m->rb0_sc0_pw, m->rb0_sc0_b, 56, 56, 32, 64);
	relu_ip(b, 56 * 56 * 64);
	SC(a, tmp, b, m->rb0_sc1_dw, m->rb0_sc1_pw, m->rb0_sc1_b, 56, 56, 64, 64);
	maxpool_3x3_s2(b, a, 56, 56, 64);
	add_ip(b, skip, 28 * 28 * 64);

	conv1x1(skip, b, m->rb1_exp_w, m->rb1_exp_b, 28, 28, 64, 128, 2);
	memcpy(a, b, 28 * 28 * 64 * sizeof(float));
	relu_ip(a, 28 * 28 * 64);
	SC(b, tmp, a, m->rb1_sc0_dw, m->rb1_sc0_pw, m->rb1_sc0_b, 28, 28, 64, 128);
	relu_ip(b, 28 * 28 * 128);
	SC(a, tmp, b, m->rb1_sc1_dw, m->rb1_sc1_pw, m->rb1_sc1_b, 28, 28, 128, 128);
	maxpool_3x3_s2(b, a, 28, 28, 128);
	add_ip(b, skip, 14 * 14 * 128);

	memcpy(skip, b, 14 * 14 * 128 * sizeof(float));
	relu_ip(b, 14 * 14 * 128);
	SC(a, tmp, b, m->mb0_sc0_dw, m->mb0_sc0_pw, m->mb0_sc0_b, 14, 14, 128, 128);
	relu_ip(a, 14 * 14 * 128);
	SC(b, tmp, a, m->mb0_sc1_dw, m->mb0_sc1_pw, m->mb0_sc1_b, 14, 14, 128, 128);
	relu_ip(b, 14 * 14 * 128);
	SC(a, tmp, b, m->mb0_sc2_dw, m->mb0_sc2_pw, m->mb0_sc2_b, 14, 14, 128, 128);
	add_ip(a, skip, 14 * 14 * 128);

	memcpy(skip, a, 14 * 14 * 128 * sizeof(float));
	relu_ip(a, 14 * 14 * 128);
	SC(b, tmp, a, m->mb1_sc0_dw, m->mb1_sc0_pw, m->mb1_sc0_b, 14, 14, 128, 128);
	relu_ip(b, 14 * 14 * 128);
	SC(a, tmp, b, m->mb1_sc1_dw, m->mb1_sc1_pw, m->mb1_sc1_b, 14, 14, 128, 128);
	relu_ip(a, 14 * 14 * 128);
	SC(b, tmp, a, m->mb1_sc2_dw, m->mb1_sc2_pw, m->mb1_sc2_b, 14, 14, 128, 128);
	add_ip(b, skip, 14 * 14 * 128);

	conv1x1(skip, b, m->exit_rb_exp_w, m->exit_rb_exp_b, 14, 14, 128, 256, 2);
	memcpy(a, b, 14 * 14 * 128 * sizeof(float));
	relu_ip(a, 14 * 14 * 128);
	SC(b, tmp, a, m->exit_rb_sc0_dw, m->exit_rb_sc0_pw, m->exit_rb_sc0_b, 14,
	   14, 128, 256);
	relu_ip(b, 14 * 14 * 256);
	SC(a, tmp, b, m->exit_rb_sc1_dw, m->exit_rb_sc1_pw, m->exit_rb_sc1_b, 14,
	   14, 256, 256);
	maxpool_3x3_s2(b, a, 14, 14, 256);
	add_ip(b, skip, 7 * 7 * 256);

	SC(a, tmp, b, m->exit_sc_dw, m->exit_sc_pw, m->exit_sc_b, 7, 7, 256, 512);
	relu_ip(a, 7 * 7 * 512);

	float pooled[512];
	gap(pooled, a, 7, 7, 512);

	float age;
	fc(&age, pooled, m->fc_age_w, m->fc_age_b, 512, 1);

	return age;
}
